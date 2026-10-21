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

## Build notes (milestone 1, 2026-10-21)

Choices made while building where the documents were ambiguous or facts changed; each picks the documented default unless it says otherwise.

| # | Topic | Choice | Why |
|---|---|---|---|
| B1 | Years | Features for **2012–2025** (14 years, the S1 tile layout), labels for the five VIIRS-era rounds | VNP46A4 2024 and 2025 and MODIS 2025 exist, so the map has real nowcasts; the brief's 2012–2023 is the labelled span |
| B2 | Night lights source | **NASA Black Marble VNP46A4 only** (LAADS + exactextract) | `NOAA/VIIRS/DNB/ANNUAL_V22` on Earth Engine now lists only 2022–2025 (checked 2026-10-21), so the planned EOG primary cannot cover 2012–2021; EOG direct downloads are paid. Black Marble is the lights feature and the EOG comparison moves to a later milestone |
| B3 | Earth Engine content | MOD13Q1 NDVI and EVI (SummaryQA ≤ 1, yearly mean), WorldPop GP 100 m population (2012–2020; 2021–2025 carry 2020, flagged `pop_carried`), SRTM elevation and slope; polygons simplified at 0.0005° (≈ 55 m, a fifth of a MODIS pixel) and sent in three chunks | no assets or exports needed; three interactive `reduceRegions` pairs run concurrently |
| B4 | archivekit in CI | `archivekit` is in the `sources` dependency group. **`ARCHIVE_READ_TOKEN` does not exist yet**, so without it CI cannot install the private kit: `lgu inputs-direct` downloads the two HDX files straight from HDX and requires the registry's **sha256 pins** (the bytes archivekit validated locally), and labels come from the committed `pipeline/inputs/labels.parquet` (built locally from archivekit-fetched, archive-backed files). With the token, `lgu inputs` uses the full fallback chain. Remove `inputs-direct` once the token exists | the standard requires the kit; this keeps the run reproducible without copying kit code or uploading raw inputs anywhere |
| B5 | PSA 2023 workbook | Adopted the hand-downloaded file as the archivekit snapshot **`psa-sae-2023-2026-10-21`** in `abrycta/lgu-lights-archive` with `pipeline/tools/adopt_manual.py`, which runs the kit's own `snapshot()` (checks, hook, manifest, SHA256SUMS) with an in-memory transport serving the local bytes for the primary URL. The registry `pin` records the manual intake; the original `manual-psa-sae-2023-20261021` release is kept | the kit reads only `<id>-<YYYY-MM-DD>` tags |
| B6 | Label sheets | 2012 and 2015 from the per-round sheets of the "2018 - 2021" workbook (which also holds 2000–2018); 2018, 2021, 2023 from the 2023 Annex 1 (it publishes SE as well as CV and CI). The "2009, 2012 and 2015" workbook is redundant and not registered | fewer sources, same numbers |
| B7 | Crosswalk | PSA rows carry 6-digit pre-2021 codes. Match order: manual override (`pipeline/crosswalk/sae_overrides.csv`) → rule `PH + RR + 0PP + MM` with a name check → unique name in the province → unique name in the region (ARMM 15 → BARMM 19). The 2012/2015 sheets shift codes against names in Sorsogon and Surigao/Dinagat; such rows are re-matched by name inside the province, then the region, and dropped when ambiguous. Result: 2012 and 2015 1,624 LGUs, 2018/2021/2023 1,597 each. The **14 City of Manila districts are left out** (HDX has one ADM3 for Manila; no population weights to aggregate honestly); HUCs are not in SAE at all, so Manila and HUCs show model estimates only | honest: no averaging, no guessed matches; full report in `crosswalk-report.json` |
| B8 | Tiles host | **Cloudflare Pages answers Range requests with 200** (spike §2), so PMTiles cannot be served there. The site reads a static **z/x/y directory** (`tiles/{z}/{x}/{y}.pbf`, uncompressed MVT, ~750 files at z0–10, well under Pages' 20,000-file and 25 MiB limits; Cloudflare compresses `application/x-protobuf` at the edge). `lgu.pmtiles` is still built for Hugging Face (the fallback) | replaces "GitHub Pages primary" (Q5): the repo is private, and GitHub Pages on a private repo needs a paid plan |
| B9 | API origin | The future Worker API is **same-origin `/api/*` on the `lgu-lights` Pages project** (Pages Functions / a Worker bundled as the Pages Function, workers-rs as in the spike), as Typhoon Replay does | DNS stays at Porkbun, so a Worker custom domain such as `lgu-api.krtmtthw.dev` is not possible; replaces that part of Q6 |
| B10 | Model choice | **LightGBM on the change since the last PSA round** (MODELING-PLAN §4.4, "expected winner"), not the simpler linear mixed model: Kurt asked for the best honest results within the architecture. 19 features derived once in `lgu-core::features` (previous official value, gap, previous trend, estimator-change flag, province mean, PSA SE, Black Marble level and change, lit fraction, radiance per person, density, NDVI/EVI level and change, terrain, valid-pixel fraction); monotone constraints (more radiance growth or radiance per person never raises the estimate); five bagging seeds averaged; Huber or L2 loss and tree size chosen by tuning | trees predict changes well from a strong anchor; the anchor (last official value) is the honest nowcast baseline the model must beat |
| B11 | Tuning without leakage | For fold k, a 48-point grid is scored by inner forward-chaining inside its training rounds only (one seed while tuning); F1 has one training round and uses the defaults | the test round never influences its own model |
| B12 | Intervals | Split-conformal 50/90 % from absolute residuals the model made on rounds it had not seen (inner forward-chaining; 5-fold province-grouped CV when only one round is available), binned by quartiles of the previous official value; what-if intervals widened ×1.25 (Q11's "stated factor"). Model CV = (90 % half-width / 1.645) / estimate; tiers at 10/20 % (Q9) | coverage is reported per fold; intervals for 1-year gaps (2013, 2024…) are calibrated on 2–3-year gaps, so they are probably conservative; said in the method text |
| B13 | Backtests on the site | Round years show the official value on the map; the panel also shows the out-of-sample backtest from the fold model (2018 from F1, 2021 from F2, 2023 from F3). Non-round years before 2023 use the final model (`kind: between`), which has seen later rounds: labelled as retrospective model estimates | honest about what the model knew |
| B14 | Parity | Python trains on the Rust-written design matrix, parsed with `float_precision="round_trip"` (pandas' default parser is 1 ulp off and flipped a split: caught by the gate at 7e-2). Gate: every model on every design row, tolerance 1e-5; measured ~1e-13 | the core, not Python, is the source of truth for features |
| B15 | WASM interface | Raw C ABI (no wasm-bindgen): ~60 lines of JS in the worker, no extra toolchain; opt-level 3 per S5 | smaller and simpler than bindgen for eight functions |
| B16 | Data run trigger | `data.yml` has `workflow_dispatch`, which GitHub only offers once the file is on `main`; until then a run is requested on a branch by committing `.github/data-run.json` | the branch is not merged in M1 |
| B17 | Earthdata token expiry | `health.token_expires: 2026-12-20` tracks the Earthdata token (the earliest-expiring credential); keep the earliest date there once `ARCHIVE_READ_TOKEN` exists | the brief asked for it; the field holds one date |

### Results of the first full run (data version v1, run 39521059929, 2026-10-21)

Forward-chaining, scored on PSA's published estimates (percentage points; n ≈ 1,600 LGUs per round). The model is compared on the same rows with carrying the last official value forward ("carry"), carry plus the training-period drift ("drift"), and the same model without satellite features ("no-sat").

| Fold | Test | Model MAE | Carry | Drift | No-sat | Model R² | Spearman | 90 % coverage | Mean 90 % width | PSA mean 90 % CI width |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | 2018 | 8.34 | 8.13 | **7.48** | 8.15 | 0.65 | 0.90 | 0.65 | 19.0 | 8.1 |
| F2 | 2021 | 9.60 | **7.97** | 9.13 | 9.52 | −0.25 | 0.79 | 0.69 | 23.2 | 8.1 |
| F3 | 2023 | **5.57** | 6.33 | 5.89 | 5.62 | 0.55 | 0.83 | **0.95** | 30.1 | 7.5 |

What this says, plainly: on the 2023 nowcast (F3, the headline) the model beats carry-forward by 0.76 pp MAE (−12 %) with honest 90 % coverage, but **almost all of that comes from the PSA history (previous value, previous trend, province mean), not from satellites: removing every satellite feature costs only 0.05 pp**. Across the ELL → Census EB change (F2) the model is worse than carrying the 2018 value forward, and with only one or two training rounds (F1, F2) the conformal intervals under-cover (65–69 %). This matches the literature (MODELING-PLAN §1: changes are hard, lights saturate) and PSA's own 55.09 → 55.52 % adjusted-R² result. Model estimates therefore mostly land in the "unreliable" tier, which the site shows. The PSA label-noise floor (E|N(0, SE²)|) is about 1.8–2.0 pp.

Measured: parity of the Rust core with LightGBM over 21,154 design rows × 4 models, max |Δ| 3.7e-14 (tolerance 1e-5). Feature importance (gain) is led by `trend_prev`, `y_prev`, `era_cross`, `prov_prev_mean`.

Milestone-2 candidates from these numbers: model the estimator break explicitly (or train only within an era), a log-ratio target, Fay-Herriot with PSA SE (MODELING-PLAN §4.3), EOG lights as a second source, and intervals that depend on the gap length.

### Rename (2026-10-21)

The public name is **Lights**, at **lights.krtmtthw.dev** (Kurt's call: it reads better). `lgu.krtmtthw.dev` stays in DNS and the page sends visitors on to the new host (`web/public/host-redirect.js`), because DNS is at Porkbun and there is no edge redirect. Internal IDs keep `lgu`: repos, the Pages project `lgu-lights`, the Earth Engine project, the crates and the archive.
