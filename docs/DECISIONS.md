# Decisions

Decided 2026-10-21 by Kurt, after `ARCHITECTURE-RESEARCH.md`, `MODELING-PLAN.md`, `DATA-PLAN.md` and `OPEN-QUESTIONS.md`.

| # | Area | Decision |
|---|---|---|
| Q1 | Architecture | **B: hexagonal (ports and adapters) Rust core + CQRS-style materialised read models + Jamstack delivery + a Rust Cloudflare Worker API** (workers-rs + axum). Built as A first (static + browser WASM); the Worker is the third driving adapter. |
| Q2 | Rust scope | **Rust for everything that runs or is deployed** (core, CLI, WASM, Worker). **Python (and R for Fay-Herriot) allowed for offline training and Earth Engine access** in GitHub Actions; the Rust core executes the trained weights. |
| Q3 | Satellite processing | **Register Google Earth Engine now** (individual noncommercial, Community tier). Service-account key as a GitHub secret. exactextract in Actions stays as the cross-check. |
| Q4 | Label rounds | **VIIRS era 2012–2023 for models**; 2006/2009 shown as history only. *Changed in v3 (2026-10-21): 2006 and 2009 are training rounds too; see "v3 enhancement".* |
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

## v2 enhancement (data version v2, run 39571434610, 2026-10-21)

Kurt asked to tune the data and the model for accuracy and reliability, stated as an enhancement. **What changed: one thing, the training target.** The features, the Rust core, the snapshot, `model.json` and the read-model contract are unchanged, and data version v2 is trained on the v1 feature store (`features-v1`; `data.yml` gained `features_from` for that).

### What the v1 numbers were hiding

Splitting each fold's error into a shared provincial part and the rest:

- **Most of the change between two PSA rounds is shared by a whole province**: the province means explain 47 % (2015), 76 % (2018), 84 % (2021) and 66 % (2023) of the variance of LGU changes.
- **That provincial shift is not predictable from these inputs.** Its correlation with the province's previous level, previous trend, population growth or night-light growth changes size and sign from round to round (for example population growth −0.61 in 2018, +0.40 in 2021; light growth +0.05 to +0.20, the "wrong" sign, every round). The national part alone was −5.2 pp (2015 → 2018), +0.2 pp (2018 → 2021) and −3.3 pp (2021 → 2023).
- **What is left after removing each province's mean error is small and stable**: about 3 pp MAE for every method, close to PSA's own uncertainty (mean SE 2.3–3.3 pp). Inside a province, places move back towards the province (correlation of the change with the distance from the province mean −0.42 to −0.62 in every round) and a previous rise tends to reverse (−0.19 to −0.61).

v1's trees, fitted on the raw change, learned each training round's provincial shifts from features that happened to line up with them and applied them to the next round. That is why F2 (2018 → 2021, across the ELL → Census EB change and COVID) was worse than carrying the 2018 value forward.

### The change

The target is now **the LGU's change minus the mean change of its province in the same transition** (`train.within_target`). The model learns only how a place moves relative to its province and otherwise carries the province's level forward. The estimate is still `clamp(official_r + forest(x), 0, 100)`. Tuning (same grid, same inner forward-chaining) is scored on the within-province RMSE (`train.within_rmse`), because the provincial shift of an inner test round is the same for every configuration and only adds noise to the ranking. Intervals are calibrated as before (B12). `metrics.json` gains `bias`, `mae_within_province` and the tier shares per fold (`tier_reliable`, `tier_caution`, `tier_unreliable`).

### Before and after (forward-chaining, same rows and baselines as v1)

| Fold | Test | Version | Model MAE | Carry | Drift | No-sat | Model R² | Spearman | 90 % coverage | 50 % coverage | Mean 90 % width | PSA mean 90 % CI width |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | 2018 | v1 | 8.34 | 8.13 | **7.48** | 8.15 | 0.65 | 0.90 | 0.65 | 0.21 | 19.0 | 8.1 |
| F1 | 2018 | v2 | 8.04 | 8.13 | **7.48** | 8.08 | 0.68 | 0.91 | 0.66 | 0.23 | 19.5 | 8.1 |
| F2 | 2021 | v1 | 9.60 | **7.97** | 9.13 | 9.52 | −0.25 | 0.79 | 0.69 | 0.40 | 23.2 | 8.1 |
| F2 | 2021 | v2 | **7.53** | 7.97 | 9.13 | 7.51 | 0.13 | 0.79 | 0.83 | 0.55 | 25.4 | 8.1 |
| F3 | 2023 | v1 | **5.57** | 6.33 | 5.89 | 5.62 | 0.55 | 0.83 | 0.95 | 0.71 | 30.1 | 7.5 |
| F3 | 2023 | v2 | 5.98 | 6.33 | 5.89 | 6.04 | 0.54 | 0.83 | 0.95 | 0.66 | 28.5 | 7.5 |

