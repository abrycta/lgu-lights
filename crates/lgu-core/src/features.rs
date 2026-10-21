//! Feature derivation: the single implementation used for training (the CLI writes the design
//! matrix that the Python trainer reads), for the map (CLI), for what-if (WASM) and later the API.
//!
//! A row describes "LGU i in year t, last official estimate in round r < t". The model predicts the
//! change in poverty incidence (percentage points) since round r; the estimate is
//! `clamp(official_r + prediction, 0, 100)`.

use crate::panel::{self, Panel, ROUNDS};

pub const FEATURES: [&str; 19] = [
    "y_prev",         // official estimate in round r (pp)
    "gap",            // t - r (years)
    "trend_prev",     // (y_r - y_r2) / (r - r2), previous official trend; NaN without r2
    "era_cross",      // 1 when r <= 2018 and t >= 2021 (ELL -> Census EB estimator change)
    "prov_prev_mean", // mean official estimate of the province's LGUs in round r
    "se_prev",        // PSA standard error in round r (pp)
    "l_bm",           // ln(1 + Black Marble mean radiance), year t
    "d_l_bm",         // l_bm(t) - l_bm(r)
    "lit",            // lit fraction (radiance > 0.5 nW cm-2 sr-1), year t
    "d_lit",          // lit(t) - lit(r)
    "l_rpc",          // ln(1 + 1000 * radiance sum / population), year t
    "l_dens",         // ln(1 + population / km2), year t
    "d_l_pop",        // ln(pop(t)) - ln(pop(r))
    "ndvi",           // MODIS NDVI annual mean, year t
    "d_ndvi",         // ndvi(t) - ndvi(r)
    "evi",            // MODIS EVI annual mean, year t
    "elev",           // mean elevation (m)
    "slope",          // mean slope (degrees)
    "bm_valid",       // fraction of the LGU with valid Black Marble pixels, year t
];
pub const N_FEATURES: usize = FEATURES.len();

fn ln1p(x: f64) -> f64 {
    if x.is_finite() && x > -1.0 {
        x.ln_1p()
    } else {
        f64::NAN
    }
}

/// Feature row for (lgu, year t) given the previous round index `r`.
/// `raw_at(year_idx)` returns the raw inputs (the panel's, or a what-if scenario's).
pub fn row_with(
    panel: &Panel,
    prov_means: &[f64],
    lgu: usize,
    t: i32,
    r: usize,
    raw_at: &dyn Fn(usize) -> [f64; panel::N_RAW],
) -> [f64; N_FEATURES] {
    let ry = ROUNDS[r];
    let ti = panel::year_index(t).expect("year in range");
    let ri = panel::year_index(ry).expect("round in range");
    let o = panel.official(lgu, r);
    let r2 = (0..r).rev().find(|&k| panel.official(lgu, k).is_some());
    let trend = match r2 {
        Some(k) => (o.estimate - panel.official(lgu, k).estimate) / f64::from(ry - ROUNDS[k]),
        None => f64::NAN,
    };
    let now = raw_at(ti);
    let then = raw_at(ri);
    let area = panel.stat(lgu, 0);
    let l_bm_t = ln1p(now[panel::BM_MEAN]);
    let l_bm_r = ln1p(then[panel::BM_MEAN]);
    let rpc = if now[panel::POP] > 0.0 {
        ln1p(1000.0 * now[panel::BM_SUM] / now[panel::POP])
    } else {
        f64::NAN
    };
    let dens = if area > 0.0 {
        ln1p(now[panel::POP] / area)
    } else {
        f64::NAN
    };
    let d_pop = if now[panel::POP] > 0.0 && then[panel::POP] > 0.0 {
        now[panel::POP].ln() - then[panel::POP].ln()
    } else {
        f64::NAN
    };
    let p = panel.province[lgu] as usize;
    [
        o.estimate,
        f64::from(t - ry),
        trend,
        if ry <= 2018 && t >= 2021 { 1.0 } else { 0.0 },
        prov_means[p * ROUNDS.len() + r],
        o.se,
        l_bm_t,
        l_bm_t - l_bm_r,
        now[panel::BM_LIT],
        now[panel::BM_LIT] - then[panel::BM_LIT],
        rpc,
        dens,
        d_pop,
        now[panel::NDVI],
        now[panel::NDVI] - then[panel::NDVI],
        now[panel::EVI],
        panel.stat(lgu, 1),
        panel.stat(lgu, 2),
        now[panel::BM_VALID],
    ]
}

/// Feature row from the panel's own raw values.
pub fn row(panel: &Panel, prov_means: &[f64], lgu: usize, t: i32, r: usize) -> [f64; N_FEATURES] {
    row_with(panel, prov_means, lgu, t, r, &|yi| {
        let mut a = [0.0; panel::N_RAW];
        a.copy_from_slice(panel.raw_year(lgu, yi));
        a
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::panel::{N_RAW, N_YEARS, Official};

    pub(crate) fn tiny_panel() -> Panel {
        let mut p = Panel::default();
        for (id, prov, base) in [(100u32, 1u32, 1.0f64), (200, 1, 4.0), (300, 2, 0.2)] {
            let mut raw = vec![0.0; N_YEARS * N_RAW];
            for y in 0..N_YEARS {
                let g = 1.0 + 0.05 * y as f64;
                raw[y * N_RAW..(y + 1) * N_RAW].copy_from_slice(&[
                    base * g,
                    base * g * 900.0,
                    0.3,
                    1.0,
                    0.6,
                    0.4,
                    10_000.0 * g,
                ]);
            }
            let off = [
                Official {
                    estimate: 30.0 / base,
                    se: 2.0,
                },
                Official {
                    estimate: 28.0 / base,
                    se: 2.0,
                },
                Official::NONE,
                Official {
                    estimate: 20.0 / base,
                    se: 1.5,
                },
                Official {
                    estimate: 18.0 / base,
                    se: 1.0,
                },
            ];
            p.push(id, prov, &raw, &[100.0, 50.0, 3.0], &off);
        }
        p
    }

    #[test]
    fn prev_round_skips_missing_rounds() {
        let p = tiny_panel();
        assert_eq!(p.prev_round(0, 2021), Some(1)); // 2018 missing -> 2015
        assert_eq!(p.prev_round(0, 2024), Some(4));
        assert_eq!(p.prev_round(0, 2012), None);
    }

    #[test]
    fn row_has_documented_meaning() {
        let p = tiny_panel();
        let pm = p.province_round_means();
        let x = row(&p, &pm, 0, 2021, 1);
        assert_eq!(x[0], 28.0); // y_prev
        assert_eq!(x[1], 6.0); // gap
        assert!((x[2] - (28.0 - 30.0) / 3.0).abs() < 1e-12); // trend_prev
        assert_eq!(x[3], 1.0); // ELL -> CEB crossing
        assert!((x[4] - (28.0 + 7.0) / 2.0).abs() < 1e-5); // province mean of 2015 (LGUs 0 and 1)
        assert!(x[7] > 0.0); // lights grew
        assert!((x[12] - (1.45f64 / 1.15).ln()).abs() < 1e-6);
    }
}
