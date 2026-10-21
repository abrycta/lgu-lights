//! Read-model materialisation (the CQRS read side): every file the static site and the what-if
//! worker read, for one immutable data version. Layout and field meanings: docs/architecture/README.md.

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use lgu_core::model::{Estimate, Model, Z90};
use lgu_core::panel::{self, FIRST_YEAR, LAST_YEAR, ROUNDS};
use lgu_core::snapshot;
use lgu_core::tiers::{cv_tier, BREAKS};
use serde_json::{json, Value};

use crate::{load_model, load_store, Args};

fn r2(x: f64) -> Value {
    if x.is_finite() { json!((x * 100.0).round() / 100.0) } else { Value::Null }
}

fn r1(x: f64) -> String {
    format!("{:.1}", (x * 10.0).round() / 10.0)
}

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Backtest,
    Between,
    Nowcast,
}

impl Kind {
    fn as_str(self) -> &'static str {
        match self {
            Kind::Backtest => "backtest",
            Kind::Between => "between",
            Kind::Nowcast => "nowcast",
        }
    }
}

fn est_json(e: &Estimate, kind: Kind) -> Value {
    json!({
        "estimate": r2(e.value), "lo50": r2(e.lo50), "hi50": r2(e.hi50), "lo90": r2(e.lo90), "hi90": r2(e.hi90),
        "cv": r2(e.cv), "tier": e.tier as u8, "from": e.prev_year, "kind": kind.as_str(),
    })
}