Plainly:

- **v2 beats carry-forward in every fold** (−0.09, −0.44, −0.35 pp); v1 beat it only in F3. The mean MAE over the three folds falls from 7.84 to 7.18 pp.
- **F3 (the 2023 headline) gets worse: 5.57 → 5.98 pp**, and R² 0.55 → 0.54. v1's F3 result came largely from guessing the national decline; v2 does not bet on the national direction. **Drift beats v2 in F1 and F3**, the two periods in which poverty fell, and loses badly in F2 (9.13).
- **F2 improves by 2.07 pp** and its R² turns positive (−0.25 → 0.13). F2 Spearman is slightly lower (0.794 → 0.786).
- **The predicted change now points the right way**: the correlation between predicted and actual change is 0.31, 0.43 and 0.37 (v1: −0.02, −0.29, 0.26).
- **Coverage**: F2 rises from 0.69 to 0.83 with intervals 2.2 pp wider; F3 stays at 0.95 with intervals 1.6 pp narrower. **F1 is still under-covered (0.66)**: a model calibrated on one round (2012 → 2015, national change −1.3 pp) cannot know that the next round's provincial shifts will be larger (−5.2 pp nationally). No interval method tried here fixes that without inventing a number. The 2018 backtest on the site comes from this F1 model.
- **Satellites still add little**: without them v2 is 0.04 pp worse in F1, 0.02 pp better in F2 and 0.06 pp worse in F3.
- **Reliability tiers** (share of model estimates in the published estimates table, all years and kinds): v1 0 % reliable, 3.9 % use with caution, 96.1 % unreliable; v2 0 %, 4.3 %, 95.7 %. In the test folds: F1 0/39/61 %, F2 0/3/97 %, F3 0/0/100 %. F1's "use with caution" share comes from its too-narrow intervals, so it is not earned. Mean 90 % width of all model estimates: backtest 23.9 → 24.2, between 31.3 → 29.1, nowcast 26.9 → 25.1 pp.
- **Parity**: Rust core vs LightGBM over 21,154 design rows × 4 models, max |Δ| 4.8e-14 (tolerance 1e-5). The read models keep the v1 layout and fields (`manifest.json`, `index.json`, `lgu/`, `tiles/`, `whatif/`; `snapshot.bin` is byte-identical); `metrics.json` only gains fields, and `tuning_top5[].rmse` is now `within_rmse`.

How the design was chosen, honestly: the decomposition above and the screening below used all four transitions, including 2023, so the choice of target is not a nested out-of-sample result. It was not picked for its F3 score: it is worse on F3 than v1. It was picked because the within-province part improves on its own baseline in every fold, for every option for the provincial part. Inside each fold, the hyper-parameters and the calibration still see only that fold's training rounds.

### Tried and not kept

Screening runs with default hyper-parameters (no tuning), no monotone constraints unless noted, two to five seeds, MAE for F1/F2/F3 (so the numbers differ slightly from the tuned table above):

