//! The LGU panel: raw yearly zonal statistics, static context and PSA official estimates.
//!
//! Every stored value is quantised to `f32` once, when the panel is built (`Panel::push`), so the CLI
//! (reading Parquet), the browser (reading the binary snapshot) and the Worker derive bit-identical
//! features from the same numbers. Arithmetic is `f64`.

/// First and last feature year (inclusive). 14 years, the S1 tile layout.
pub const FIRST_YEAR: i32 = 2012;
pub const LAST_YEAR: i32 = 2025;
pub const N_YEARS: usize = (LAST_YEAR - FIRST_YEAR + 1) as usize;

/// PSA Small Area Estimate rounds of the VIIRS era (DECISIONS Q4).
pub const ROUNDS: [i32; 5] = [2012, 2015, 2018, 2021, 2023];

/// Raw yearly inputs per LGU, in this order in the snapshot.
pub const RAW_FIELDS: [&str; 7] = [
    "bm_mean",
    "bm_sum",
    "bm_lit_frac",
    "bm_valid_frac",
    "ndvi_mean",
    "evi_mean",
    "pop",
];
pub const N_RAW: usize = RAW_FIELDS.len();

pub const BM_MEAN: usize = 0;
pub const BM_SUM: usize = 1;
pub const BM_LIT: usize = 2;
pub const BM_VALID: usize = 3;
pub const NDVI: usize = 4;
pub const EVI: usize = 5;
pub const POP: usize = 6;

/// Static context per LGU.
pub const STATIC_FIELDS: [&str; 3] = ["area_km2", "elev_mean", "slope_mean"];
pub const N_STATIC: usize = STATIC_FIELDS.len();

#[inline]
pub fn q(x: f64) -> f64 {
    (x as f32) as f64
}

pub fn year_index(year: i32) -> Option<usize> {
    (FIRST_YEAR..=LAST_YEAR)
        .contains(&year)
        .then(|| (year - FIRST_YEAR) as usize)
}

pub fn round_index(year: i32) -> Option<usize> {
    ROUNDS.iter().position(|&r| r == year)
}

/// One PSA official estimate (poverty incidence, percent).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Official {
    pub estimate: f64,
    pub se: f64,
}

impl Official {
    pub const NONE: Official = Official {
        estimate: f64::NAN,
        se: f64::NAN,
    };
    pub fn is_some(&self) -> bool {
        self.estimate.is_finite()
    }
}

/// Column-oriented panel of all LGUs.
#[derive(Clone, Debug, Default)]
pub struct Panel {
    /// HDX pcode digits as an integer (PH0102801 -> 102801); sorted ascending.
    pub ids: Vec<u32>,
    /// Province index per LGU (into `provinces`).
    pub province: Vec<u32>,
    pub provinces: Vec<u32>,
    /// `[lgu][year][field]`, flattened.
    pub raw: Vec<f64>,
    /// `[lgu][field]`, flattened.
    pub statics: Vec<f64>,
    /// `[lgu][round]`, flattened.
    pub officials: Vec<Official>,
}

impl Panel {
    pub fn len(&self) -> usize {
        self.ids.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ids.is_empty()
    }

    /// Append one LGU; values are quantised to f32 here (see the module docs).
    pub fn push(
        &mut self,
        id: u32,
        province_id: u32,
        raw: &[f64],
        statics: &[f64],
        officials: &[Official],
    ) {
        assert_eq!(raw.len(), N_YEARS * N_RAW);
        assert_eq!(statics.len(), N_STATIC);
        assert_eq!(officials.len(), ROUNDS.len());
        let p = match self.provinces.iter().position(|&x| x == province_id) {
            Some(p) => p,
            None => {
                self.provinces.push(province_id);
                self.provinces.len() - 1
            }
        };
        self.ids.push(id);
        self.province.push(p as u32);
        self.raw.extend(raw.iter().map(|&x| q(x)));
        self.statics.extend(statics.iter().map(|&x| q(x)));
        self.officials.extend(officials.iter().map(|o| Official {
            estimate: q(o.estimate),
            se: q(o.se),
        }));
    }

    pub fn index_of(&self, id: u32) -> Option<usize> {
        self.ids.binary_search(&id).ok()
    }

    #[inline]
    pub fn raw(&self, lgu: usize, year_idx: usize, field: usize) -> f64 {
        self.raw[(lgu * N_YEARS + year_idx) * N_RAW + field]
    }

    pub fn raw_year(&self, lgu: usize, year_idx: usize) -> &[f64] {
        let s = (lgu * N_YEARS + year_idx) * N_RAW;
        &self.raw[s..s + N_RAW]
    }

    #[inline]
    pub fn stat(&self, lgu: usize, field: usize) -> f64 {
        self.statics[lgu * N_STATIC + field]
    }

    #[inline]
    pub fn official(&self, lgu: usize, round_idx: usize) -> Official {
        self.officials[lgu * ROUNDS.len() + round_idx]
    }

    /// The latest round strictly before `year` with an official estimate for this LGU.
    pub fn prev_round(&self, lgu: usize, year: i32) -> Option<usize> {
        (0..ROUNDS.len())
            .rev()
            .find(|&r| ROUNDS[r] < year && self.official(lgu, r).is_some())
    }

    /// Mean official estimate per (province, round) over LGUs with an estimate; NaN if none.
    pub fn province_round_means(&self) -> Vec<f64> {
        let np = self.provinces.len();
        let mut sum = vec![0.0f64; np * ROUNDS.len()];
        let mut n = vec![0u32; np * ROUNDS.len()];
        for i in 0..self.len() {
            let p = self.province[i] as usize;
            for r in 0..ROUNDS.len() {
                let o = self.official(i, r);
                if o.is_some() {
                    sum[p * ROUNDS.len() + r] += o.estimate;
                    n[p * ROUNDS.len() + r] += 1;
                }
            }
        }
        sum.iter()
            .zip(&n)
            .map(|(s, &k)| if k > 0 { q(s / k as f64) } else { f64::NAN })
            .collect()
    }
}
