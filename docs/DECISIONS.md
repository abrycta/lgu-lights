# Decisions

Decided 2026-10-21 by Kurt, after `ARCHITECTURE-RESEARCH.md`, `MODELING-PLAN.md`, `DATA-PLAN.md` and `OPEN-QUESTIONS.md`.

| # | Area | Decision |
|---|---|---|
| Q1 | Architecture | **B: hexagonal (ports and adapters) Rust core + CQRS-style materialised read models + Jamstack delivery + a Rust Cloudflare Worker API** (workers-rs + axum). Built as A first (static + browser WASM); the Worker is the third driving adapter. |
| Q2 | Rust scope | **Rust for everything that runs or is deployed** (core, CLI, WASM, Worker). **Python (and R for Fay-Herriot) allowed for offline training and Earth Engine access** in GitHub Actions; the Rust core executes the trained weights. |
| Q3 | Satellite processing | **Register Google Earth Engine now** (individual noncommercial, Community tier). Service-account key as a GitHub secret. exactextract in Actions stays as the cross-check. |
| Q4 | Label rounds | **VIIRS era 2012–2023 for models**; 2006/2009 shown as history only. |
| Q5 | Tiles and large files | **GitHub Pages primary, Hugging Face fallback; no R2.** |
| Q6 | Domain | **lgu.krtmtthw.dev** (Porkbun CNAME → Cloudflare Pages). API at **lgu-api.krtmtthw.dev** unless the zone moves to Cloudflare. |
| Q8 | Languages | **English + Japanese. No Filipino** (UI, narration or data labels). |
| Q7 | Narration | **Captions first**; browser speech where a voice exists; Kokoro-82M pre-rendered clips for EN/JA intros; **no MMS-TTS**. |
| Q10 | Before building | **1-day measurement spike first**; every `[U]` estimate is replaced by a measurement, and this file gets an addendum with the results. |
| Q9, Q11–Q15 | Defaults | Accepted as documented in OPEN-QUESTIONS.md (CV 10/20 % reliability tiers; what-if sliders labelled hypothetical; archivekit format proposals; proceed with PSA attribution and email PSA in parallel; no OSM covariates in the headline model; Zenodo DOI per data release). |

## Update 2026-10-21: single Rust implementation

Asked whether LGU Lights should also have multiple backends like Typhoon Replay: **no**. Keep one Rust core (Architecture B as decided above: CLI + browser WASM + Cloudflare Worker). No per-language reimplementations (they would break bit-identical numbers) and no language bindings (PyO3, Panama, etc.) for now. Bindings remain a possible later addition without changing the architecture.

## Spike results (2026-10-21)

The 1-day measurement spike (Q10) is in [SPIKE-RESULTS.md](SPIKE-RESULTS.md), and every performance or size **[U]** in ARCHITECTURE-RESEARCH.md now cites it. **Nothing in it threatens Architecture B.** Q1–Q15 stand, with these changes and additions:

| # | Change | Why (measured) |
|---|---|---|
| S1 | **PMTiles: z0–10 (not z0–12), with only value, tier and source per year (42 slots)**; intervals and radiance live in the per-LGU JSON. Tile geometry **once per boundary vintage**, then `tile-join` the attribute CSV per data version | z0–12 with 84 slots is 24.5 MB (estimate was 3–10). The recommended layout is 5.9 MB, 27 requests and 428 kB for a national → province → LGU session. Re-joining attributes takes 3–24 s against 7.5–8.5 min to re-tile |
| S2 | **Tile geometry from HDX COD-AB v03; geoBoundaries is a mirror only.** PSGC-10 = HDX pcode digits + `000`. The SGA crosswalk is manual: HDX has seven "Special Geographic Area – …" placeholder units, not the eight 2024 municipalities | geoBoundaries `9469f09` is pre-2024 (splits Manila into 14 districts, no SGA); HDX pcodes are `PH` + 7 digits |
| S3 | **NOAA-20 vegetation continuity (VJ113A1) comes from LAADS through exactextract**, like Black Marble; GEE covers S-NPP VNP13A1 and MODIS only. This needs a free **NASA Earthdata login** (token as a GitHub secret) in addition to GEE | VJ113A1 is not in the GEE catalog; LAADS file downloads redirect to login (303) |
| S4 | **Tree-ensemble oracle = LightGBM's own `predict()` (or onnxruntime) in CI**, compared by a Rust test against a fixture; tract remains the GRU oracle | tract 0.23.9 cannot translate `TreeEnsembleRegressor`; the GRU matches tract to 5.96e-7 |
| S5 | **What-if: per-LGU on the main thread and in the Worker; a whole-map recompute runs in a Web Worker (debounced) and never in the API**; `lgu-wasm` built at opt-level 3 (+ `simd128`), not z | one LGU 17 µs (WASM); all 1,640 take 41–62 ms in WASM, over one frame and over the Free plan's 10 ms CPU per request. Opt-level 3 is 1.7× faster than z |
| S6 | **`preconnect` to the tile and API origins**, and latency targets stated for warm connections | from PH: warm 36–50 ms p50 (Pages, GitHub Pages range, edge function); a fresh connection adds about 90 ms of TCP+TLS to Singapore (Cloudflare serves this connection from SIN) |
| S7 | **Wayback raw captures as a mirror tier for PSA in `sources.yaml`**; the 2023 SAE file `2_2023 SAE_with PSGC_noHUC_06Feb2026.xlsx` must be downloaded once by hand and archived | psa.gov.ph returns a Cloudflare challenge to curl and to headless Chromium |

Confirmed unchanged: Q5 (GitHub Pages primary: 206 + CORS, 36–43 ms warm per range; HF works, with 206 + CORS behind a 302, but costs 0.78–1.0 s per range from PH, so it stays fallback only); the Worker (3.46 MiB of the official, now verified, 64 MiB limit; 5 ms startup; ≈ 0.1 ms per request); and workers-rs 0.8.7 + axum 0.8.9 + wasm-bindgen 0.2.129 compiling cleanly. Still open: the GEE EECU cost of one year (needs registration, Q3).