| Idea | Result | Kept? |
|---|---|---|
| Provincial part = drift (training-period mean change per year × gap) instead of carry | 7.36 / 8.60 / 5.52: beats drift in every fold but loses to carry in F2 by 0.6 pp, the v1 failure in smaller form | no |
| Provincial part = province mean reversion (fitted on training rounds), with or without drift | 8.27 / 7.04 / 6.19 and 7.50 / 8.07 / 5.68: the gain in F2 or F1 is lost in another fold | no |
| Choosing between carry and drift levels by inner folds | picks drift for F2 (8.60) and carry for F3 (5.95): selection chases the last round's national shift | no |
| Spatial history features: province mean of the previous trend, region mean, 8 nearest neighbours' previous level and trend, distance from the province mean | within-province MAE better by 0.02–0.17 pp, total MAE worse in two of three folds (best set: 8.02 / 7.83 / 6.03 vs 8.05 / 7.58 / 5.94) | no |
| Second previous level (`y_prev2`) | 8.05 / 7.57 / 5.96: no change | no |
| Sample weights 1/(SE² + SE_prev² + τ²), τ² = 0.5 or 4 | 8.04–8.05 / 7.63 / 5.99–6.01: slightly worse | no |
| Dropping `d_l_pop` (WorldPop is carried from 2020 after 2020) | 8.08 / 7.58 / 6.00: slightly worse | no |
| No monotone constraints | 8.05 / 7.58 / 5.94 vs 8.04 / 7.58 / 5.91 with them | constraints kept |
| L2 instead of Huber | left to tuning (it picks L2 for F2, F3 and the final model) | in the grid |
| Re-centring the predictions to a zero mean per province | worse in all three folds (8.14 / 7.81 / 6.23): the trees' small provincial component helps | no |
| Shrinking the prediction towards carry (×0.5, ×0.75) or stretching it (×1.25, ×1.5) | ×1 is within 0.10 pp of the best weight in every fold, and the best weight differs by fold (×0.75–1 in F1, ×1.5 in F2 and F3) | no |
| Intervals: province-grouped CV pooled over all training rounds; union with forward residuals; per-round maximum quantile | coverage 0.66 / 0.78 / 0.92, 0.66 / 0.80 / 0.93, 0.66 / 0.82 / 0.98 (width 36 pp in F3) | no (v1 method kept) |
| Intervals scaled by √gap (random walk) | F3 (2-year gap, calibrated on 3-year gaps) drops to 0.86: errors do not shrink with the gap that fast, so 1-year intervals are not narrowed | no |
| Mondrian bins by PSA SE, by province volatility, or 8 bins instead of 4 | coverage within ±0.03 and widths within ±1 pp of the quartile bins | no |

**Not computed:** VIIRS VNL v2 composites, GHSL urban fraction, population-weighted lights and other NDVI aggregations. The whole satellite block is worth 0.02–0.06 pp; light growth correlates at most 0.09 with the within-province change and +0.05 to +0.20 (wrong sign, unstable) with the provincial change in every round, and a second lights product measures the same thing. Not worth the Earth Engine quota until something can predict the provincial shift.

### Next steps for the remaining problems

- **F1 coverage** needs evidence on how much provinces move between rounds from more than one transition. The 2006 and 2009 SAE rounds (in the archived "2018 − 2021" workbook) could calibrate the provincial part of the interval without entering the model. That changes Q4 ("history only"), so it is Kurt's call.
- **The provincial shift** is where the remaining error is. Province-level inputs with a stable relationship to it (for example FIES-based provincial estimates, which PSA publishes before the SAE round) would be the next lever, with the leakage rules of MODELING-PLAN §5.5.

## v3 enhancement (data version v3, run 39580446754, 2026-10-21)

Kurt approved a v3 ("make all the tuning that you need"), stated as an enhancement, with the same honesty rules: no leakage, tuning and calibration on each fold's training rounds only, the same three outer folds and baselines, and anything that gets worse reported plainly.

### Decisions

