//! # lgu-core: the application hexagon of LGU Lights
//!
//! Pure functions over in-memory data: no I/O, no async, no allocation in the hot path. Driven by
//! three adapters (CLI in GitHub Actions, WASM in the browser, later a Cloudflare Worker), so the
//! number on the map, under the what-if slider and from the API is computed by the same code.
//!
//! * [`panel`]: the LGU panel (raw zonal statistics, static context, PSA official estimates)
//! * [`features`]: the one feature-derivation implementation (training reads its output)
//! * [`forest`]: LightGBM tree-ensemble evaluator, parity-tested against LightGBM
//! * [`model`]: model artefact, conformal intervals, CV and tiers
//! * [`whatif`]: hypothetical scenarios
//! * [`snapshot`]: the binary panel the browser and the Worker load
//! * [`tiers`]: reliability tiers and fixed classification breaks

pub mod features;
pub mod forest;
pub mod model;
pub mod panel;
pub mod snapshot;
pub mod tiers;
pub mod whatif;
