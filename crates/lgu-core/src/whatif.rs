//! What-if scenarios (DECISIONS Q11): hypothetical extra radiance growth and an NDVI change applied
//! to one LGU's inputs for the target year; the interval is widened by the model's stated factor.
//! A zero scenario reproduces the model estimate exactly. Results are labelled hypothetical by every
//! caller and never drawn on the main map.

use crate::features::row_with;
use crate::model::{Estimate, Model};
use crate::panel::{self, Panel, ProvinceStats, ROUNDS};

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Scenario {
    /// Extra radiance growth in percent per year on top of what was observed, compounded over the years
    /// since the last official round (e.g. 10.0 = radiance 10 % a year higher than observed).
    pub radiance_growth_pct: f64,
    /// Added to the annual mean NDVI of the target year (e.g. -0.05).
    pub ndvi_delta: f64,
}

pub fn whatif(
    model: &Model,
    panel: &Panel,
    prov: &ProvinceStats,
    lgu: usize,
    year: i32,
    s: Scenario,
) -> Option<Estimate> {
    let r = panel.prev_round(lgu, year)?;
    let ry = ROUNDS[r];
    let ri = panel.year_index(ry)?;
    let ti = panel.year_index(year)?;
    let g = 1.0 + s.radiance_growth_pct / 100.0;
    let raw_at = |yi: usize| {
        let mut a = [0.0; panel::N_RAW];
        a.copy_from_slice(panel.raw_year(lgu, yi));
        if yi == ti && yi > ri {
            let f = g.powi((ti - ri) as i32);
            a[panel::BM_MEAN] *= f;
            a[panel::BM_SUM] *= f;
            a[panel::NDVI] += s.ndvi_delta;
        }
        a
    };
    let x = row_with(panel, prov, lgu, year, r, &raw_at);
    Some(model.estimate_from_row(&x, ry, model.whatif_widen))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::tests::tiny_panel;
    use crate::forest::{Forest, Tree};
    use crate::model::Calibration;

    fn model() -> Model {
        // One stump on d_l_bm (feature 7): brighter than at the last round -> 2 pp less poverty.
        Model {
            name: "t".into(),
            version: "t".into(),
            features: crate::features::FEATURES
                .iter()
                .map(|s| s.to_string())
                .collect(),
            forest: Forest {
                n_features: crate::features::N_FEATURES,
                scale: 1.0,
                trees: vec![Tree {
                    split_feature: vec![7],
                    threshold: vec![0.3],
                    decision_type: vec![0],
                    left_child: vec![-1],
                    right_child: vec![-2],
                    leaf_value: vec![0.0, -2.0],
                }],
            },
            calibration: Calibration {
                edges: vec![],
                q50: vec![1.0],
                q90: vec![2.0],
            },
            whatif_widen: 1.5,
            linear: Default::default(),
            index: (0..crate::features::N_FEATURES).collect(),
        }
    }

    #[test]
    fn zero_scenario_reproduces_the_estimate_and_growth_moves_it() {
        let (p, m) = (tiny_panel(), model());
        let pm = p.province_stats();
        let base = m.estimate(&p, &pm, 0, 2025).unwrap();
        let zero = whatif(
            &m,
            &p,
            &pm,
            0,
            2025,
            Scenario {
                radiance_growth_pct: 0.0,
                ndvi_delta: 0.0,
            },
        )
        .unwrap();
        assert_eq!(zero.value, base.value);
        assert_eq!(zero.hi90 - zero.value, 1.5 * (base.hi90 - base.value)); // widened, stated factor
        let bright = whatif(
            &m,
            &p,
            &pm,
            0,
            2025,
            Scenario {
                radiance_growth_pct: 40.0,
                ndvi_delta: 0.0,
            },
        )
        .unwrap();
        assert_eq!(bright.value, base.value - 2.0);
        assert_eq!(bright.prev_year, 2023);
    }
}