pub fn run(a: &Args) -> Result<(), String> {
    let s = load_store(a)?;
    let p = &s.panel;
    let pm = p.province_round_means();
    let model_path = PathBuf::from(a.get("model")?);
    let model = load_model(&model_path)?;
    let mut backtests: BTreeMap<i32, Model> = BTreeMap::new();
    for spec in a.all("backtest") {
        let (y, path) = spec.split_once('=').ok_or("--backtest takes YEAR=path")?;
        backtests.insert(y.parse().map_err(|_| "bad backtest year")?, load_model(Path::new(path))?);
    }
    let out = PathBuf::from(a.get("out")?);
    let version = a.get("version")?;
    let last_round = *ROUNDS.last().unwrap();

    let mut attrs = String::from("pcode,n");
    for k in ["v", "t", "s"] {
        for y in FIRST_YEAR..=LAST_YEAR {
            attrs.push_str(&format!(",{k}{}", y % 100));
        }
    }
    attrs.push('\n');
    let mut est_csv = String::from(
        "adm3_pcode,year,source,value,tier,official_estimate,official_se,official_cv,official_lo90,official_hi90,\
         model_estimate,model_lo90,model_hi90,model_cv,model_tier,model_kind,model_from\n",
    );
    let mut counts: BTreeMap<String, usize> = BTreeMap::new();
    let mut index_lgus = Vec::with_capacity(p.len());

    for i in 0..p.len() {
        let l = &s.lgus[i];
        let mut years = Vec::with_capacity(panel::N_YEARS);
        let (mut v, mut t, mut src) = (Vec::new(), Vec::new(), Vec::new());
        for y in FIRST_YEAR..=LAST_YEAR {
            let yi = panel::year_index(y).unwrap();
            let official = panel::round_index(y).and_then(|k| s.labels[i * ROUNDS.len() + k].clone());
            let kind = if panel::round_index(y).is_some() {
                Kind::Backtest
            } else if y > last_round {
                Kind::Nowcast
            } else {
                Kind::Between
            };
            let m = match kind {
                Kind::Backtest => backtests.get(&y).and_then(|bm| bm.estimate(p, &pm, i, y)),
                _ => model.estimate(p, &pm, i, y),
            };
            let off_json = official.as_ref().map(|o| {
                json!({"estimate": r2(o.estimate), "se": r2(o.se), "cv": r2(o.cv), "lo90": r2(o.ci_lo),
                       "hi90": r2(o.ci_hi), "tier": cv_tier(o.cv) as u8, "estimator": o.estimator})
            });
            let shown = match (&official, &m) {
                (Some(o), _) => Some((o.estimate, cv_tier(o.cv) as u8, 0u8)),
                (None, Some(e)) => Some((e.value, e.tier as u8, 1u8)),
                _ => None,
            };
            if let Some((val, tier, so)) = shown {
                v.push(r1(val));
                t.push(tier.to_string());
                src.push(so.to_string());
                *counts.entry(if so == 0 { "official".into() } else { format!("model_{}", kind.as_str()) }).or_default() += 1;
            } else {
                v.push(String::new());
                t.push(String::new());
                src.push(String::new());
            }
            let raw = p.raw_year(i, yi);
            years.push(json!({
                "year": y,
                "official": off_json,
                "model": m.as_ref().map(|e| est_json(e, kind)),
                "shown": shown.map(|(val, tier, so)| json!({"value": r2(val), "tier": tier,
                                                             "source": if so == 0 { "official" } else { "model" }})),
                "inputs": {"radiance": r2(raw[panel::BM_MEAN]), "lit": r2(raw[panel::BM_LIT]),
                           "ndvi": r2(raw[panel::NDVI]), "pop": r2(raw[panel::POP].round())},
            }));
            let f = |x: Option<f64>| x.filter(|v| v.is_finite()).map(|v| format!("{:.4}", v)).unwrap_or_default();
            est_csv.push_str(&format!(
                "{},{y},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}\n",
                l.pcode,
                shown.map(|x| if x.2 == 0 { "official" } else { "model" }).unwrap_or(""),
                f(shown.map(|x| x.0)),
                shown.map(|x| x.1.to_string()).unwrap_or_default(),
                f(official.as_ref().map(|o| o.estimate)),
                f(official.as_ref().map(|o| o.se)),
                f(official.as_ref().map(|o| o.cv)),
                f(official.as_ref().map(|o| o.ci_lo)),
                f(official.as_ref().map(|o| o.ci_hi)),
                f(m.map(|e| e.value)),
                f(m.map(|e| e.lo90)),
                f(m.map(|e| e.hi90)),
                f(m.map(|e| e.cv)),
                m.map(|e| (e.tier as u8).to_string()).unwrap_or_default(),
                m.map(|_| kind.as_str()).unwrap_or(""),
                m.map(|e| e.prev_year.to_string()).unwrap_or_default(),
            ));
        }
        attrs.push_str(&format!("{},\"{}\",{},{},{}\n", l.pcode, l.name.replace('"', "'"), v.join(","), t.join(","), src.join(",")));
        let doc = json!({
            "pcode": l.pcode, "psgc": format!("{}000", &l.pcode[2..]), "name": l.name,
            "province": {"pcode": l.province_pcode, "name": l.province},
            "region": {"pcode": l.region_pcode, "name": l.region},
            "class": l.class, "area_km2": r2(l.area_km2), "years": years,
        });
        lgu_store::write_json(&out.join("lgu").join(format!("{}.json", l.pcode)), &doc)?;
        index_lgus.push(json!({"p": l.pcode, "n": l.name, "pv": l.province_pcode, "r": l.region_pcode,
                               "c": l.class, "x": r2(l.lon), "y": r2(l.lat)}));
    }

    let provinces: Value = match a.opt("provinces") {
        Some(f) => serde_json::from_str(&fs::read_to_string(f).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
        None => json!([]),
    };
    let mut regions: BTreeMap<&str, &str> = BTreeMap::new();
    for l in &s.lgus {
        regions.insert(&l.region_pcode, &l.region);
    }
    lgu_store::write_json(&out.join("index.json"), &json!({
        "lgus": index_lgus, "provinces": provinces,
        "regions": regions.iter().map(|(p, n)| json!({"p": p, "n": n})).collect::<Vec<_>>(),
    }))?;
    lgu_store::write_atomic(&out.join("tiles-attrs.csv"), attrs.as_bytes())?;
    lgu_store::write_atomic(&out.join("estimates.csv"), est_csv.as_bytes())?;
    lgu_store::write_atomic(&out.join("whatif").join("snapshot.bin"), &snapshot::encode(p))?;
    lgu_store::write_atomic(&out.join("whatif").join("model.json"), &fs::read(&model_path).map_err(|e| e.to_string())?)?;
    if let Some(mp) = a.opt("metrics") {
        lgu_store::write_atomic(&out.join("metrics.json"), &fs::read(mp).map_err(|e| e.to_string())?)?;
    }
    let provenance: Value = match a.opt("provenance") {
        Some(f) => serde_json::from_str(&fs::read_to_string(f).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?,
        None => Value::Null,
    };
    lgu_store::write_json(&out.join("manifest.json"), &json!({
        "version": version,
        "generated_at": a.opt("generated"),
        "git_sha": a.opt("sha"),
        "years": (FIRST_YEAR..=LAST_YEAR).collect::<Vec<_>>(),
        "rounds": ROUNDS,
        "breaks": BREAKS,
        "tiers": {"reliable_max_cv": 10, "caution_max_cv": 20},
        "z90": Z90,
        "lgus": p.len(),
        "counts": counts,
        "model": {"name": model.name, "version": model.version, "whatif_widen": model.whatif_widen,
                  "backtests": backtests.keys().collect::<Vec<_>>()},
        "provenance": provenance,
    }))?;
    eprintln!("materialised {} LGUs x {} years into {}: {:?}", p.len(), panel::N_YEARS, out.display(), counts);
    Ok(())
}
