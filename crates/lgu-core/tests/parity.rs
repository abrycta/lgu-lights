//! Parity with the training framework: the core's tree evaluator must reproduce LightGBM's own
//! `Booster.predict()` on a committed fixture (pipeline/tools/make_parity_fixture.py). The data
//! workflow runs the same gate on the real models over every design row (`lgu parity`).

use lgu_core::forest::Forest;

#[test]
fn forest_matches_lightgbm_predict() {
    let forest = Forest::from_json(include_str!("fixtures/forest.json")).expect("valid forest");
    let csv = include_str!("fixtures/parity.csv");
    let mut lines = csv.lines();
    let head: Vec<&str> = lines.next().unwrap().split(',').collect();
    let ip = head.iter().position(|h| *h == "pred").unwrap();
    let mut worst = 0.0f64;
    let mut n = 0;
    for line in lines {
        let c: Vec<f64> = line.split(',').map(|v| v.parse::<f64>().unwrap()).collect();
        let x = &c[..forest.n_features];
        let d = (forest.predict(x) - c[ip]).abs();
        worst = worst.max(d);
        n += 1;
    }
    assert_eq!(n, 64);
    // The spike's tolerance is 1e-5; f64 evaluation of the same trees is exact up to summation order.
    assert!(worst <= 1e-9, "max |core - lightgbm| = {worst:e}");
}
