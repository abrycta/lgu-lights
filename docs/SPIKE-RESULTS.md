# Measurement spike results

Run 2026-10-21 (Asia/Manila), as decided in [DECISIONS.md](DECISIONS.md) Q10. Each section gives the method, the numbers, and a pass/fail against the target in [ARCHITECTURE-RESEARCH.md](ARCHITECTURE-RESEARCH.md). The throwaway code is in `spike/` and large outputs are gitignored. Every script there regenerates its own inputs.

**Machine and caveats.** Apple M5 (4 performance + 6 efficiency cores), macOS, fanless, on a residential connection in the Philippines. Builds and heavy jobs ran under `taskpolicy -b`, which moves them onto the efficiency cores, so those wall times are pessimistic. Micro-benchmarks ran for a few seconds at normal priority, and each table says which applies. Map timings in headless Chromium use SwiftShader (software WebGL), so only their request counts and bytes matter, not their milliseconds.

## Summary

| # | Measurement | Target / estimate | Result | Verdict |
|---|---|---|---|---|
| 1 | PMTiles, ADM3 z0–12, all 84 per-year slots (14 years × 6 fields) | 3–10 MB **[U]** | **24.5 MB** (geometry alone 12.7 MB) | **Estimate wrong**; see the recommended layout |
| 1 | PMTiles, recommended layout (z0–10, 42 slots: value, tier, source × 14 years) | 3–10 MB | **5.9 MB** | Pass |
| 1 | Typical session (national → province → one LGU), recommended layout | (none set) | **27 range requests, 428 kB** | Fine |
| 2 | GitHub Pages: 206 + CORS | 206 | **206**, `access-control-allow-origin: *`; single-range GETs need no preflight | Pass |
| 2 | Hugging Face resolve URL: 206 + CORS | 206 | **302 → 206**, CORS on both hops; the browser session renders | Pass (correctness) |
| 2 | HF per-range latency from PH | (as tile host) | **p50 0.78 s warm, 1.02 s fresh** | **Fallback only** (confirms Q5) |
| 3 | Worker bundle vs limit | ≤ 64 MiB (secondary source) | **3.46 MiB upload / 2.90 MiB gzip**; limit **verified on the official page** | Pass |
| 3 | Worker startup | ≤ 1 s | **5.1 ms active** (10.9 ms window), local profile | Pass |
| 3 | Worker per-request cost | < 1 ms CPU | handler + GRU + JSON ≈ **0.1 ms** over the router baseline (loopback p50 0.86 ms vs 0.76 ms) | Pass |
| 4 | GRU forward, native | 5–30 µs **[U]** | **11.5 µs** (GRU), **12.0 µs** (GRU + 100 trees) | Pass |
| 4 | GRU forward, WASM | 20–200 µs **[U]** | **16.3–17.4 µs** (opt-level 3), **29–31 µs** (opt-level z), Chrome 156 and Node 24 | Pass |
| 4 | What-if compute | < 1 ms | one LGU 17 µs; **all 1,640 LGUs 41–62 ms in WASM**, 26 ms native | Pass per LGU; **all-LGU recompute does not fit one frame** |
| 4 | Equality with tract (ONNX) | ≤ 1e-5 | **GRU 5.96e-7** over 1,640 LGUs | Pass |
| 4 | Equality, trees | ≤ 1e-5 | **4.77e-7** vs NumPy/onnxruntime; **tract 0.23.9 cannot run `TreeEnsembleRegressor`** | Pass, with a different oracle |
| 5 | GEE EECU for one year | "a few EECU-h" **[U]** | **Not measured**: no GEE credentials | Open |
| 5 | exactextract, one year, 1,642 ADM3, VNP46A4 grid | (none set) | **78.5 s** full-resolution polygons, 4.4 s simplified (efficiency cores) | Fine for Actions |
| 5 | PSA file names | confirm by hand | psa.gov.ph blocks curl **and** headless Chromium (Cloudflare challenge, 403); names confirmed through the Wayback Machine, including the **2023 SAE file** | Mostly resolved |
| 5 | VJ113A1 on GEE | **[U]** | **Not on GEE** | **Affects the plan** |
| 6 | Static (Cloudflare Pages) from PH | p50 20–60 / p99 ≤ 150 ms **[U]** | TTFB **46 / p95 68 ms** on a reused connection; **156 / 178 ms** on a fresh one | Pass warm; fresh exceeds (TLS) |
| 6 | Tile range (GitHub Pages) | 50–120 / ≤ 250 ms **[U]** | **39–43 / p95 42–46 ms** reused; **117–131 / p95 134–143 ms** fresh | Pass |
| 6 | API (Pages Function as a Worker proxy) | p50 ≤ 80 / p99 ≤ 200 ms **[U]** | **50 / p95 65 ms** reused; **187 / p95 232 ms** fresh | Pass warm; fresh p95 exceeds |

