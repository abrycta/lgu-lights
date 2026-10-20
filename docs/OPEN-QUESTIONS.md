# Open questions and decisions for Kurt

Status: 2026-10-21, after the research in this folder. Nothing is implemented. Each item names the default the documents assume, so a "yes" to the defaults is enough to start.

## Decisions

| # | Question | Default assumed in the docs | Notes |
|---|---|---|---|
| Q1 | **Architecture**: B (hexagonal core + materialised read models + Rust Cloudflare Worker API), A (same without the Worker) or C (Axum on Render)? | **B**, built as A first | ARCHITECTURE-RESEARCH.md §6. C would put the card on an overage path (Render bills overages automatically with a payment method on file) |
| Q2 | **Scope of the Rust rule**: the backend, the CLI, the WASM and the Worker are Rust. Is Python (and optionally R for `sae::eblupSTFH`) acceptable for *offline training and Earth Engine access* in GitHub Actions? | **Yes**: Rust-only applies to everything that runs or is deployed; training is research code that produces weights the Rust core executes | If "no", the FH model is dropped (no Rust SAE library exists) and GEE access moves to its REST API from Rust, which is a large cost for no user-visible gain |
| Q3 | **Earth Engine registration** as an individual noncommercial project (Community tier, 150 EECU-h/month), with a service-account key stored as a GitHub secret | Register now; keep the site ad-free | Without GEE, the fallback is exactextract over LAADS/Black Marble only (VIIRS annual V2.2 from EOG is paid for programmatic access since 2026-06-01) |
| Q4 | **Label rounds**: include 2006/2009 (DMSP era, 9-digit PSGC) as context, or VIIRS-era only (2012–2023)? | VIIRS-era for the models; 2006/2009 shown as history only | PSA file names and URLs must be confirmed by hand (psa.gov.ph blocks bots); the 2023 SAE file name is unknown |
| Q5 | **Hosting of PMTiles and large files**: GitHub Pages (206 verified, 1 GB site), the HF dataset (206 after a 302), or R2 (10 GB free, requires Cloudflare's checkout flow and reportedly a payment method)? | GitHub Pages primary, HF fallback; **no R2** | Cloudflare Pages returns 200 to Range requests, so PMTiles cannot live on Pages |
| Q6 | **Domain**: `lgu.krtmtthw.dev` CNAME → Pages, API at `lgu.krtmtthw.dev/api/*` via a Worker route on the same zone (needs the zone on Cloudflare) or at `lgu-api.krtmtthw.dev` | `lgu.krtmtthw.dev` + Worker route if the zone is on Cloudflare, else `lgu-api.krtmtthw.dev` | DNS changes are listed before being made (CLAUDE.md §5) |
| Q7 | **Narration**: captions-first with Web Speech when a Filipino voice exists (Android, Edge; not Apple), plus ≤ 100 pre-rendered EN/JA chapter clips via Kokoro-82M (Apache-2.0)? Meta MMS-TTS Tagalog is CC-BY-NC, which a portfolio site can use but the audio files would be non-commercial | Captions-first; Kokoro for EN/JA intros; **no MMS** | Japanese narration is optional polish |
| Q8 | **Languages**: EN + Filipino required; Japanese? | EN + FIL + JA toggle (Akari already does EN/JA) | Adding `fil` is an Akari change |
| Q9 | **Reliability tiers** at CV 10 / 20 % with hatching above 20 % | Yes | PSA's language is "CV < 20 % is reliable" |
| Q10 | **Measurement spike** before implementation: a 1-day spike that (a) profiles one GEE year, (b) builds PH ADM3 PMTiles and measures size, (c) measures static/PMTiles/Worker latency from Manila (e.g. via a friend's connection or RIPE Atlas), (d) builds a hello-world workers-rs + axum Worker | Yes, before DECISIONS.md is written | Every **[U]** latency and size in the docs comes from this spike |
| Q11 | **What-if semantics**: sliders on radiance growth and NDVI trend only, applied to the GRU and the LightGBM trees, with the interval widened by a stated "counterfactual" factor and labelled as hypothetical | Yes | Counterfactuals are shown in a distinct style and never on the main map |
| Q12 | **archivekit changes**: add `xlsx` and `hdf5`/`tif` formats (or an `xlsx_sheet` check), and a `remote-dataset` sub-kind for "private cached copy of a large open raster subset" (the 5 GB of PH Black Marble tiles) | Propose both as kit issues; use the `zip` workaround meanwhile | DATA-PLAN.md §6 |
| Q13 | **PSA terms**: email PSA to confirm the SAE xlsx is covered by the OpenSTAT CC BY terms, or proceed with attribution and a note? | Proceed with attribution; send the email in parallel | — |
| Q14 | **OSM-derived covariates** (road density): keep out of the headline model (ODbL uncertainty for aggregates) and use Google Open Buildings (CC BY 4.0) for a built-structure signal instead? | Yes | DATA-PLAN.md §1.3 |
| Q15 | **Zenodo DOI** per data release (needs a Zenodo account linked to GitHub) | Yes | Free |

## Verification still to do by hand

- PSA: exact URLs and names of the 2023 SAE tables, the 2018–2021 workbook, the 2006–2015 workbooks, the CPH 2020 LGU population xlsx and the PSGC quarterly file; whether the 2018 column in the 2018–2021 file is ELL or re-estimated Census EB; why 2023 has 1,611 units (one fewer than 2021); how the eight 2024 SGA municipalities are treated.
- HDX COD-AB PHL resource URLs (the page blocks bots; the API metadata was readable).
- Cloudflare Workers script-size limit (64 MiB uncompressed on all plans, secondary source) and whether the workers-rs `http`/axum path compiles cleanly with current wasm-bindgen.
- Whether Cloudflare's R2 activation prompts for a payment method (only matters if Q5 changes).
- GEE: actual EECU cost of one full year of `reduceRegions` over 1,642 polygons (expected negligible).
- PMTiles size for PH ADM3 at z0–12 (estimate 3–10 MB).
- Latencies from the Philippines for Pages, GitHub Pages range requests and a Worker (all estimates today).
- Whether VJ113A1 (NOAA-20 vegetation indices) is on GEE.
- The EOG licence PDF text (font-obfuscated; decoded by substitution, so the required credit-line wording should be re-read by a human).
- Apple platforms: confirm no Filipino `speechSynthesis` voice on current macOS/iOS (the archived list is from 2023).
