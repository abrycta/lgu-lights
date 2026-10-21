//! `lgu`: the batch driving adapter (GitHub Actions). Every number the site shows is computed here,
//! by lgu-core, from the Parquet feature store and the trained model artefacts.
//!
//! ```text
//! lgu design      --build <dir> --out design.csv
//! lgu parity      --build <dir> --model model.json --expected preds.csv [--column pred] [--tol 1e-5]
//! lgu materialise --build <dir> --model model.json [--backtest 2018=bt-2018.json ...] --metrics metrics.json
//!                 --provinces provinces.json --version v1 --sha <git sha> --generated <iso time> --out <dir>
//! ```
//! `<dir>` holds lgus.parquet, features.parquet and labels.parquet.

mod materialise;

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use lgu_core::features::{self, FEATURES};
use lgu_core::model::Model;
use lgu_core::panel::{FIRST_YEAR, LAST_YEAR, ROUNDS};
use lgu_store::Store;

pub(crate) struct Args(HashMap<String, Vec<String>>);

impl Args {
    fn parse(v: &[String]) -> Args {
        let mut m: HashMap<String, Vec<String>> = HashMap::new();
        let mut i = 0;
        while i < v.len() {
            if let Some(k) = v[i].strip_prefix("--") {
                let val = v.get(i + 1).cloned().unwrap_or_default();
                m.entry(k.to_string()).or_default().push(val);
                i += 2;
            } else {
                i += 1;
            }
        }
        Args(m)
    }
    pub(crate) fn get(&self, k: &str) -> Result<&str, String> {
        self.0
            .get(k)
            .and_then(|v| v.last())
            .map(String::as_str)
            .ok_or_else(|| format!("missing --{k}"))
    }
    pub(crate) fn opt(&self, k: &str) -> Option<&str> {
        self.0.get(k).and_then(|v| v.last()).map(String::as_str)
    }
    pub(crate) fn all(&self, k: &str) -> Vec<String> {
        self.0.get(k).cloned().unwrap_or_default()
    }
}

pub(crate) fn load_store(a: &Args) -> Result<Store, String> {
    let b = PathBuf::from(a.get("build")?);
    lgu_store::load(
        &b.join("lgus.parquet"),
        &b.join("features.parquet"),
        &b.join("labels.parquet"),
    )
}

pub(crate) fn load_model(p: &Path) -> Result<Model, String> {
    Model::from_json(&fs::read_to_string(p).map_err(|e| format!("{}: {e}", p.display()))?)
}

/// The design matrix: one row per (LGU, year) with a previous official round. Training rows are the
/// round years with an official estimate (`label = 1`, `target` = change in pp since the previous round);
/// rounds up to FIRST_YEAR (2009, 2012) appear only when labelled.
fn design(a: &Args) -> Result<(), String> {
    let s = load_store(a)?;
    let p = &s.panel;
    let pm = p.province_stats();
    let mut out = String::from("adm3_pcode,year,prev_year,label,target,y,se,province");
    for f in FEATURES {
        out.push(',');
        out.push_str(f);
    }
    out.push('\n');
    let mut n = (0, 0);
    // Round years up to FIRST_YEAR (2009, 2012) are training rows only; later years are every year.
    let years: Vec<i32> = ROUNDS
        .into_iter()
        .filter(|&y| y <= FIRST_YEAR)
        .chain(FIRST_YEAR + 1..=LAST_YEAR)
        .collect();
    for i in 0..p.len() {
        for &t in &years {
            let Some(r) = p.prev_round(i, t) else {
                continue;
            };
            let x = features::row(p, &pm, i, t, r);
            let lab = lgu_core::panel::round_index(t)
                .map(|k| p.official(i, k))
                .filter(|o| o.is_some());
            if t <= FIRST_YEAR && lab.is_none() {
                continue;
            }
            let (label, target, y, se) = match lab {
                Some(o) => (1, o.estimate - p.official(i, r).estimate, o.estimate, o.se),
                None => (0, f64::NAN, f64::NAN, f64::NAN),
            };
            n.0 += 1;
            n.1 += label;
            out.push_str(&format!(
                "{},{t},{},{label},{target},{y},{se},{}",
                s.lgus[i].pcode, ROUNDS[r], s.lgus[i].province_pcode
            ));
            for v in x {
                out.push(',');
                out.push_str(&format!("{v}"));
            }
            out.push('\n');
        }
    }
    lgu_store::write_atomic(Path::new(a.get("out")?), out.as_bytes())?;
    eprintln!(
        "design: {} rows, {} labelled, {} LGUs, {} features",
        n.0,
        n.1,
        p.len(),
        FEATURES.len()
    );
    Ok(())
}