| # | Decision | Why |
|---|---|---|
| V1 | **Q4 changes: the 2006 and 2009 SAE rounds are training rounds** (and provincial-shift history), not only history. They come from the archived "2018 − 2021" workbook (same ELL method and per-round sheets as 2012/2015; LGU means 33.3 and 32.8 % against 30.1 % in 2012). They add the transitions 2006 → 2009 and 2009 → 2012 and the previous trend for 2015 targets | v2's F1 was calibrated on one transition and covered 66 %; a model needs to have seen more than one round-to-round shift |
| V2 | **Boundary changes:** LGUs created after a round are listed without an estimate in that round's sheet; the round's labels are then dropped for the whole (current) province, because the parent is unknown. This drops Basilan, Sulu and Maguindanao in 2006 (2006: 1,568 LGUs; 2009: 1,624). The 2012–2023 labels are byte-identical to v2's | honest: no guessed parents and no averaging |
| V3 | **No satellite inputs before 2012:** the 2009 rows and the "then" side of 2012 rows are NaN, handled by LightGBM's missing-value branches (the core already evaluates them identically). DMSP-OLS harmonised lights were not added: the whole satellite block is worth ≤ 0.06 pp (v2), and a second lights product with a different sensor would mostly add a seam | evidence, and the Earth Engine quota |
| V4 | **Provincial FIES, lagged only.** New registry sources `psa-fies-prov-2006-2015`, `psa-fies-prov-2018-2023`, `psa-fies-prov-nohuc` (PSA OpenSTAT; PXWeb serves data only to a POST, so `tools/fetch_openstat.py` fetches them and they are adopted as archive snapshots `<id>-2026-10-21`; an automated GET falls back to the archive). New core feature `prov_fies_gap`: the province's FIES poverty incidence in the previous round r minus the mean SAE estimate of its LGUs in r, centred over provinces | **Timing:** FIES for year t is published 1–2 years before the SAE for t, but there is no FIES for the nowcast years (2024, 2025) or for the years between rounds, so a model that used FIES of the target year could not produce the map's estimates and its backtests would measure a different model. Only the previous round's figure is used; it was public long before the target round was nowcast |
| V5 | **Two optional linear terms** on top of the within-province forest (`model.json` `linear`, evaluated by the core; a missing input contributes 0): the national drift (the training transitions' mean change per year, times the gap) and the provincial FIES term (coefficient fitted across training provinces and transitions). **Each fold keeps the combination with the lowest inner forward-chaining MAE** inside its own training rounds | the shared shift is most of the error (v2); whether a term helps must be decided without the test round |
| V6 | **Province-level accuracy** in `metrics.json`, beside the town-level numbers: `province_mae_vs_sae` (population-weighted mean of the town estimates per province against the same weighting of PSA's SAE town figures; WorldPop weights) and `province_mae_vs_fies` (against PSA's FIES provincial figure without highly urbanised cities, provinces outside Metro Manila with ≥ 3 towns), with `psa_sae_province_mae_vs_fies` as the reference: FIES has its own sampling error | asked for; the second yardstick is independent of the SAE model |
| V7 | **Core compatibility:** `ROUNDS` gains 2006 and 2009, but `manifest.rounds` and the per-LGU years stay 2012–2023/2012–2025. `snapshot.bin` is version 2 (adds the provincial FIES table) and the core still reads version-1 snapshots; models name their forest inputs, so v1/v2 `model.json` files load in the v3 core. **Deploy note:** v3 data needs the WASM built from this core (an older WASM rejects a version-2 snapshot and would ignore the linear term); the v3 WASM also reads v1/v2 data, so a rollback by `latest.json` still works | keeps the read-model layout and JSON fields unchanged |

### Before and after (forward-chaining; same rows and baselines in every version)

Drift is the v1/v2 definition (mean change per year of the 2015-onwards training transitions) so that the column is comparable; `metrics.json` also has `carry_forward_drift_all_rounds` (with 2009/2012: 7.39, 8.77, 5.92).

| Fold | Test | Version | Model MAE | Carry | Drift | No-sat | Model R² | Spearman | 90 % coverage | 50 % coverage | Mean 90 % width | PSA mean 90 % CI width |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| F1 | 2018 | v1 | 8.34 | 8.13 | 7.48 | 8.15 | 0.65 | 0.90 | 0.65 | 0.21 | 19.0 | 8.1 |
| F1 | 2018 | v2 | 8.04 | 8.13 | 7.48 | 8.08 | 0.68 | 0.91 | 0.66 | 0.23 | 19.5 | 8.1 |
| F1 | 2018 | v3 | **6.76** | 8.13 | 7.48 | 6.75 | 0.74 | 0.91 | **0.90** | 0.45 | 26.7 | 8.1 |
| F2 | 2021 | v1 | 9.60 | 7.97 | 9.13 | 9.52 | −0.25 | 0.79 | 0.69 | 0.40 | 23.2 | 8.1 |
| F2 | 2021 | v2 | **7.53** | 7.97 | 9.13 | 7.51 | 0.13 | 0.79 | 0.83 | 0.55 | 25.4 | 8.1 |
| F2 | 2021 | v3 | 8.07 | 7.97 | 9.13 | 8.09 | 0.11 | 0.79 | 0.75 | 0.37 | 23.1 | 8.1 |
| F3 | 2023 | v1 | 5.57 | 6.33 | 5.89 | 5.62 | 0.55 | 0.83 | 0.95 | 0.71 | 30.1 | 7.5 |
| F3 | 2023 | v2 | 5.98 | 6.33 | 5.89 | 6.04 | 0.54 | 0.83 | 0.95 | 0.66 | 28.5 | 7.5 |
| F3 | 2023 | v3 | **5.55** | 6.33 | 5.89 | 5.58 | 0.58 | 0.83 | 0.94 | 0.58 | 26.3 | 7.5 |

Province level (population-weighted, 82 provinces; MAE in pp):

| Fold | Test | v1 vs SAE | v2 vs SAE | v3 vs SAE | Carry vs SAE | v1 vs FIES | v2 vs FIES | v3 vs FIES | Carry vs FIES | PSA SAE vs FIES |
|---|---|---|---|---|---|---|---|---|---|---|
| F1 | 2018 | 7.82 | 7.70 | **6.34** | 7.59 | 7.63 | 7.72 | **6.60** | 7.53 | 2.88 |
| F2 | 2021 | 7.71 | **5.75** | 6.27 | 5.98 | 8.92 | **6.91** | 7.33 | 7.08 | 2.90 |
| F3 | 2023 | **4.82** | 5.26 | 4.88 | 5.41 | 5.38 | 5.68 | **5.17** | 5.80 | 2.18 |

Plainly:

- **Mean town-level MAE over the three folds: v1 7.84, v2 7.18, v3 6.79 pp.** v3 is the best of the three in F1 (−1.28 pp against v2) and F3 (−0.43 against v2; −0.02 against v1, the same at two decimals), and **worse than v2 in F2 (8.07 against 7.53) and again worse than carry-forward there (by 0.10 pp)**.
- **Why F2 got worse:** inner forward-chaining kept the national drift in every fold (poverty fell in 2006→2009, 2009→2012, 2012→2015 and 2015→2018), and 2018→2021 (COVID and the ELL → Census EB change) broke the trend: the drift term alone costs about 0.66 pp in F2 and gains about 0.77 pp in F1 and 0.36 pp in F3 (diagnostic below). This is the selection rule working as declared, not a choice made on the outer folds.
- **F1 coverage is fixed: 0.66 → 0.90**, because the calibration now has residuals from two earlier out-of-sample rounds (2012, 2015). The F1 intervals are 7.2 pp wider than in v2, as they had to be. **F2 coverage falls from 0.83 to 0.75** (the drift's bias in 2021); F3 stays at 0.94 with intervals 2.2 pp narrower.
- **What each part did** (diagnostic only, from the final model's inner folds, which are these test rounds; not used to choose anything): the 2006/2009 history alone (forest only) gave 7.71 / 7.57 / 5.87; the FIES term changed MAE by −0.17 / −0.22 / +0.04; the drift by −0.77 / +0.66 / −0.36.
- **Satellites:** without them v3 is 0.01 pp better in F1, 0.02 worse in F2 and 0.03 worse in F3. They still earn almost nothing; they are kept because the product and the what-if are built on them, which is Kurt's call rather than an accuracy result.
- **Reliability tiers** (all model estimates in the published table): v2 0 % reliable, 4.3 % caution, 95.7 % unreliable; **v3 0 %, 2.9 %, 97.1 %**. Fewer "caution" estimates because the backtest intervals are now honestly wider (F1 caution share 39 % → 8 %). Mean 90 % width: backtest 24.2 → 25.1, between 29.1 → 26.8, nowcast 25.1 → 23.7 pp.
- **Province level:** v3 is the most accurate version against both yardsticks in F1, and against FIES in F3 (against the SAE aggregate in F3, v1 is 0.06 pp better); in F2 v2 is better on both. v3's province-level errors (4.9–7.3 pp) are two to three times the gap between PSA's own SAE aggregates and FIES (2.2–2.9 pp).
- **Parity:** Rust core vs LightGBM + linear term over 24,346 design rows × 4 models, max |Δ| 7.1e-14 (tolerance 1e-5).
- **Target set by the coordinator:** 4–5 pp at the town level is not reached: 5.55 pp in the nowcast case (F3), 6.76 and 8.07 in the others. The remaining error is still mostly the shared provincial and national shift between rounds (bias +3.6, −2.3, +1.5 pp); the within-province part is 2.6–3.1 pp, near PSA's own SE.

### Tried and not kept (v3)

| Idea | Result | Kept? |
|---|---|---|
| Province mean of the previous SAE trend as a provincial term | helped F1 and F2 in screening but cost 0.3 pp in F3 (7.63 / 7.17 / 6.17 with carry level) | no |
| Same-year provincial FIES | correlates 0.5–0.9 with the provincial shift, but it does not exist for the years the map estimates; it would be leakage relative to the nowcast | no, by rule |
| Provincial GDP (PSA PRGDP) | starts in 2018, so at most one lagged value per fold; not added | no |
| DMSP-OLS harmonised lights for 2006–2011 | not computed (see V3) | no |
