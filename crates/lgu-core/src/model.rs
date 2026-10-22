//! The trained model artefact (`model.json`, written by `pipeline/lgu/train.py`) and the estimate
//! it produces: point value, 50 % and 90 % conformal intervals, model CV and reliability tier.

use serde::Deserialize;

use crate::features::{self, FEATURES, N_FEATURES};
use crate::forest::Forest;
use crate::panel::{Panel, ProvinceStats, ROUNDS};
use crate::tiers::{Tier, cv_tier};

/// z for a two-sided 90 % normal interval, used to turn an interval half-width into a CV.
pub const Z90: f64 = 1.644_853_626_951_472_2;

/// Share of the previous official figure below which a predicted fall tapers (data v5, lb-lows).
pub const TAPER: f64 = 0.5;

/// The level from the previous official figure and the predicted change, in percent (data v5).
/// A rise, or a fall to no less than `TAPER` of the previous figure, adds as before. A larger fall
/// tapers hyperbolically below `f = TAPER * y_prev`, as `f² / (2f − raw)` (continuous, same slope at
/// the joint, always above 0), so a place is never estimated at exactly 0 %: in the PSA rounds 2006-2023 no LGU fell below 12 % of its previous
/// figure and the lowest published figure is 0.28 %. Mirrored by `level` in pipeline/lgu/train.py.
pub fn level(y_prev: f64, change: f64) -> f64 {
    let raw = y_prev + change;
    let floor = TAPER * y_prev;
    let v = if y_prev > 0.0 && raw < floor {
        floor * floor / (2.0 * floor - raw)
    } else {
        raw
    };
    v.clamp(0.0, 100.0)
}

/// Conformal calibration: absolute-residual quantiles per bin of the previous official estimate,
/// from forward-chaining out-of-fold residuals (MODELING-PLAN §6).
#[derive(Debug, Clone, Deserialize)]
pub struct Calibration {
    /// Ascending inner bin edges on `y_prev` (pp); `edges.len() + 1` bins.
    pub edges: Vec<f64>,
    pub q50: Vec<f64>,
    pub q90: Vec<f64>,
}

impl Calibration {
    pub fn bin(&self, y_prev: f64) -> usize {
        self.edges.iter().take_while(|&&e| y_prev > e).count()
    }
}

