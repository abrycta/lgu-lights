//! Binary panel snapshot (`snapshot.bin`), the read model the browser's what-if worker and the
//! Worker API load. Little-endian; values are the panel's f32-quantised numbers, so decoding is
//! lossless and every adapter derives identical features.
//!
//! ```text
//! "LGUS" | u32 version | u32 n_lgu | u32 n_prov | u32 n_years | u32 n_raw | u32 n_static | u32 n_rounds
//! | i32 first_year | u32 ids[n_lgu] | u32 province[n_lgu] | u32 provinces[n_prov]
//! | f32 raw[n_lgu * n_years * n_raw] | f32 statics[n_lgu * n_static] | f32 officials[n_lgu * n_rounds * 2]
//! ```

use crate::panel::{FIRST_YEAR, N_RAW, N_STATIC, N_YEARS, Official, Panel, ROUNDS};

const MAGIC: &[u8; 4] = b"LGUS";
const VERSION: u32 = 1;

pub fn encode(p: &Panel) -> Vec<u8> {
    let n = p.len();
    let mut out =
        Vec::with_capacity(40 + n * (8 + 4 * (N_YEARS * N_RAW + N_STATIC + ROUNDS.len() * 2)));
    out.extend_from_slice(MAGIC);
    for v in [
        VERSION,
        n as u32,
        p.provinces.len() as u32,
        N_YEARS as u32,
        N_RAW as u32,
        N_STATIC as u32,
        ROUNDS.len() as u32,
    ] {
        out.extend_from_slice(&v.to_le_bytes());
    }
    out.extend_from_slice(&FIRST_YEAR.to_le_bytes());
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
        return Err("not an LGU Lights snapshot".into());
    }
    if r.u32()? != VERSION {
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
    if shape != [N_YEARS, N_RAW, N_STATIC, ROUNDS.len()] || r.u32()? as i32 != FIRST_YEAR {
        return Err("snapshot layout differs from this build of lgu-core".into());
    }
    let ids = (0..n).map(|_| r.u32()).collect::<Result<_, _>>()?;
    let province = (0..n).map(|_| r.u32()).collect::<Result<_, _>>()?;
    let provinces = (0..np).map(|_| r.u32()).collect::<Result<_, _>>()?;
    let raw = (0..n * N_YEARS * N_RAW)
        .map(|_| r.f32())
        .collect::<Result<_, _>>()?;
    let statics = (0..n * N_STATIC)
        .map(|_| r.f32())
        .collect::<Result<_, _>>()?;
    let officials = (0..n * ROUNDS.len())
        .map(|_| {
            Ok(Official {
                estimate: r.f32()?,
                se: r.f32()?,
            })
        })
        .collect::<Result<_, String>>()?;
    let p = Panel {
        ids,
        province,
        provinces,
        raw,
        statics,
        officials,
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
        let (pm, qm) = (p.province_round_means(), q.province_round_means());
        for i in 0..p.len() {
            for t in 2013..=2025 {
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
    fn rejects_truncated_input() {
        let b = encode(&tiny_panel());
        assert!(decode(&b[..b.len() - 1]).is_err());
        assert!(decode(b"nope").is_err());
    }
}
