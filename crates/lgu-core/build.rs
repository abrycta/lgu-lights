//! Generates the PSA round constants from config/rounds.json (audit M5): the one source shared with the
//! Python pipeline (pipeline/lgu/rounds.py) and the web app (web/src/lib/rounds.gen.ts).
use std::{env, fs, path::Path};

fn main() {
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../config/rounds.json");
    println!("cargo:rerun-if-changed={}", src.display());
    let c: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&src).expect("config/rounds.json"))
            .expect("rounds.json");
    let rounds: Vec<(i64, String)> = c["rounds"]
        .as_array()
        .expect("rounds")
        .iter()
        .map(|r| {
            (
                r["year"].as_i64().unwrap(),
                r["estimator"].as_str().unwrap().to_owned(),
            )
        })
        .collect();
    assert!(
        rounds.windows(2).all(|w| w[0].0 < w[1].0),
        "rounds must be ascending"
    );
    let years: Vec<String> = rounds.iter().map(|r| r.0.to_string()).collect();
    // The first round of PSA's current estimator (Census EB): the ELL -> Census EB method change.
    let eb_from = rounds
        .iter()
        .find(|r| r.1 == "CensusEB")
        .map_or(i64::from(i32::MAX), |r| r.0);
    let code = format!(
        "/// PSA Small Area Estimate rounds used by the models (config/rounds.json).\n\
         pub const ROUNDS: [i32; {n}] = [{y}];\n\
         /// First round estimated with Census EB (earlier rounds: ELL).\n\
         pub const CENSUS_EB_FROM: i32 = {eb_from};\n",
        n = years.len(),
        y = years.join(", "),
    );
    fs::write(
        Path::new(&env::var("OUT_DIR").unwrap()).join("rounds.rs"),
        code,
    )
    .unwrap();
}
