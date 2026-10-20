//! Spike: workers-rs + axum Worker serving /v1/lgu/{psgc} from an embedded ~3 MB snapshot,
//! plus a GRU nowcast computed per request by the shared spike-infer core.
use axum::{Json, Router, extract::Path, http::StatusCode, routing::get};
use serde::Serialize;
use spike_infer::{Gru, I, SEQ};
use std::sync::OnceLock;
use tower_service::Service;
use worker::*;

static SNAPSHOT: &[u8] = include_bytes!("../snapshot.bin");
static GRU_BYTES: &[u8] = include_bytes!("../../rust/fixtures/gru.bin");
const YEARS: usize = 14;

struct Snap {
    psgc: Vec<u64>,
    est: Vec<f32>,  // [n][14][4]
    feat: Vec<f32>, // [n][14][30]
    gru: Gru,
}
static SNAP: OnceLock<Snap> = OnceLock::new();

fn snap() -> &'static Snap {
    SNAP.get_or_init(|| {
        let n = u32::from_le_bytes(SNAPSHOT[0..4].try_into().unwrap()) as usize;
        let mut o = 4;
        let psgc = SNAPSHOT[o..o + 8 * n].chunks_exact(8).map(|c| u64::from_le_bytes(c.try_into().unwrap())).collect();
        o += 8 * n;
        let est = spike_infer::f32_vec(&SNAPSHOT[o..o + 4 * n * YEARS * 4]);
        o += 4 * n * YEARS * 4;
        let feat = spike_infer::f32_vec(&SNAPSHOT[o..o + 4 * n * SEQ * I]);
        Snap { psgc, est, feat, gru: Gru::from_bytes(GRU_BYTES) }
    })
}

#[derive(Serialize)]
struct Year { year: u16, estimate: f32, lo: f32, hi: f32, tier: u8 }
#[derive(Serialize)]
struct Lgu { psgc: String, years: Vec<Year>, nowcast: f32 }

async fn lgu(Path(code): Path<String>) -> std::result::Result<Json<Lgu>, (StatusCode, &'static str)> {
    let s = snap();
    let key: u64 = code.parse().map_err(|_| (StatusCode::BAD_REQUEST, "psgc must be 10 digits"))?;
    let i = s.psgc.binary_search(&key).map_err(|_| (StatusCode::NOT_FOUND, "unknown psgc"))?;
    let e = &s.est[i * YEARS * 4..(i + 1) * YEARS * 4];
    let years = (0..YEARS)
        .map(|y| Year { year: 2012 + y as u16, estimate: e[y * 4], lo: e[y * 4 + 1], hi: e[y * 4 + 2], tier: e[y * 4 + 3] as u8 })
        .collect();
    let nowcast = s.gru.forward(&s.feat[i * SEQ * I..(i + 1) * SEQ * I]);
    Ok(Json(Lgu { psgc: format!("{key:010}"), years, nowcast }))
}

fn router() -> Router {
    Router::new()
        .route("/v1/healthz", get(|| async { "ok" }))
        .route("/v1/lgu/{psgc}", get(lgu))
}

#[event(fetch)]
async fn fetch(req: HttpRequest, _env: Env, _ctx: Context) -> Result<axum::http::Response<axum::body::Body>> {
    Ok(router().call(req).await?)
}