**Nothing found threatens Architecture B.** Five findings should change plans. They are flagged ⚠ below and collected in [DECISIONS.md](DECISIONS.md#spike-results-2026-10-21).

---

## 1. Boundaries → PMTiles

**Sources (downloaded 2026-10-21).**
- geoBoundaries gbOpen PHL ADM3 at commit `9469f09` (built 2023-12-12, year represented 2020): full GeoJSON 532 MB, simplified 7.07 MB.
- HDX COD-AB PHL v03 (`valid_on` 2025-02-13). The resource URLs came from the CKAN API (`package_show?id=cod-ab-phl`, readable without a challenge), and the downloads go through a 302 to S3: gdb.zip 360.6 MB, shp.zip 928.5 MB, geojson.zip 1,058 MB, xlsx 9.26 MB. These are the resource URLs that OPEN-QUESTIONS listed as "confirm by hand":
  - `https://data.humdata.org/dataset/caf116df-f984-4deb-85ca-41b349d3f313/resource/3fa0dbcf-e07d-4506-9821-ba15baa6da07/download/phl_admin_boundaries.gdb.zip`
  - `…/resource/159ffd3d-679f-431c-812f-b6d6f957045e/download/phl_admin_boundaries.xlsx`
  - `…/resource/0120c30e-ba8b-487d-83f5-a664eddd3a8e/download/phl_admin_boundaries.geojson.zip`

**Harmonisation to PSGC** (`spike/tiles/prepare.py`, report in `spike/tiles/harmonise_report.json`). Each geoBoundaries polygon's representative point was spatially joined to the HDX polygons. Results:
- 0 unmatched, 0 ambiguous.
- Median area ratio 1.000; 21 of 1,647 fall outside ±10 %, mostly Manila districts and the Pikit/SGA area.
- Exact name agreement 89 %.

⚠ Findings that correct DATA-PLAN.md:
- **HDX v03 pcodes are `PH` + 7 digits** (e.g. `PH0102801`), not 10-digit PSGC. The 10-digit PSGC is `pcode[2:] + "000"` (Adams, Ilocos Norte → `0102801000`).
- **geoBoundaries `9469f09` is a pre-2024 vintage.** It splits the City of Manila into 14 districts (13 extra features) and has no BARMM Special Geographic Area units (1,647 = 1,642 − 8 + 13).
- **HDX v03 represents the SGA as seven placeholder units** ("Special Geographic Area – Carmen", "– Kabacan", "– Midsayap I", "– Midsayap II", "– Pigkawayan", "– Pikit II", "– Pikit III"; PSGC `19099…`), **not the eight municipalities ratified on 2024-04-13**. The SGA mapping in the crosswalk is still manual work.
- **Use HDX geometry for the tiles**, as DATA-PLAN already says. geoBoundaries stays a mirror only.

**Tile build** (tippecanoe 2.79.0, `TIPPECANOE_MAX_THREADS=2`, efficiency cores). The build used `-Z0 -z12 --detect-shared-borders --use-attribute-for-id=id --no-feature-limit --no-tile-size-limit`, so no LGU is ever dropped at low zoom (a choropleth cannot drop polygons). Geometry was the full-resolution HDX ADM3 (13.85 M vertices). The per-year slots are synthetic, with realistic precision: `p` (poverty %, 0.1), `l`/`h` (interval, 0.1), `t` (tier 0–2), `s` (official or model), `r` (radiance, 0.01). Random values compress worse than real series, so the attribute bytes are an upper bound.

| Variant | Zooms | Slots | File | z0–4 tile (national view) | Largest tile |
|---|---|---|---|---|---|
| v1 full | 0–12 | 84 | **24.5 MB** (7,014 tiles) | 127–366 kB | 366 kB (z4) |
| geometry only | 0–12 | 0 | 12.7 MB | 18–95 kB | 95 kB |
| v2 | 0–10 | 84 | 8.95 MB (749 tiles) | 127–366 kB | 366 kB |
| **v3 (recommended)** | **0–10** | **42 (p, t, s)** | **5.88 MB** | 50–175 kB | 175 kB |
| v4: ids only + `attrs_all.json` via feature-state | 0–10 | 0 (+ 562 kB JSON, 180 kB gzip, 155 kB brotli) | 4.36 MB | 18–95 kB | 95 kB |

- The z12 level alone is 10.4 MB of v1. Dropping z11–12 costs nothing visible: at z10, tippecanoe's 4,096-unit tile extent is about 9.5 m per unit, and MapLibre overzooms beyond that.
- Interval bounds (`l`, `h`) and radiance belong in the per-LGU JSON read model (needed on click), not in every tile.
- Build cost: tippecanoe on full-resolution geometry took **8.5 min with 1.4 GB RSS** (geometry only: 7.5 min, 1.7 GB). ⚠ **`tile-join` re-attaches a new attribute CSV to existing geometry tiles in 24 s (z0–12) or 3 s (z0–10).** The pipeline should therefore tile the geometry once per boundary vintage and only re-join attributes per data version.

**Render test** (`spike/bench-web/map.html`, `session.mjs`). The test used MapLibre GL JS 6.15.0 and pmtiles 4.5.0 in headless Chrome 156 with SwiftShader, against `serve.mjs`, a local static server that honours Range (206 and `Content-Range`) and sends CORS headers, as GitHub Pages does. A `fill-extrusion` layer coloured and extruded by `["get", ["concat", "p", ["global-state", "yy"]]]` rendered correctly, and `setGlobalStateProperty("yy", …)` switched years with one call. The v4 feature-state variant also rendered, applying 1,642 `setFeatureState` calls in 127 ms under SwiftShader.

| Session step (1280 × 800) | v1 (z12, 84 slots) | v2 | **v3** | v4 (+ JSON) |
|---|---|---|---|---|
| National view (z4.6): header/root directory + tiles | 2 req, 382 kB | 2 req, 382 kB | **2 req, 191 kB** | 3 req, 675 kB (JSON uncompressed; about 290 kB with gzip) |
| Province (Bohol, z9.2, pitch 45) | 12 req, 210 kB | 12 req, 210 kB | **12 req, 153 kB** | 12 req, 120 kB |
| One LGU (z12.5, pitch 50) | 8 req, 27 kB | 13 req, 115 kB | **13 req, 84 kB** | 13 req, 67 kB |
| **Session total** | 22 req, 619 kB | 27 req, 708 kB | **27 req, 428 kB** | 28 req, about 480 kB |

The HF variant of v3 (§2) rendered the same 22 features at the LGU step with 23 cross-origin resource entries.

Basemap for comparison: a Protomaps PH extract (`pmtiles extract … --bbox=116.9,4.5,126.6,21.2 --dry-run` against build `20261020`) is **77 MB at z0–12** (13,883 tiles) and **15 MB at z0–10**. The 30–80 MB estimate holds.

## 2. Range-request hosting

| Host | Status for `Range: bytes=0-16383` | CORS | Notes |
|---|---|---|---|
| GitHub Pages (`krtmtthw.dev` asset, measured live) | **206**, `content-range` correct | `access-control-allow-origin: *` | `OPTIONS` preflight returns **405**, but a single `bytes=a-b` Range is a CORS-safelisted request header (Fetch standard), so browsers send no preflight. pmtiles 4.5 sends exactly that. The Protomaps docs list GitHub Pages (1 GB) as a PMTiles host ([cloud storage docs](https://docs.protomaps.com/pmtiles/cloud-storage)) |
| Local Range server (`spike/bench-web/serve.mjs`), standing in for GitHub Pages | 206 | `*` | Full browser session passes (§1) |
| Cloudflare Pages (`typhoon.krtmtthw.dev` asset) | **200 with the full body** although it sends `accept-ranges: bytes` | `*` | Confirms the "not PMTiles on Pages" rule |
| **Hugging Face** `…/resolve/main/<file>` (test file `spike/v3_pts_z10.pmtiles` in a new public dataset `permission-alluring/lgu-lights-spike`) | **302** → `us.aws.cdn.hf.co/xet-bridge-us/…` (signed, expiring) → **206** | first hop echoes the Origin; second hop `*`; preflight 200 with `access-control-allow-headers: range` | Headless Chrome rendered the whole session cross-origin. Latency: the 302 hop alone is about 240 ms (US origin), and the CDN hop about 255 ms (POP `aws-ap-southeast-1`, no edge cache hit for xet objects) |

The HF test file was deleted after the test (the resolve URL now returns 404). The empty dataset repo and its two commits remain; delete the repo if you don't want it.

## 3. workers-rs + axum hello-world

`spike/worker`: `worker` 0.8.7 (`http` and `axum` features), `worker-macros` 0.8.7, axum 0.8.9 (`default-features = false`, `json` and `matched-path`), and `tower-service` 0.3.3. The Worker embeds, with `include_bytes!`, a **3.14 MB snapshot** (1,642 real PSGC codes, 14 years × {estimate, lo, hi, tier}, 14 × 30 features) and the GRU weights from §4. `GET /v1/lgu/{psgc}` binary-searches the codes, builds the JSON, and runs one GRU nowcast per request.

**Toolchain that compiles cleanly:** rustc 1.99.1, `wasm32-unknown-unknown`, `worker-build` 0.8.7 (`cargo install --locked`, 19 min on efficiency cores with `-j 2`). It fetched **wasm-bindgen 0.2.129** (Cargo.lock agrees: wasm-bindgen 0.2.129, js-sys 0.3.106), wasm-opt 132 and esbuild 0.28.2. Also wrangler 4.151.3 and workerd 2026-10-19. The first release build took 3 min. No version friction.

| Measure | Value | Limit ([official limits page](https://developers.cloudflare.com/workers/platform/limits/), "Last updated Oct 12, 2026") | Verdict |
|---|---|---|---|
| `index_bg.wasm` | **3,507,645 B raw**, 2,963,724 B gzip -9 (the random snapshot is incompressible; code is about 340 kB) | — | — |
| `wrangler deploy --dry-run` | **Total Upload 3,460.30 KiB / gzip 2,901.96 KiB** | **64 MiB uncompressed on Free and Paid; "There is no compressed size limit"** | Pass (5.3 %) |
| Startup (`wrangler check startup`) | profile window 10.9 ms, **5.1 ms active** | 1 s | Pass |
| `wrangler dev --local` ready | 2.0 s (includes a no-op rebuild) | — | — |
| First `/v1/lgu` request (snapshot parse in `OnceLock`) | **5.2 ms** wall | — | — |
| Warm `/v1/lgu/{psgc}`, 200 requests on loopback | **p50 0.86 ms, p95 1.36 ms** | 10 ms CPU | Pass |
| Warm `/v1/healthz` (router only) | p50 0.76 ms, p95 1.17 ms | — | Lookup + GRU + JSON ≈ 0.1 ms |

Local workerd does not report CPU time, so loopback wall time stands in for it; with no I/O, it bounds CPU from above. Nothing was deployed.

⚠ An endpoint that recomputes **all 1,640 LGUs** (a national what-if) needs about 26 ms native and 41–62 ms in WASM, which is **over the Free plan's 10 ms CPU per request**. `/v1/whatif` must stay per-LGU (or a small set), or serve precomputed national scenarios.

## 4. Rust core inference

`spike/rust/infer` is a dependency-free GRU (ONNX semantics, `linear_before_reset = 1`; hidden 32, inputs 30, sequence 14; linear head) plus a flat-array tree evaluator (100 complete trees of depth 6, 12,700 nodes, `x <= threshold` goes left as in LightGBM). `spike/python/export_model.py` (uv; numpy 2.5.4, onnx 1.23.2, onnxruntime 1.31.0) generates seeded random weights (6,177 GRU parameters, 24.7 kB), an ONNX GRU graph, an `ai.onnx.ml` `TreeEnsembleRegressor` graph, 1,640 × 14 × 30 inputs, and float64 NumPy references. onnxruntime matches NumPy to 4.8e-7 (GRU) and 2.4e-7 (trees). Arithmetic: 96 × (30 + 32) = 5,952 MACs per step, × 14 = **83,328 MACs (about 167k FLOPs) per forward**.

| Host | Build | GRU, one LGU | GRU + trees, one LGU | All 1,640 LGUs | Max \|Δ\| vs reference |
|---|---|---|---|---|---|
| Native (M5 performance core) | release, LTO | **11.5 µs** | 12.0 µs (trees alone 0.48 µs) | **25.9 ms** median | 5.96e-7 / 4.77e-7 |
| Native under `taskpolicy -b` (efficiency cores) | same | 74 µs | 67 µs | 178 ms | — |
| Node 24.22.0 | opt-level z | 30.8 µs | 31.7 µs | 64.7 ms | same |
| Node 24.22.0 | opt-level 3 | 18.4 µs | 19.3 µs | 44.9 ms | same |
| Node 24.22.0 | opt-level 3 + `simd128` | 16.3 µs | 17.3 µs | 41.4 ms | same |
| Chrome 156 (headless) | opt-level z | 29.2 µs | 30.0 µs | 61.8 ms | same |
| Chrome 156 (headless) | opt-level 3 | 17.4 µs | 18.1 µs | 42.5 ms | same |
| Chrome 156 (headless) | opt-level 3 + `simd128` | **16.6 µs** | **17.3 µs** | **41.2 ms** | same |

WASM instantiation took 0.5–2.2 ms, and decoding the embedded 2.75 MB feature snapshot into `Vec<f32>` 0.4–2.0 ms. That is the "< 10 ms snapshot load": **pass**. The bench module is 3.07 MB (code about 32 kB plus fixtures).

**Oracle** (`spike/rust/oracle`, `tract-onnx` 0.23.9, 8 min first build on efficiency cores):
- The GRU graph loaded, optimised and ran in 42 ms. **Max \|hand-written − tract\| = 5.96e-7 over 1,640 LGUs: pass (≤ 1e-5).**
- ⚠ **tract 0.23.9 fails on `TreeEnsembleRegressor`** with `Unimplemented(TreeEnsembleRegressor) ToTypedTranslator`. The trees were checked against the NumPy reference instead (4.77e-7), which itself equals onnxruntime. In CI, the tree oracle should be LightGBM's own `predict()` (or onnxruntime) on the exported model, run through uv and compared by a Rust test against a fixture file.

**Recommendations.** Use opt-level 3 (not z) for `lgu-wasm`: it runs 1.7× faster for about 0 extra bytes at this code size. `simd128` adds 5–10 %. ⚠ A **single-LGU** what-if is far under 1 ms, but recolouring the **whole map** for a what-if takes about 41 ms in WASM, which needs a Web Worker or debounce (or pre-baked national scenarios). It does not fit inside one 16 ms frame.

## 5. Data probes

**Earth Engine.** There are no credentials on this machine (no `~/.config/earthengine` and no keychain item), so GEE was skipped. The EECU cost of one year of `reduceRegions` stays **[U]** until registration.

**VJ113A1 on GEE: no.** The GEE STAC `NASA` catalog lists VIIRS vegetation only as `NASA_VIIRS_002_VNP13A1` (S-NPP). The only NOAA-20 entries are `NASA_LANCE_NOAA20_VIIRS_C2` (fire) and `NASA_VIIRS_002_AERDB_D3_VIIRS_NOAA20` (aerosol), and `developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VJ113A1` returns 404. ⚠ The NOAA-20 vegetation-index continuity series must therefore come from LAADS (Earthdata login) through exactextract, like Black Marble.

**exactextract timing** (`spike/python/zonal_timing.py`; exactextract 0.3.0, rasterio 1.5.2, GDAL 3.12.4 via pyogrio 0.13.0; efficiency cores).
- Real VNP46A4 tiles need an Earthdata login: LAADS answers **303 → `/profiles/licenses/…`**, though the listing API is open and shows the five PH tiles for 2023 at 72.9–82.2 MB each (395.7 MB). EOG annual needs registration. The timing therefore used a synthetic float32 raster on **the exact VNP46A4 grid** (15″, h29–h30 × v06–v08, 4,800 × 7,200 px); zonal cost depends on the grid and the polygons, not on the values.
- Full-resolution 1,642 HDX polygons (13.85 M vertices): **78.5 s** for mean, sum, count, max and stdev.
- Simplified at 0.001° (148k vertices): 4.4 s, but the means of small LGUs moved by up to 14.5 %. Keep full or near-full resolution.
- A 14-year rebuild of one product is about 18 min plus about 5.5 GB of downloads: fine on a 4-vCPU runner.

**PSA files.** psa.gov.ph (including `/system/files/…` and openstat.psa.gov.ph) answers **403 "Just a moment…"** (Cloudflare challenge) to curl with a desktop Chrome User-Agent **and** to headless Chrome 156; a human browser is needed. The Wayback Machine has captures, which confirm these names:

| Round | File (path on psa.gov.ph) | Evidence |
|---|---|---|
| 2023 | `/sites/default/files/phdsd/2_2023 SAE_with PSGC_noHUC_06Feb2026.xlsx` and `/sites/default/files/phdsd/PressReleaseon-2023SAE_rev.pdf` | links on the archived press-release page `content/881-cities-and-municipalities-…-2023` (capture 2026-09-05); the files themselves are not archived |
| 2018, 2021 | `/system/files/phdsd/2018 - 2021 SAE_with PSGC_noHUC.xlsx` | archived 2024-04-04 and 2025-05-21 (200) |
| 2018 | `/system/files/phdsd/3-1_2018 SAE tables.xlsx` | archived 2025-05-21, 2026-09-11 |
| 2009, 2012, 2015 | `/system/files/phdsd/City and Municipal-level Small Area Poverty Estimates_ 2009, 2012 and 2015_0.xlsx` | archived 2025-05-21 |
| 2012 | `/system/files/phdsd/2012 SAE_final_1.xlsx` | archived 2025-05-21 |
| 2006, 2009 | `/system/files/phdsd/2006 and 2009 City and Municipal Level Poverty Estimates_0_0.xlsx` | archived 2025-05-21, 2026-09-05 |
| PSGC | `/system/files/scd/PSGC-3Q-2025-Publication-Datafile.xlsx` (latest archived; the pattern `PSGC-<Q>Q-<YYYY>-Publication-Datafile.xlsx` is confirmed) | archived 2025-10-18 |

⚠ Wayback raw captures (`web.archive.org/web/<ts>id_/<url>`) make a legitimate **mirror tier** in `sources.yaml` for the bot-blocked PSA host. The 2023 file still has to be fetched once by hand and archived.

## 6. Latency from the Philippines

Method (`spike/latency/latency.sh`, `summarize.py`; raw CSVs in `spike/latency/results/`):
- 40 requests per endpoint in two modes. *fresh* is a new curl process per request (new TCP and TLS; OS DNS cache), 0.3 s apart. *reuse* is 40 requests over one kept-alive HTTP/2 connection (`curl --next`).
- Runs at 2026-10-21 04:29 and 05:33 PHT.
- Cloudflare served from **SIN** (`cf-ray …-SIN`), not a Manila PoP. GitHub Pages came from Fastly `cache-sin-…` (`x-github-edge-region: southeastasia`). TCP connect is about 40 ms, which is the RTT to Singapore.

| Endpoint | Mode | TTFB p50 | TTFB p95 | Total p50 / p95 | Target | Verdict |
|---|---|---|---|---|---|---|
| Cloudflare Pages static asset (246 kB CSS) | fresh | 156 | 178 | 242 / 283 | 20–60 / ≤ 150 | over (handshake) |
| | reuse | **46** | **68** | 64 / 93 | | **pass** |
| GitHub Pages asset, Range 1 kB | fresh | 131 | 143 | 131 / 143 | tiles 50–120 / ≤ 250 | p50 slightly over, p95 pass |
| | reuse | **39** | **42** | 39 / 42 | | **pass** |
| GitHub Pages, Range 16 kB (PMTiles header size) | fresh | 117 | 134 | 122 / 140 | | pass |
| | reuse | **36** | **43** | 43 / 46 | | **pass** |
| Pages Function `/api/rust/healthz` (answers 503 at the edge with no origin call; same runtime as Workers, so a proxy for Worker latency) | fresh | 187 | 232 | 188 / 232 | API ≤ 80 / ≤ 200 | over (handshake) |
| | reuse | **50** | **65** | 51 / 65 | | **pass** |
| HF resolve, Range 16 kB (302 + 206) | fresh | 733 | 753 | 1,019 / 1,086 | — | fallback only |
| | reuse | 498 | 509 | 781 / 820 | | fallback only |

`/api/java/healthz` was not used, because it waits about 2.5 s for the sleeping Render origin.

Reading. On a warm connection every Cloudflare and GitHub path meets its target with room to spare. The first request to each new origin pays about 90 ms of TCP and TLS to Singapore. The page therefore needs `preconnect` to the tile host and API host, and the PMTiles header warm-up `fetch` already planned (§4 of the architecture doc). The targets in ARCHITECTURE-RESEARCH.md now name the warm and cold cases separately. RIPE Atlas or other networks were not used: these numbers come from one residential connection.

## Updated values for the [U] markers in ARCHITECTURE-RESEARCH.md

| Where | Was | Now (measured) |
|---|---|---|
| §0 workload paragraph | about 170k FLOPs [U, arithmetic] | 83,328 MACs ≈ 167k FLOPs per forward; 11.5 µs native |
| §0 Targets row | static p50 20–60 / p99 ≤ 150 [U]; API ≤ 80 / ≤ 200 [U] | warm 46 / 68 (static), 50 / 65 (edge function); fresh connection 156 / 178 and 187 / 232 |
| §2 GEE row | a few EECU-h per rebuild [U] | still unmeasured (no GEE); exactextract fallback 78.5 s per product-year |
| §3.0 map row | PMTiles 3–10 MB [U] | 24.5 MB at z0–12 with 84 slots; **5.9 MB** recommended (z0–10, 42 slots) |
| §3.0 what-if row | about 83k MACs [U, arithmetic] | 83,328 MACs; 17 µs in Chrome WASM |
| §3.3 hand-written row | 170k FLOPs [U]; 5–30 µs native, 20–200 µs WASM [U] | 11.5 µs native; 16.6–29 µs WASM |
| §3.4 snapshot row | loads in < 10 ms [U] | 0.4–2 ms decode in WASM; 5.2 ms first Worker request |
| §3.5 Workers row | 64 MiB unverified | verified on the official page (Free and Paid, no compressed limit) |
| §3.6 table | 20–60 / 150; 50–120 / 250; 80 / 200; 170k FLOPs | see §6 and §4 |
| §4 Protomaps extract | 30–80 MB [U] | 77 MB (z0–12), 15 MB (z0–10) |
| §6 A performance | p50 20–60 ms static [U] | 46 ms warm / 156 ms fresh |
| §3.5 Koyeb, §4 narration, §6 C warm p50 | [U] | out of spike scope (rejected or moot options); left marked |

## Reproduce

```sh
# Python (uv) fixtures and probes
cd spike/python && uv sync --group geo
uv run python export_model.py                       # GRU/trees weights, ONNX, references -> spike/rust/fixtures
uv run --group geo python -I ../tiles/prepare.py     # needs spike/tiles/data/{gb,hdx} downloads (URLs above)
python3 -I ../tiles/attrs_csv.py && uv run --group geo python -I make_snapshot.py && uv run --group geo python -I zonal_timing.py
# Rust (cargo -j 2)
cd ../rust && cargo run -j 2 --release -p spike-infer --bin bench && cargo test -j 2 --release -p spike-oracle -- --nocapture
cargo build -j 2 --release --target wasm32-unknown-unknown -p spike-infer --lib --features wasm-bench
cd ../bench-web && npm ci && node node.mjs          # and: node serve.mjs .. 8765 /dev/null & node chromium-wasm.mjs
# Tiles
cd ../tiles && tippecanoe -o out/hdx_full_minimal.nolimit.pmtiles -l lgu -Z0 -z12 --detect-shared-borders --use-attribute-for-id=id --no-feature-limit --no-tile-size-limit data/hdx_full_minimal.geojsonl
tile-join -f -pk -z10 -c out/attrs_pts.csv -o out/v3_pts_z10.pmtiles out/hdx_full_minimal.nolimit.pmtiles
# Worker (local only)
cd ../worker && npm ci && ./measure.sh && npx wrangler deploy --dry-run --outdir out/dry
# Latency
cd ../latency && ./latency.sh <label> <url> 40 [range] > out.csv && python3 summarize.py out.csv
```