/// Parity gate: the core's prediction (features re-derived from Parquet, trees evaluated in Rust)
/// against the training framework's prediction for the same rows.
fn parity(a: &Args) -> Result<(), String> {
    let s = load_store(a)?;
    let m = load_model(Path::new(a.get("model")?))?;
    let col = a.opt("column").unwrap_or("pred");
    let tol: f64 = a
        .opt("tol")
        .unwrap_or("1e-5")
        .parse()
        .map_err(|_| "bad --tol")?;
    let text = fs::read_to_string(a.get("expected")?).map_err(|e| e.to_string())?;
    let mut lines = text.lines();
    let head: Vec<&str> = lines
        .next()
        .ok_or("empty expected file")?
        .split(',')
        .collect();
    let ix = |k: &str| {
        head.iter()
            .position(|h| *h == k)
            .ok_or(format!("expected file lacks column {k}"))
    };
    let (ip, iy, ic) = (ix("adm3_pcode")?, ix("year")?, ix(col)?);
    let pm = s.panel.province_stats();
    let index: HashMap<&str, usize> = s
        .lgus
        .iter()
        .enumerate()
        .map(|(i, l)| (l.pcode.as_str(), i))
        .collect();
    let (mut n, mut worst, mut at) = (0usize, 0.0f64, String::new());
    for line in lines {
        let c: Vec<&str> = line.split(',').collect();
        let i = *index.get(c[ip]).ok_or(format!("unknown LGU {}", c[ip]))?;
        let t: i32 = c[iy].parse().map_err(|_| "bad year")?;
        let r = s
            .panel
            .prev_round(i, t)
            .ok_or(format!("{} {t}: no previous round", c[ip]))?;
        let want: f64 = c[ic].parse().map_err(|_| "bad prediction")?;
        let got = m.delta(&features::row(&s.panel, &pm, i, t, r));
        let d = (got - want).abs();
        if d > worst || d.is_nan() {
            worst = if d.is_nan() { f64::INFINITY } else { d };
            at = format!("{} {t}: core {got} vs framework {want}", c[ip]);
        }
        n += 1;
    }
    eprintln!(
        "parity {}: {n} rows, max |core - framework| = {worst:.3e} (tolerance {tol:.0e}){}",
        m.name,
        if at.is_empty() {
            String::new()
        } else {
            format!(", worst at {at}")
        }
    );
    println!(
        "{{\"model\":\"{}\",\"rows\":{n},\"max_abs_diff\":{worst:e},\"tolerance\":{tol:e}}}",
        m.name
    );
    if worst <= tol {
        Ok(())
    } else {
        Err(format!("parity failed: {worst:e} > {tol:e}"))
    }
}

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let Some(cmd) = argv.first() else {
        eprintln!("usage: lgu <design|parity|materialise> --build <dir> ...");
        return ExitCode::from(2);
    };
    let a = Args::parse(&argv[1..]);
    let r = match cmd.as_str() {
        "design" => design(&a),
        "parity" => parity(&a),
        "materialise" => materialise::run(&a),
        _ => Err(format!("unknown command {cmd}")),
    };
    match r {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}