/// A linear term added to the forest's prediction (model v3): `sum(coef_i * x_i)` over named core
/// features, a missing (NaN) input contributing 0. v3 uses it for the national drift (a coefficient
/// on `gap`) and the provincial FIES term (`prov_fies_gap`); absent in v1/v2 models.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Linear {
    pub features: Vec<String>,
    pub coef: Vec<f64>,
    #[serde(skip)]
    pub(crate) index: Vec<usize>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Model {
    pub name: String,
    pub version: String,
    /// The forest's inputs, by name: any subset of the core's FEATURES in any order, so models trained
    /// on an earlier feature list (v1/v2: 19 features) still load in a newer core.
    pub features: Vec<String>,
    pub forest: Forest,
    #[serde(default)]
    pub linear: Linear,
    #[serde(skip)]
    pub(crate) index: Vec<usize>,
    pub calibration: Calibration,
    /// What-if intervals are widened by this stated factor (DECISIONS Q11).
    pub whatif_widen: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Estimate {
    pub value: f64,
    pub lo50: f64,
    pub hi50: f64,
    pub lo90: f64,
    pub hi90: f64,
    /// Model coefficient of variation in percent: (90 % half-width / z90) / value.
    pub cv: f64,
    pub tier: Tier,
    /// The PSA round the estimate starts from.
    pub prev_year: i32,
}

impl Model {
    pub fn from_json(s: &str) -> Result<Model, String> {
        let mut m: Model = serde_json::from_str(s).map_err(|e| e.to_string())?;
        let lookup = |names: &[String]| -> Result<Vec<usize>, String> {
            names
                .iter()
                .map(|f| {
                    FEATURES
                        .iter()
                        .position(|g| g == f)
                        .ok_or(format!("model feature {f} is not a core feature"))
                })
                .collect()
        };
        m.index = lookup(&m.features)?;
        m.linear.index = lookup(&m.linear.features)?;
        if m.forest.n_features != m.features.len() {
            return Err("forest.n_features differs from the model's feature count".into());
        }
        if m.linear.coef.len() != m.linear.features.len() {
            return Err("linear.coef and linear.features differ in length".into());
        }
        m.forest.validate().map_err(|e| format!("{e:?}"))?;
        let c = &m.calibration;
        if c.q50.len() != c.edges.len() + 1 || c.q90.len() != c.edges.len() + 1 {
            return Err("calibration needs edges.len() + 1 quantiles".into());
        }
        Ok(m)
    }

    /// Predicted change in percentage points since the previous round, from a full core feature row.
    pub fn delta(&self, x: &[f64; N_FEATURES]) -> f64 {
        let mut v = [0.0; N_FEATURES];
        for (k, &i) in self.index.iter().enumerate() {
            v[k] = x[i];
        }
        let lin: f64 = self
            .linear
            .index
            .iter()
            .zip(&self.linear.coef)
            .map(|(&i, c)| if x[i].is_finite() { c * x[i] } else { 0.0 })
            .sum();
        self.forest.predict(&v[..self.index.len()]) + lin
    }

    /// Point estimate and intervals from a feature row.
    pub fn estimate_from_row(&self, x: &[f64; N_FEATURES], prev_year: i32, widen: f64) -> Estimate {
        let y_prev = x[0];
        let value = level(y_prev, self.delta(x));
        let b = self.calibration.bin(y_prev);
        let (h50, h90) = (
            self.calibration.q50[b] * widen,
            self.calibration.q90[b] * widen,
        );
        let cv = if value > 0.0 {
            100.0 * (h90 / Z90) / value
        } else {
            f64::INFINITY
        };
        Estimate {
            value,
            lo50: (value - h50).max(0.0),
            hi50: (value + h50).min(100.0),
            lo90: (value - h90).max(0.0),
            hi90: (value + h90).min(100.0),
            cv,
            tier: cv_tier(cv),
            prev_year,
        }
    }

    /// Model estimate for (lgu, year) from the last official round before `year`; None when the LGU
    /// has no earlier official estimate.
    pub fn estimate(
        &self,
        panel: &Panel,
        prov: &ProvinceStats,
        lgu: usize,
        year: i32,
    ) -> Option<Estimate> {
        let r = panel.prev_round(lgu, year)?;
        let x = features::row(panel, prov, lgu, year, r);
        Some(self.estimate_from_row(&x, ROUNDS[r], 1.0))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn json(features: &str, linear: &str) -> String {
        format!(
            r#"{{"name":"t","version":"t","features":{features},{linear}
            "forest":{{"n_features":1,"scale":1.0,"trees":[{{"split_feature":[0],"threshold":[0.3],
            "decision_type":[0],"left_child":[-1],"right_child":[-2],"leaf_value":[0.0,-2.0]}}]}},
            "calibration":{{"edges":[],"q50":[1.0],"q90":[2.0]}},"whatif_widen":1.25}}"#
        )
    }

    #[test]
    fn forest_inputs_are_named_and_the_linear_term_skips_missing_inputs() {
        let m = Model::from_json(&json(
            r#"["d_l_bm"]"#,
            r#""linear":{"features":["gap","prov_fies_gap"],"coef":[-0.5,0.25]},"#,
        ))
        .unwrap();
        let mut x = [0.0; N_FEATURES];
        x[7] = 1.0; // d_l_bm > 0.3 -> -2
        x[1] = 2.0; // gap
        x[19] = f64::NAN; // no FIES figure -> contributes 0
        assert_eq!(m.delta(&x), -2.0 - 1.0);
        x[19] = 4.0;
        assert_eq!(m.delta(&x), -2.0 - 1.0 + 1.0);
    }

    #[test]
    fn a_model_without_linear_terms_still_loads_and_unknown_features_are_rejected() {
        assert!(Model::from_json(&json(r#"["d_l_bm"]"#, "")).is_ok());
        assert!(Model::from_json(&json(r#"["no_such_feature"]"#, "")).is_err());
    }

    #[test]
    fn a_large_fall_tapers_above_zero_and_the_rest_adds() {
        assert_eq!(level(20.0, 3.0), 23.0);
        assert_eq!(level(20.0, -10.0), 10.0); // exactly half: the joint
        assert!((level(20.0, -9.0) - 11.0).abs() < 1e-12);
        let v = level(2.0, -4.0); // additive would be -2 %
        assert!(v > 0.0 && v < 1.0, "{v}");
        assert!((v - 0.25).abs() < 1e-12); // f = 1: 1 / (2 + 2)
        assert!(level(2.0, -40.0) > 0.0);
        assert!(level(2.0, -4.0) < level(2.0, -3.0)); // still monotone
        assert_eq!(level(99.0, 5.0), 100.0);
    }
}
