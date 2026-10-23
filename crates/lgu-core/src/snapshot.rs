//! Binary panel snapshot (`snapshot.bin`), the read model the browser's what-if worker and the
//! Worker API load. Little-endian; values are the panel's f32-quantised numbers, so decoding is
//! lossless and every adapter derives identical features.
//!
//! ```text
//! "LGUS" | u32 version | u32 n_lgu | u32 n_prov | u32 n_years | u32 n_raw | u32 n_static | u32 n_rounds
//! | i32 first_year | u32 ids[n_lgu] | u32 province[n_lgu] | u32 provinces[n_prov]
//! | f32 raw[n_lgu * n_years * n_raw] | f32 statics[n_lgu * n_static] | f32 officials[n_lgu * n_rounds * 2]
//! | f32 prov_fies[n_prov * n_rounds]                         (version 2, model v3; NaN = unknown)
//! ```
//! Version 1 (data v1, v2: five rounds 2012-2023, no provincial FIES) is still read.

use crate::panel::{N_RAW, N_STATIC, Official, Panel, ROUNDS};

const MAGIC: &[u8; 4] = b"LGUS";
const VERSION: u32 = 2;

pub fn encode(p: &Panel) -> Vec<u8> {
    let n = p.len();
    let mut out =
        Vec::with_capacity(40 + n * (8 + 4 * (p.n_years * N_RAW + N_STATIC + ROUNDS.len() * 2)));
    out.extend_from_slice(MAGIC);
    for v in [
        VERSION,
        n as u32,
        p.provinces.len() as u32,
        p.n_years as u32,
        N_RAW as u32,
        N_STATIC as u32,
        ROUNDS.len() as u32,
    ] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&p.first_year.to_le_bytes());
    for v in p.ids.iter().chain(&p.province).chain(&p.provinces) {
        out.extend_from_slice(&v.to_le_bytes());
    }
    for v in p.raw.iter().chain(&p.statics) {
        out.extend_from_slice(&(*v as f32).to_le_bytes());
    }
    for o in &p.officials {
        out.extend_from_slice(&(o.estimate as f32).to_le_bytes());
        out.extend_from_slice(&(o.se as f32).to_le_bytes());
    }
    for k in 0..p.provinces.len() * ROUNDS.len() {
        let v = p.prov_fies.get(k).copied().unwrap_or(f64::NAN);
        out.extend_from_slice(&(v as f32).to_le_bytes());
    }
    out
}

struct Reader<'a> {
    b: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn take(&mut self, n: usize) -> Result<&[u8], String> {
        let s = self
            .b
            .get(self.at..self.at + n)
            .ok_or("snapshot truncated")?;
        self.at += n;
        Ok(s)
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn f32(&mut self) -> Result<f64, String> {
        Ok(f32::from_le_bytes(self.take(4)?.try_into().unwrap()) as f64)
    }
}

