//! The trained model artefact (`model.json`, written by `pipeline/lgu/train.py`) and the estimate
//! it produces: point value, 50 % and 90 % conformal intervals, model CV and reliability tier.

use serde::Deserialize;

use crate::features::{self, FEATURES, N_FEATURES};
use crate::forest::Forest;
use crate::panel::{Panel, ROUNDS};
use crate::tiers::{Tier, cv_tier};

/// z for a two-sided 90 % normal interval, used to turn an interval half-width into a CV.
pub const Z90: f64 = 1.644_853_626_951_472_2;

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

#[derive(Debug, Clone, Deserialize)]
pub struct Model {
    pub name: String,
    pub version: String,
    pub features: Vec<String>,
    pub forest: Forest,
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
        let m: Model = serde_json::from_str(s).map_err(|e| e.to_string())?;
        if m.features != FEATURES {
            return Err(format!(
                "model features {:?} differ from the core's {:?}",
                m.features, FEATURES
            ));
        }
        if m.forest.n_features != N_FEATURES {
            return Err("forest.n_features differs from the core's feature count".into());
        }
        m.forest.validate().map_err(|e| format!("{e:?}"))?;
        let c = &m.calibration;
        if c.q50.len() != c.edges.len() + 1 || c.q90.len() != c.edges.len() + 1 {
            return Err("calibration needs edges.len() + 1 quantiles".into());
        }
        Ok(m)
    }

    /// Predicted change in percentage points since the previous round.
    pub fn delta(&self, x: &[f64; N_FEATURES]) -> f64 {
        self.forest.predict(x)
    }

    /// Point estimate and intervals from a feature row.
    pub fn estimate_from_row(&self, x: &[f64; N_FEATURES], prev_year: i32, widen: f64) -> Estimate {
        let y_prev = x[0];
        let value = (y_prev + self.delta(x)).clamp(0.0, 100.0);
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
        prov_means: &[f64],
        lgu: usize,
        year: i32,
    ) -> Option<Estimate> {
        let r = panel.prev_round(lgu, year)?;
        let x = features::row(panel, prov_means, lgu, year, r);
        Some(self.estimate_from_row(&x, ROUNDS[r], 1.0))
    }
}
