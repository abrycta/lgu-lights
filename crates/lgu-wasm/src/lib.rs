//! Browser driving adapter: the what-if module, run inside a Web Worker (spike S5: a whole-map
//! recompute takes ~41 ms in WASM, so it never runs on the main thread).
//!
//! A raw C ABI instead of wasm-bindgen keeps the module small and the toolchain to `cargo` alone
//! (web/src/whatif/ has the ~60-line JS side). All state lives in one `static`, the module is
//! single-threaded, and every call returns a status code (0 = ok).
//!
//! ```text
//! alloc(len) -> ptr                      dealloc(ptr, len)
//! load_snapshot(ptr, len) -> status      load_model(ptr, len) -> status
//! n_lgus() -> u32                        lgu_index(id) -> i32 (-1 = unknown; id = pcode digits)
//! estimate(i, year) -> status            whatif(i, year, growth_pct, ndvi_delta) -> status
//!     both write [value, lo50, hi50, lo90, hi90, cv, tier, prev_year] to out_ptr() (8 x f64)
//! whatif_all(year, growth_pct, ndvi_delta) -> status
//!     writes n_lgus() f32 values (NaN = no estimate) to all_ptr() and tiers (u8, 255 = none) to tiers_ptr()
//! ```

#![allow(clippy::missing_safety_doc)]

use std::cell::RefCell;

use lgu_core::model::{Estimate, Model};
use lgu_core::panel::Panel;
use lgu_core::snapshot;
use lgu_core::whatif::{Scenario, whatif as run_whatif};

#[derive(Default)]
struct State {
    panel: Option<Panel>,
    prov_means: Vec<f64>,
    model: Option<Model>,
    out: [f64; 8],
    all: Vec<f32>,
    tiers: Vec<u8>,
}

thread_local! {
    static STATE: RefCell<State> = RefCell::new(State::default());
}

const OK: i32 = 0;
const E_INPUT: i32 = 1;
const E_NOT_LOADED: i32 = 2;
const E_NO_ESTIMATE: i32 = 3;

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { drop(Vec::from_raw_parts(ptr, 0, len)) };
}

unsafe fn bytes<'a>(ptr: *const u8, len: usize) -> &'a [u8] {
    unsafe { std::slice::from_raw_parts(ptr, len) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn load_snapshot(ptr: *const u8, len: usize) -> i32 {
    match snapshot::decode(unsafe { bytes(ptr, len) }) {
        Ok(p) => STATE.with_borrow_mut(|s| {
            s.prov_means = p.province_round_means();
            s.all = vec![f32::NAN; p.len()];
            s.tiers = vec![255; p.len()];
            s.panel = Some(p);
            OK
        }),
        Err(_) => E_INPUT,
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn load_model(ptr: *const u8, len: usize) -> i32 {
    let Ok(text) = std::str::from_utf8(unsafe { bytes(ptr, len) }) else {
        return E_INPUT;
    };
    match Model::from_json(text) {
        Ok(m) => STATE.with_borrow_mut(|s| {
            s.model = Some(m);
            OK
        }),
        Err(_) => E_INPUT,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn n_lgus() -> u32 {
    STATE.with_borrow(|s| s.panel.as_ref().map_or(0, |p| p.len() as u32))
}

#[unsafe(no_mangle)]
pub extern "C" fn lgu_index(id: u32) -> i32 {
    STATE.with_borrow(|s| {
        s.panel
            .as_ref()
            .and_then(|p| p.index_of(id))
            .map_or(-1, |i| i as i32)
    })
}

fn write_out(s: &mut State, e: Option<Estimate>) -> i32 {
    match e {
        Some(e) => {
            s.out = [
                e.value,
                e.lo50,
                e.hi50,
                e.lo90,
                e.hi90,
                e.cv,
                e.tier as u8 as f64,
                f64::from(e.prev_year),
            ];
            OK
        }
        None => E_NO_ESTIMATE,
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn estimate(i: u32, year: i32) -> i32 {
    STATE.with_borrow_mut(|s| {
        let (Some(p), Some(m)) = (s.panel.as_ref(), s.model.as_ref()) else {
            return E_NOT_LOADED;
        };
        if i as usize >= p.len() {
            return E_INPUT;
        }
        let e = m.estimate(p, &s.prov_means, i as usize, year);
        write_out(s, e)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn whatif(i: u32, year: i32, growth_pct: f64, ndvi_delta: f64) -> i32 {
    STATE.with_borrow_mut(|s| {
        let (Some(p), Some(m)) = (s.panel.as_ref(), s.model.as_ref()) else {
            return E_NOT_LOADED;
        };
        if i as usize >= p.len() {
            return E_INPUT;
        }
        let sc = Scenario {
            radiance_growth_pct: growth_pct,
            ndvi_delta,
        };
        let e = run_whatif(m, p, &s.prov_means, i as usize, year, sc);
        write_out(s, e)
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn whatif_all(year: i32, growth_pct: f64, ndvi_delta: f64) -> i32 {
    STATE.with_borrow_mut(|s| {
        let State {
            panel,
            prov_means,
            model,
            all,
            tiers,
            ..
        } = s;
        let (Some(p), Some(m)) = (panel.as_ref(), model.as_ref()) else {
            return E_NOT_LOADED;
        };
        let sc = Scenario {
            radiance_growth_pct: growth_pct,
            ndvi_delta,
        };
        for i in 0..p.len() {
            match run_whatif(m, p, prov_means, i, year, sc) {
                Some(e) => {
                    all[i] = e.value as f32;
                    tiers[i] = e.tier as u8;
                }
                None => {
                    all[i] = f32::NAN;
                    tiers[i] = 255;
                }
            }
        }
        OK
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn out_ptr() -> *const f64 {
    STATE.with_borrow(|s| s.out.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn all_ptr() -> *const f32 {
    STATE.with_borrow(|s| s.all.as_ptr())
}

#[unsafe(no_mangle)]
pub extern "C" fn tiers_ptr() -> *const u8 {
    STATE.with_borrow(|s| s.tiers.as_ptr())
}