pub fn decode(b: &[u8]) -> Result<Panel, String> {
    let mut r = Reader { b, at: 0 };
    if r.take(4)? != MAGIC {
        return Err("not a Lights snapshot".into());
    }
    let version = r.u32()?;
    if version != 1 && version != VERSION {
        return Err("unsupported snapshot version".into());
    }
    let n = r.u32()? as usize;
    let np = r.u32()? as usize;
    let shape = [
        r.u32()? as usize,
        r.u32()? as usize,
        r.u32()? as usize,
        r.u32()? as usize,
    ];
    // Older data versions still work with this build (rollback, and the site serves several versions):
    // version 1 snapshots (before model v3) carry the five rounds 2012-2023 only, read with the earlier
    // rounds empty; a version 2 snapshot written before a round was added to config/rounds.json carries the
    // first `k` rounds, read with the later rounds empty.
    let k = shape[3];
    let skip = match version {
        1 => ROUNDS
            .iter()
            .position(|&y| y == 2012)
            .filter(|&s| s + k == ROUNDS.len()),
        _ => (k <= ROUNDS.len()).then_some(0),
    }
    .ok_or("snapshot rounds differ from this build of lgu-core")?;
    // The feature years are the snapshot's own (header); only the field layout must match this build.
    let n_years = shape[0];
    let first_year = r.u32()? as i32;
    if shape[1..3] != [N_RAW, N_STATIC] || n_years == 0 {
        return Err("snapshot layout differs from this build of lgu-core".into());
    }
    let ids = (0..n).map(|_| r.u32()).collect::<Result<_, _>>()?;
    let province = (0..n).map(|_| r.u32()).collect::<Result<_, _>>()?;
    let provinces = (0..np).map(|_| r.u32()).collect::<Result<_, _>>()?;
    let raw = (0..n * n_years * N_RAW)
        .map(|_| r.f32())
        .collect::<Result<_, _>>()?;
    let statics = (0..n * N_STATIC)
        .map(|_| r.f32())
        .collect::<Result<_, _>>()?;
    let mut officials = vec![Official::NONE; n * ROUNDS.len()];
    for i in 0..n {
        for j in skip..skip + k {
            officials[i * ROUNDS.len() + j] = Official {
                estimate: r.f32()?,
                se: r.f32()?,
            };
        }
    }
    let prov_fies = if version >= 2 {
        let mut v = vec![f64::NAN; np * ROUNDS.len()];
        for p in 0..np {
            for j in 0..k {
                v[p * ROUNDS.len() + j] = r.f32()?;
            }
        }
        v
    } else {
        Vec::new()
    };
    let p = Panel {
        first_year,
        n_years,
        ids,
        province,
        provinces,
        raw,
        statics,
        officials,
        prov_fies,
    };
    if r.at != b.len() {
        return Err("trailing bytes after the snapshot".into());
    }
    if p.province.iter().any(|&x| x as usize >= np) || !p.ids.windows(2).all(|w| w[0] < w[1]) {
        return Err("snapshot index is inconsistent".into());
    }
    Ok(p)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::{row, tests::tiny_panel};

    #[test]
    fn roundtrip_is_lossless_and_features_identical() {
        let p = tiny_panel();
        let q = decode(&encode(&p)).unwrap();
        assert_eq!(p.ids, q.ids);
        let (pm, qm) = (p.province_stats(), q.province_stats());
        for i in 0..p.len() {
            for t in p.first_year + 1..=p.last_year() {
                if let Some(r) = p.prev_round(i, t) {
                    let (a, b) = (row(&p, &pm, i, t, r), row(&q, &qm, i, t, r));
                    assert!(
                        a.iter()
                            .zip(&b)
                            .all(|(x, y)| x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()))
                    );
                }
            }
        }
    }

    #[test]
    fn reads_a_pre_v3_snapshot_with_five_rounds() {
        let p = tiny_panel();
        let mut b = encode(&p);
        // rewrite as the v1/v2 layout: n_rounds = 5, officials for 2012-2023 only
        let n = p.len();
        b.truncate(b.len() - p.provinces.len() * ROUNDS.len() * 4); // drop the version-2 FIES section
        let off_at = b.len() - n * ROUNDS.len() * 8;
        let mut tail = Vec::new();
        for i in 0..n {
            let s = off_at + (i * ROUNDS.len() + 2) * 8;
            tail.extend_from_slice(&b[s..s + 5 * 8]);
        }
        b.truncate(off_at);
        b.extend_from_slice(&tail);
        b[28..32].copy_from_slice(&5u32.to_le_bytes());
        b[4..8].copy_from_slice(&1u32.to_le_bytes()); // version 1: no provincial FIES section
        let q = decode(&b).unwrap();
        for i in 0..n {
            assert!(!q.official(i, 0).is_some() && !q.official(i, 1).is_some());
            for k in 2..ROUNDS.len() {
                let (a, c) = (p.official(i, k), q.official(i, k));
                assert!(
                    a.estimate.to_bits() == c.estimate.to_bits()
                        || (a.estimate.is_nan() && c.estimate.is_nan())
                );
            }
        }
    }

    #[test]
    fn years_come_from_the_snapshot_and_missing_later_rounds_read_empty() {
        // a panel with one more feature year than the tiny panel, written with one round fewer (as a
        // snapshot from before a round was added to config/rounds.json)
        let mut p = Panel::new(2012, 2026);
        let raw = vec![1.0; p.n_years * N_RAW];
        let offs: Vec<Official> = (0..ROUNDS.len())
            .map(|k| Official {
                estimate: 10.0 + k as f64,
                se: 1.0,
            })
            .collect();
        p.push(100, 1, &raw, &[1.0; N_STATIC], &offs);
        let full = encode(&p);
        let q = decode(&full).unwrap();
        assert_eq!(
            (q.first_year, q.last_year(), q.year_index(2026)),
            (2012, 2026, Some(14))
        );
        let nr = ROUNDS.len();
        let mut b = full[..full.len() - 4 * nr].to_vec(); // provincial FIES: drop all, re-add nr - 1
        b.truncate(b.len() - 8); // the last round's official of the one LGU
        b.extend(std::iter::repeat_n(f32::NAN.to_le_bytes(), nr - 1).flatten());
        b[28..32].copy_from_slice(&((nr - 1) as u32).to_le_bytes());
        let q = decode(&b).unwrap();
        assert!((0..nr - 1).all(|k| q.official(0, k).estimate == 10.0 + k as f64));
        assert!(!q.official(0, nr - 1).is_some());
    }

    #[test]
    fn rejects_truncated_input() {
        let b = encode(&tiny_panel());
        assert!(decode(&b[..b.len() - 1]).is_err());
        assert!(decode(b"nope").is_err());
    }
}
