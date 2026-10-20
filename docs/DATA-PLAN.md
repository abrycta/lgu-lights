# Data plan

Status: research and proposal, 2026-10-21. No pipeline exists yet. Facts were checked against catalog pages, NASA/NOAA/EOG notices, HDX API metadata and vendor docs on the day; **[U]** marks an estimate or a claim that could not be confirmed on a primary page (psa.gov.ph sits behind a bot challenge, so PSA file names and URLs come from search snippets and PSA regional mirrors and must be confirmed by hand before the registry is used).

## 0. Summary

| Decision | Choice | Why here |
|---|---|---|
| Lights, primary | **NOAA/EOG VIIRS annual V2.2 via Earth Engine** (`NOAA/VIIRS/DNB/ANNUAL_V22`, 2012–2024) | the only VIIRS annual series on GEE for the whole 2012→ period; EOG's own servers now require paid programmatic access (2026-06-01), so CI must not download from eogdata |
| Lights, secondary and future | **NASA Black Marble VNP46A4 (S-NPP, 2012→) + VJ146A4 (NOAA-20, 2018→)** from LAADS, processed with exactextract in Actions | not on GEE; radiometrically different (lunar BRDF correction); gives a second opinion and the post-2026 path, since S-NPP data delivery ends 2026-11-02 |
| Vegetation | **MOD13Q1 v061 via GEE** (backbone, 2012→2026) + **VNP13A1** (500 m, same period) to estimate a per-LGU MODIS→VIIRS offset before Terra ends (Feb 2027) | continuity is the risk; two overlapping series solve it cheaply |
| Context covariates | CPH 2020 populations, WorldPop (CC BY 4.0), GHSL R2023A (CC BY 4.0), Copernicus DEM, CHIRPS; **OSM-derived road density kept out of the headline model** (ODbL questions) | all redistributable as LGU aggregates under CC BY with attribution |
| Labels | PSA SAE 2006/2009/2012/2015/2018/2021/**2023**, FIES provincial 2021/2023 for HUCs and checks | the official target; CC BY per OpenSTAT terms (coverage of the SAE xlsx by those terms to be confirmed) |
| Boundaries and codes | **HDX COD-AB PHL v03** (CC BY-IGO, 1,642 ADM3, 10-digit PSGC pcodes, reviewed 2024-04-01), **PSGC** quarterly file, geoBoundaries as a schema-different mirror | the only set with PSGC pcodes; a crosswalk harmonises every SAE round to one vintage |
| Zonal statistics | **Earth Engine `reduceRegions`** for GEE-hosted rasters, **exactextract 0.3.0** in Actions for Black Marble; both produce the same Parquet schema and are cross-checked on VIIRS 2020 | no raster downloads for 95 % of the work; exact area weighting where it matters |
| Feature store | Parquet, tens of MB, in the public repo; tagged releases → **Zenodo DOI**; mirrored to the Hugging Face dataset `permission-alluring/lgu-lights` | reproducible, citable, small |
| Resilience | `archivekit` registry (draft in §6) with a private `abrycta/lgu-lights-archive` | the portfolio standard, applied to this project's sources |
| Cadence | VIIRS annual: once a year (new composite about April–June); Black Marble: yearly; MODIS: yearly; PSA SAE: when a round is released (about every 2–3 years); PSGC: quarterly check | the data changes rarely; CI runs weekly health checks, not weekly rebuilds |

## 1. Sources, licences and volumes

### 1.1 Nighttime lights

| Product | Where | Years | Resolution | Licence / attribution | Volume | Notes |
|---|---|---|---|---|---|---|
| EOG VIIRS annual V2.2 (`NOAA/VIIRS/DNB/ANNUAL_V22`) | GEE | annual 2012–2024 (STAC extent 2012-04-01 → 2025-01-01; no 2025 yet) | 463.83 m | EOG products CC BY 4.0 with required notice and citation of Elvidge et al. 2021 (Remote Sensing 13(5):922) ([EOG licence PDF](https://eogdata.mines.edu/files/EOG_products_CC_License.pdf), text font-obfuscated, decoded by the research agent **[U in details]**); the GEE STAC `license` field says "proprietary" while the catalog page quotes the public-domain text | none locally | bands: average, average_masked, cf_cvg, cvg, maximum, median, median_masked, minimum ([catalog](https://developers.google.com/earth-engine/datasets/catalog/NOAA_VIIRS_DNB_ANNUAL_V22), [STAC](https://earthengine-stac.storage.googleapis.com/catalog/NOAA/NOAA_VIIRS_DNB_ANNUAL_V22.json)). V2.1 covers 2013–2021 only. No V2.3 announced ([EOG VNL](https://eogdata.mines.edu/products/vnl/)) |
| EOG direct downloads | eogdata.mines.edu | — | — | same | — | **"Effective June 1 2026 EOG is limiting programmatic access via OpenID Client to paid subscribers"** ([register page](https://eogdata.mines.edu/products/register/)); tokens expire in 5 min. Not usable in CI without paying → GEE is the source of record |
| EOG monthly VCMCFG / VCMSLCFG | GEE | 2012-04 → 2026-08 | 463.83 m | same | none | not filtered for fires/boats/aurora; monsoon months have poor coverage; monthly features are a stretch, not MVP ([catalog](https://developers.google.com/earth-engine/datasets/catalog/NOAA_VIIRS_DNB_MONTHLY_V1_VCMCFG)) |
| NASA Black Marble VNP46A2 (daily) | GEE | 2012-01-19 → 2026-10 | 500 m | NASA open data, cite DOI | none | the only Black Marble product on GEE ([catalog](https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP46A2), [nighttime tag](https://developers.google.com/earth-engine/datasets/tags/nighttime)); annual composites can be built on GEE with `Mandatory_Quality_Flag == 0` |
| NASA Black Marble VNP46A4 (yearly, Collection 2) | LAADS DAAC (Earthdata login + bearer token; Classic API retired, use API v2) | 2012 → 2025 (2026 partial: S-NPP deliveries cease 2026-11-02) | 15 arc-sec | "openly shared, without restriction", DOI 10.5067/VIIRS/VNP46A4.002 | PH needs 5 tiles (h29v07, h29v08, h30v06, h30v07, h30v08) ≈ 378 MB/year, ≈ 5.3 GB for 14 years | ([LAADS VNP46A4](https://www.earthdata.nasa.gov/data/catalog/laads-vnp46a4-2-0), [S-NPP alert](https://www.earthdata.nasa.gov/data/alerts-outages/content/data-alert-history/22341), [tile sizes](https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A4/2023/001/)). Float radiance, yearly SNPP spectral-response correction, SDS `AllAngle_Composite_Snow_Free` + `_Quality` ([user guide C2.0](https://www.earthdata.nasa.gov/s3fs-public/2025-05/BlackMarbleUserGuide_Collection2.0.pdf)) |
| NASA Black Marble VJ146A4 (NOAA-20 yearly) | LAADS | 2018 → | 15 arc-sec | same, DOI 10.5067/VIIRS/VJ146A4.002 | same | the continuity series; 2018–2025 overlap calibrates against VNP46A4 ([LAADS VJ146A4](https://www.earthdata.nasa.gov/data/catalog/laads-vj146a4-2)) |

Known biases to document on the methodology page: EOG excludes moonlit data and applies a 12-month median outlier filter; Black Marble applies a lunar BRDF correction; the summer monsoon leaves at least one month without usable data over the Philippines, and a 2026 ISPRS study on Samar–Leyte finds valid VNP46A2 observations "intermittent, seasonally structured, spatially heterogeneous" ([ISPRS 2026](https://isprs-archives.copernicus.org/articles/XLIX-B2-2026/1091/2026/)); a 2020 S-NPP DNB dark-offset change caused striping until a LUT fix ([SPIE 2021](https://astronomicaltelescopes.spiedigitallibrary.org/conference-proceedings-of-spie/11829/118290V/Restoration-of-degraded-Suomi-NPP-VIIRS-DNB-nighttime-imagery-induced/10.1117/12.2593739.full)). The US federal funding lapse of 2025-10-01 → 2025-11-12 froze NASA web updates; whether LAADS distribution stopped is **[U]**.

### 1.2 Vegetation

| Product | Where | Years | Resolution | Licence | Notes |
|---|---|---|---|---|---|
| MOD13Q1 v061 (Terra) | GEE `MODIS/061/MOD13Q1` | 2000-02 → 2026-09 | 250 m, 16-day | "no restrictions on subsequent use, sale, or redistribution" ([catalog](https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD13Q1)) | the paper's series. **Terra end of science: February 2027** ([NASA](https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era), [Earthdata alert](https://www.earthdata.nasa.gov/data/alerts-outages/transition-from-modis-viirs)); orbit drift already shifts the crossing time. Raw tiles would be about 62 GB for 2012–2025 ([LAADS](https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/61/MOD13Q1/2023/001/)): never download; use GEE |
| VNP13A1 (S-NPP) | GEE `NASA/VIIRS/002/VNP13A1` | 2012-01 → 2026-09 | 500 m, 16-day | NASA | NDVI/EVI/EVI2 ([catalog](https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP13A1)); also ends with S-NPP; NOAA-20 VJ113A1 on GEE **[U]** |
| Landsat C2 L2 | GEE | 1984 → | 30 m | public domain, credit USGS | annual greenest-pixel composite as a sensor-independent cross-check |
| Sentinel-2 SR harmonized | GEE `COPERNICUS/S2_SR_HARMONIZED` | 2017-03 → | 10 m | Copernicus Sentinel data terms (attribution, not CC) | 2017+ sensitivity analyses and case-study LGUs only |

### 1.3 Context covariates

| Dataset | Licence | Resolution / years | Access | LGU aggregates publishable? |
|---|---|---|---|---|
| CPH 2020 city/municipal population | PSA, CC BY (OpenSTAT terms) | LGU, 2020 | PSA xlsx (URL **[U]**) or OpenSTAT PX-Web ([OpenSTAT](https://openstat.psa.gov.ph/PXWeb/pxweb/en/DB/DB__1A__PO/)) | yes |
| WorldPop | CC BY 4.0 ([hub](https://hub.worldpop.org/geodata/summary?id=78816)) | 100 m; GEE `WorldPop/GP/100m/pop` 2000–2020; Global 2 R2024B PHL 2015–2030 ([data.worldpop.org](https://data.worldpop.org/GIS/Population/Global_2015_2030/R2024B/2020/PHL/v1/100m/)) | GEE or 59 MB GeoTIFF per year | yes |
| GHSL R2023A built-up surface and population | CC BY 4.0, cite Pesaresi et al. 2024 ([how to cite](https://human-settlement.emergency.copernicus.eu/GHSLhowToCite.php)) | 100 m, 1975–2030 in 5-year steps; GEE `JRC/GHSL/P2023A/GHS_BUILT_S`, `GHS_POP` | GEE | yes |
| Copernicus DEM GLO-30 (`COPERNICUS/DEM/GLO30_2024_1`) / SRTM | own free licence / public | 30 m | GEE | yes |
| CHIRPS daily / ERA5-Land monthly | CC0 / Copernicus C3S licence | 0.05° / 11 km | GEE | yes |
| Meta Relative Wealth Index | HDX licence field "Other"; Meta states no licence; CC BY 4.0 **[U]** ([HDX](https://data.humdata.org/dataset/relative-wealth-index)) | 2.4 km, April 2021 | HDX CSV | comparator only, never a headline feature; confirm terms before redistribution |
| Meta/CIESIN HRSL PH | CC BY ([HDX](https://data.humdata.org/dataset/philippines-high-resolution-population-density-maps-demographic-estimates)) | 30 m, 2019–2022 | HDX | yes |
| OSM roads / buildings | ODbL. Per-LGU statistics are neither clearly a Produced Work nor clearly a Derivative Database ([OSMF guideline](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline), [legal FAQ](https://osmfoundation.org/wiki/Licence/Licence_and_Legal_FAQ)) | — | Geofabrik extract | **kept out of the headline model**; if used, columns are labelled ODbL-sourced and the extraction script plus extract date are published |
| Google Open Buildings v3 / Temporal v1 | CC BY 4.0 (temporal: CC BY 4.0 or ODbL at the user's choice) | PH, 2023 / 2016–2023 annual | GEE | yes (a cleaner "built structure count" than OSM) |
| Microsoft building footprints | CDLA-Permissive 2.0 ([repo](https://github.com/microsoft/GlobalMLBuildingFootprints)) | updated 2026-08 | download | yes |
| PhilSA / NAMRIA / PAGASA | PhilSA dashboard exists (2024-08); NAMRIA products are request-based with no open licence **[U]**; PAGASA station data is fee-based | — | — | not used; CHIRPS/ERA5-Land replace PAGASA |

### 1.4 Labels: PSA

| File (names from snippets, **confirm by hand**) | Rounds | Content |
|---|---|---|
| `2018 - 2021 SAE_with PSGC_noHUC.xlsx` (about 962 kB) on the [stat tables page](https://psa.gov.ph/statistics/poverty-sae/stat-tables) | 2018, 2021 | estimate, SE, CV, CI per LGU with PSGC; HUCs excluded |
| 2023 SAE tables (name **[U]**; presented 2026-02-16) | 2023 | 1,611 units; EOG lights used as a covariate |
| 2009/2012/2015 workbook; separate 2012 and 2006/2009 files | 2006–2015 | 9-digit PSGC codes (pre-2021 revision) |
| FY2021 and FY2023 official poverty statistics (FIES) ([2023 publication, 2024-08-15](https://psa.gov.ph/sites/default/files/phdsd/2023%20FY%20Official%20Poverty%20Statistics%20Publication_15August2024.pdf)) | 2021, 2023 | provincial and HUC incidence; HUC rows for the map |
| 2021 SAE highlights ([PDF](https://www.psa.gov.ph/system/files/phdsd/Highlights%20of%20the%202021%20SAE.pdf)) | 2021 | methodology text, CV counts |

Terms: OpenSTAT datasets are "Open Data with Creative Commons Attribution License (cc-by)": credit PSA, link to the terms, indicate changes, no endorsement ([terms](https://openstat.psa.gov.ph/Terms), [product agreement](https://openstat.psa.gov.ph/Metadata/Open-Data-Product-Agreement)). Whether the SAE xlsx hosted on psa.gov.ph is covered by the OpenSTAT terms is **[U]**: the site will attribute PSA on every view and cite the terms page, and OPEN-QUESTIONS.md asks whether to email PSA for confirmation.

### 1.5 Boundaries and codes

| Dataset | Facts | Use |
|---|---|---|
| **HDX COD-AB PHL** (`cod-ab-phl`, [HDX](https://data.humdata.org/dataset/philippines-administrative-levels-0-to-3)) | licence **CC BY-IGO**; source NAMRIA + PSA, contributor OCHA; v03; ADM1 17 / ADM2 88 / ADM3 **1,642** / ADM4 11,920; created 2018-02-09, reviewed 2024-04-01, resources modified 2026-05-28; GeoJSON 1.06 GB, gdb 361 MB, xlsx 9.3 MB; caveat "indicative boundaries and not official"; 10-digit pcodes consistent with PSGC as of 2023 (UNOSAT copy) | **primary**; 1,642 = 149 cities + 1,493 municipalities, so the eight 2024 SGA municipalities appear to be included (**inference, [U]**) |
| geoBoundaries gbOpen PHL ADM3 ([API](https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM3/)) | 1,647 units, year 2020, built 2023-12-12 from HDX; CC BY 4.0 site-wide; full GeoJSON 532 MB, simplified 7.07 MB | schema-different mirror (`automatic: false`) and the quick-start geometry |
| PSGC quarterly publication ([PSGC page](https://psa.gov.ph/classification/psgc), blocked today) | latest evidence Q4 2025 (2026-01-13, third-party) and Q1 2026 bundled in CRAN `psgc` ([README](https://cran.r-project.org/web/packages/psgc/readme/README.html)); 18 regions, 82 provinces, 149 cities, 1,493 municipalities, 16 Manila sub-municipalities **[U counts]**; file pattern `PSGC-<Q>Q-<YYYY>-Publication-Datafile.xlsx` **[U]** | code master and crosswalk; PSGC Revision 1 (2021) widened codes from 9 to 10 digits ([RSSO IV-A resolution](https://rsso04a.psa.gov.ph/sites/default/files/RSC%20Resolution%20No.%20IV-A-13-2024%20PSIC%20and%20PSGC.pdf)), so 2006–2018 files need a 9→10 crosswalk (the `psgc` R package ships one) |

Boundary and code changes 2012→2026 the crosswalk must encode: Davao Occidental (2013); BARMM replaces ARMM (2019-02-26) with Cotabato City and 63 Cotabato barangays as the Special Geographic Area; Sto. Tomas (2019) and Carmona (2023) become cities; Maguindanao del Norte/Sur split (2022-09-17); ten barangays move Makati → Taguig (3Q 2023 PSGC); **eight SGA municipalities ratified 2024-04-13** (Pahamuddin, Kadayangan, Nabalawag, Old Kaabakan, Kapalawan, Malidegao, Tugunan, Ligawasan; municipalities 1,485 → 1,493, [PSA press release](https://psa.gov.ph/system/files/scd/Press-Release-Eight-New-Mun-in-BARMM-April%202024.pdf)); Negros Island Region (RA 12000, 2024); Sulu out of BARMM (2024–2025). **Rule:** one analysis vintage (PSGC as of the 2023 SAE) with a many-to-one map from every earlier vintage; LGUs that split or merge get a `comparable_since` field and the UI says so.

## 2. Zonal statistics: Earth Engine vs local vs Rust

| Option | Verified facts | Cost for this project | Verdict |
|---|---|---|---|
| **Earth Engine (noncommercial Community tier)** | 150 EECU-h/month per project since 2026-04-27, soft limit then "restricted mode"; individuals doing noncommercial work are eligible; service accounts work for noncommercial projects; limits 10 MB request payload (upload polygons as an asset), 100 MiB aggregation result, about 2 concurrent batch tasks ([tiers](https://developers.google.com/earth-engine/guides/noncommercial_tiers), [eligibility](https://earthengine.google.com/noncommercial/), [usage limits](https://developers.google.com/earth-engine/guides/usage), [service accounts](https://developers.google.com/earth-engine/guides/service_account)) | about 1,640 polygons × 14 years × about 5 bands per product; PH is about 1.4 M 500-m pixels per band; a few EECU-hours in total **[U]** (a 12-band `reduceRegions` over a few regions profiled at about 0.4 EECU-s, [geetools](https://geetools.readthedocs.io/en/stable/usage/profile.html)); profile one year first | **Primary** for VIIRS annual, MODIS, VNP13, WorldPop, GHSL, DEM, CHIRPS. Nothing is downloaded; outputs are CSV/Parquet tables |
| **exactextract 0.3.0 in GitHub Actions** | Python bindings (0.3.0, 2025-12-01; raster-parallel processor) ([releases](https://github.com/isciences/exactextract/releases)); exact pixel-coverage fractions; Florida 67 counties × 1,555 timesteps in about 10–13 s when chunked well ([performance](https://isciences.github.io/exactextract/performance.html)); public-repo runners are **4 vCPU / 16 GB / 14 GB SSD**, 6 h per job ([runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [limits](https://docs.github.com/en/actions/reference/limits)) | Black Marble: about 378 MB/year of HDF5 to fetch with an Earthdata token stored as a secret; minutes per year | **Secondary**: Black Marble (not on GEE) and the cross-check that GEE's area weighting (`reduceRegions` with `scale` and a mean reducer, not exact coverage) agrees with exact extraction on VIIRS 2020 to within a stated tolerance |
| Rust GDAL / georust | `gdal` 0.19.0 binds libgdal 3.4–3.11 ([docs.rs](https://docs.rs/gdal/latest/gdal/)); SedonaDB `RS_ZonalStats` 0.5.0 is centroid-in-polygon by default ([Sedona](https://sedona.apache.org/sedonadb/latest/reference/sql/rs_zonalstats/)); no pure-Rust exactextract equivalent found | would mean writing or wrapping a coverage-fraction rasteriser | **Not for zonal statistics.** The Rust-only rule is about the backend, and the backend starts where the feature table exists (ARCHITECTURE-RESEARCH.md §3). The Rust CLI does validate, harmonise and materialise the tables |

Reproducibility rules: every GEE call pins the asset ID and version, the polygon asset ID and its sha256, the reducer and scale; the exported table includes those as columns; the same for exactextract (file names, DOIs, tool versions). A `features.parquet` is rebuilt only when an input version changes, and the rebuild is compared column-by-column with the previous version (archivekit's `checks.profile` anomaly gate: key set, per-year row counts, numeric ranges).

## 3. Feature store schema (proposal)

`features.parquet`: one row per (psgc10, year), columns grouped by family with a `source_version` string per family:

- identity: `psgc10`, `name`, `province_psgc`, `region_psgc`, `island_group`, `lgu_class` (city/municipality/sub-municipality), `comparable_since`;
- lights (EOG): `ntl_mean`, `ntl_median`, `ntl_sum`, `ntl_lit_frac`, `ntl_gini`, `ntl_cf_cvg_mean`, `ntl_per_capita`; lights (Black Marble): `bm_mean`, `bm_sum`, `bm_quality_frac`, `bm_platform`;
- vegetation: `ndvi_mean`, `ndvi_dry`, `ndvi_wet`, `ndvi_amp`, `evi_mean`, …, `vnp_ndvi_mean` (continuity), `landsat_ndvi_max`;
- context: `pop`, `pop_density`, `built_s`, `elev_mean`, `rugged`, `rain_annual`;
- derived (computed by the Rust core, not stored twice): lags, slopes, logs.

`labels.parquet`: (psgc10, round_year, estimate, se, cv, ci_lo, ci_hi, estimator ∈ {ELL, CensusEB}, source_file, source_sha256).

Sizes: about 23k feature rows × about 40 columns, a few MB; labels about 8k rows. Everything fits in git (< 100 MB per file) and in the HF dataset viewer.

## 4. Versioning, publishing and provenance

- The repo tags a data release (`data-v1`, …); the Zenodo GitHub integration mints a version DOI under a concept DOI (50 GB / 100 files per record, [Zenodo limits](https://support.zenodo.org/help/en-gb/1-upload-deposit/80-what-are-the-size-limits-in-zenodo), [DOI versioning](https://support.zenodo.org/help/en-gb/1-upload-deposit/97-what-is-doi-versioning)); the release carries `features.parquet`, `labels.parquet`, `read-models.tar.zst` and `provenance.json` (dataset IDs and versions, GEE asset IDs, PSGC vintage, commit SHA, archivekit `data_version_metadata`).
- The Hugging Face dataset `permission-alluring/lgu-lights` mirrors the Parquet for the viewer and serves PMTiles/JSON as a fallback base URL (HF LFS files answer Range requests with 206 after a 302, verified; public storage is "best-effort" free, [storage limits](https://huggingface.co/docs/hub/en/storage-limits)).
- Read models are published as immutable `v<N>/` folders with a `latest.json` pointer flipped only after every check passes (DATA-ARCHIVING.md §5); rollback flips the pointer.
- Licence of the published table: CC BY 4.0, with the attribution block listing EOG (CC BY 4.0 + notice + Elvidge et al. 2021), NASA Black Marble (DOIs), NASA MODIS/VIIRS, WorldPop and GHSL (CC BY 4.0), PSA (CC BY, OpenSTAT terms), OCHA/NAMRIA/PSA boundaries (CC BY-IGO), and any ODbL-sourced column flagged as such.

## 5. Update cadence and CI budget

| Trigger | Job | Where | Minutes **[U]** |
|---|---|---|---|
| weekly | `archivekit health` + snapshot of small sources (PSA xlsx, PSGC, boundaries if changed) | private archive repo (private minutes: budget about 20/month per DATA-ARCHIVING.md §8) | 3–5 per run |
| new VIIRS annual composite on GEE (about April–June) | GEE zonal stats for the new year → features rebuild → training → materialise → publish | public repo (free) | 20–40 |
| new Black Marble year | LAADS fetch (about 0.4 GB) → exactextract → merge | public repo | 10–20 |
| new PSA SAE round | labels update → full retrain → validation report → publish | public repo | 20–40 |
| quarterly | PSGC diff check; crosswalk update if needed | public repo | 2 |

## 6. `archivekit` registry draft (proposal, not yet a file in use)

Notes on fit with the kit's schema (`data-archive-kit/schema/sources.schema.json`): `format` has no `xlsx` or `tif` value, so PSA/PSGC workbooks are declared as `zip` with a `zip_member` check on a worksheet XML (an xlsx is a zip), and rasters are `remote-dataset` entries processed in GEE or fetched by the pipeline's own LAADS client. Adding `xlsx` and `hdf5`/`tif` formats to the kit is proposed in OPEN-QUESTIONS.md Q12.

```yaml
# yaml-language-server: $schema=../../data-archive-kit/schema/sources.schema.json
version: 1
project: lgu-lights

archive:
  repo: abrycta/lgu-lights-archive
  token_env: ARCHIVE_READ_TOKEN
  tag_format: "{id}-{date}"
  compression: zstd
  compression_level: auto

health:
  issue_label: source-health
  issue_title_prefix: "lgu-lights source"
  issue_token_env: ARCHIVE_READ_TOKEN
  token_expiry_warn_days: 30
  token_expires: "2027-10-31"            # set when the token is created
  user_agent: "lgu-lights-pipeline/0.1 (+https://github.com/abrycta/lgu-lights)"
  heartbeat_days: 14

sources:
  # ---------------------------------------------------------------- labels (PSA)
  - id: psa-sae-2018-2021
    description: PSA Small Area Estimates of poverty, cities and municipalities, 2018 and 2021, with PSGC (no HUCs)
    kind: file
    format: zip                            # xlsx is a zip; see note above
    filename: psa-sae-2018-2021.xlsx
    local_path: data/raw/psa/psa-sae-2018-2021.xlsx
    licence: "CC BY (PSA OpenSTAT terms of use; coverage of this file to be confirmed with PSA)"
    attribution: "Philippine Statistics Authority, 2021 Small Area Estimates of Poverty"
    cadence: once per SAE round (about every 2–3 years)
    hooks: ["lgu.sources:check_sae"]     # PSGC column present, 1,612 rows, CV numeric
    links:
      - id: psa-stat-tables
        url: https://psa.gov.ph/…/2018 - 2021 SAE_with PSGC_noHUC.xlsx   # confirm by hand (site blocks bots)
        probe_html: false
      - id: archive
        archive: true
    checks:
      bytes: { min: 500000, max: 3000000 }
      zip_member: "xl/worksheets/sheet1.xml"
      member_format: xml
    archived: { enabled: true, retention: all, max_age_days: 400 }

  - id: psa-sae-2023
    description: PSA Small Area Estimates of poverty 2023 (Census EB; presented 2026-02-16)
    kind: file
    format: zip
    filename: psa-sae-2023.xlsx
    local_path: data/raw/psa/psa-sae-2023.xlsx
    licence: "CC BY (PSA OpenSTAT terms; to be confirmed)"
    attribution: "Philippine Statistics Authority, 2023 Small Area Estimates of Poverty"
    cadence: once
    hooks: ["lgu.sources:check_sae"]
    links:
      - { id: psa-stat-tables, url: "https://psa.gov.ph/…"  }           # confirm by hand
      - { id: archive, archive: true }
    checks: { bytes: { min: 300000, max: 3000000 }, zip_member: "xl/worksheets/sheet1.xml", member_format: xml }
    archived: { enabled: true, retention: all }

  - id: psa-sae-2006-2015
    description: PSA/NSCB SAE 2006, 2009, 2012, 2015 (ELL; 9-digit PSGC)
    kind: file
    format: zip
    filename: psa-sae-2006-2015.xlsx
    local_path: data/raw/psa/psa-sae-2006-2015.xlsx
    licence: "CC BY (PSA OpenSTAT terms; to be confirmed)"
    attribution: "Philippine Statistics Authority / NSCB, Small Area Estimates of Poverty"
    cadence: static
    links:
      - { id: psa-stat-tables, url: "https://psa.gov.ph/…" }             # confirm by hand
      - { id: archive, archive: true }
    checks: { bytes: { min: 200000, max: 5000000 }, zip_member: "xl/worksheets/sheet1.xml", member_format: xml }
    archived: { enabled: true, retention: all }

  - id: psa-fies-2023-provincial
    description: 2023 Full Year Official Poverty Statistics (provincial and HUC incidence), PDF tables
    kind: file
    format: text
    filename: psa-fies-2023.pdf
    local_path: data/raw/psa/psa-fies-2023.pdf
    licence: "PSA publication; figures reused with attribution (CC BY per OpenSTAT for the data)"
    attribution: "Philippine Statistics Authority, 2023 Full Year Official Poverty Statistics (2024-08-15)"
    cadence: once per FIES round
    links:
      - { id: psa-pdf, url: "https://psa.gov.ph/sites/default/files/phdsd/2023%20FY%20Official%20Poverty%20Statistics%20Publication_15August2024.pdf" }
      - { id: archive, archive: true }
    checks: { bytes: { min: 500000, max: 50000000 }, contains: "Poverty Incidence" }
    archived: { enabled: true, retention: all }

  # ---------------------------------------------------------------- codes and boundaries
  - id: psgc-publication
    description: Philippine Standard Geographic Code, quarterly publication datafile
    kind: file
    format: zip
    filename: psgc-publication.xlsx
    local_path: data/raw/psgc/psgc-publication.xlsx
    licence: "CC BY (PSA OpenSTAT terms)"
    attribution: "Philippine Statistics Authority, Philippine Standard Geographic Code"
    cadence: quarterly
    hooks: ["lgu.sources:check_psgc"]     # 10-digit codes, expected counts by level
    links:
      - { id: psa-psgc, url: "https://psa.gov.ph/system/files/scd/PSGC-…-Publication-Datafile.xlsx" }   # confirm by hand
      - { id: archive, archive: true }
    checks: { bytes: { min: 1000000, max: 20000000 }, zip_member: "xl/worksheets/sheet1.xml", member_format: xml }
    archived: { enabled: true, retention: all }

  - id: cod-ab-phl-adm3
    description: OCHA COD-AB Philippines admin level 3 (cities and municipalities), NAMRIA/PSA, v03, PSGC pcodes
    kind: file
    format: geojson
    filename: phl_admbnda_adm3_psa_namria.geojson
    local_path: data/raw/boundaries/cod-ab-phl-adm3.geojson
    licence: "Creative Commons Attribution for Intergovernmental Organisations (CC BY-IGO)"
    attribution: "OCHA Philippines; NAMRIA; Philippine Statistics Authority (COD-AB PHL v03, reviewed 2024-04-01). Boundaries are indicative and not official."
    cadence: yearly review
    hooks: ["lgu.sources:check_adm3"]     # ADM3_PCODE 10-digit, about 1,642 features, valid polygons
    links:
      - { id: hdx-geojson, url: "https://data.humdata.org/dataset/philippines-administrative-levels-0-to-3/resource/…" }   # confirm resource URL (HDX blocks bots)
      - id: geoboundaries-simplified
        url: https://www.geoboundaries.org/api/current/gbOpen/PHL/ADM3/   # resolves to the simplified GeoJSON link
        automatic: false                 # different schema (shapeID, no PSGC); needs an adapter
      - { id: archive, archive: true }
    checks:
      bytes: { min: 100000000, max: 1500000000 }
      rows: { min: 1600, max: 1700 }
      required_properties: [ADM3_PCODE, ADM3_EN, ADM2_PCODE, ADM1_PCODE]
    archived: { enabled: true, retention: all }

  # ---------------------------------------------------------------- rasters (processed in GEE or by the LAADS client; never fetched by archivekit)
  - id: viirs-annual-v22
    description: NOAA/EOG VIIRS DNB annual composites V2.2 (average_masked, median_masked, cf_cvg), 2012–2024
    kind: remote-dataset
    licence: "CC BY 4.0 (EOG products licence; derived products must carry EOG's notice)"
    attribution: "Earth Observation Group, Payne Institute for Public Policy, Colorado School of Mines; Elvidge, C.D., et al. (2021) Remote Sensing 13(5):922, doi:10.3390/rs13050922"
    cadence: yearly (new composite about April–June)
    links:
      - { id: gee, url: "https://developers.google.com/earth-engine/datasets/catalog/NOAA_VIIRS_DNB_ANNUAL_V22", probe_html: true }
      - { id: gee-stac, url: "https://earthengine-stac.storage.googleapis.com/catalog/NOAA/NOAA_VIIRS_DNB_ANNUAL_V22.json", probe_contains: "ANNUAL_V22" }
      - { id: eog, url: "https://eogdata.mines.edu/products/vnl/", probe_html: true, automatic: false }   # paid programmatic access since 2026-06-01
    archived: { enabled: false }

  - id: black-marble-vnp46a4
    description: NASA Black Marble yearly composites, Collection 2 (S-NPP VNP46A4 2012→; NOAA-20 VJ146A4 2018→), PH tiles h29v07 h29v08 h30v06 h30v07 h30v08
    kind: remote-dataset
    licence: "NASA open data, no restrictions"
    attribution: "Román, M.O., et al. NASA Black Marble VNP46A4.002, doi:10.5067/VIIRS/VNP46A4.002; VJ146A4.002, doi:10.5067/VIIRS/VJ146A4.002"
    cadence: yearly
    links:
      - { id: laads-vnp46a4, url: "https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VNP46A4/", probe_html: true }
      - { id: laads-vj146a4, url: "https://ladsweb.modaps.eosdis.nasa.gov/archive/allData/5200/VJ146A4/", probe_html: true }
    archived: { enabled: false }       # about 5 GB; the pipeline keeps a private copy of the PH tiles as release assets instead (see Q12)

  - id: modis-mod13q1
    description: MODIS Terra MOD13Q1 v061 vegetation indices (NDVI, EVI), 250 m, 16-day
    kind: remote-dataset
    licence: "No restrictions on subsequent use, sale, or redistribution (NASA LP DAAC)"
    attribution: "Didan, K. (2021). MODIS/Terra Vegetation Indices 16-Day L3 Global 250m SIN Grid V061, NASA EOSDIS LP DAAC"
    cadence: 16-day; Terra ends about February 2027
    links:
      - { id: gee, url: "https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MOD13Q1", probe_html: true }
      - { id: lpdaac, url: "https://lpdaac.usgs.gov/products/mod13q1v061/", probe_html: true }
    archived: { enabled: false }

  - id: viirs-vnp13a1
    description: VIIRS VNP13A1 vegetation indices, 500 m, 16-day (continuity series for MODIS)
    kind: remote-dataset
    licence: "NASA open data"
    attribution: "Didan, K. VIIRS/NPP Vegetation Indices 16-Day L3 Global 500m, NASA LP DAAC"
    cadence: 16-day
    links:
      - { id: gee, url: "https://developers.google.com/earth-engine/datasets/catalog/NASA_VIIRS_002_VNP13A1", probe_html: true }
      - { id: lpdaac, url: "https://lpdaac.usgs.gov/products/vnp13a1v002/", probe_html: true }
    archived: { enabled: false }

  - id: worldpop-phl-100m
    description: WorldPop constrained population, Philippines, 100 m (Global 2 R2024B) and GEE WorldPop/GP/100m/pop
    kind: remote-dataset
    licence: "CC BY 4.0"
    attribution: "WorldPop (www.worldpop.org), University of Southampton"
    cadence: yearly
    links:
      - { id: gee, url: "https://developers.google.com/earth-engine/datasets/catalog/WorldPop_GP_100m_pop", probe_html: true }
      - { id: worldpop-ftp, url: "https://data.worldpop.org/GIS/Population/Global_2015_2030/R2024B/2020/PHL/v1/100m/", probe_html: true }
    archived: { enabled: false }

  - id: ghsl-r2023a
    description: GHSL R2023A built-up surface and population, 100 m
    kind: remote-dataset
    licence: "CC BY 4.0"
    attribution: "European Commission, JRC, GHSL R2023A; Pesaresi, M., et al. (2024) IJDE, doi:10.1080/17538947.2024.2390454"
    cadence: static (5-year epochs)
    links:
      - { id: gee-built, url: "https://developers.google.com/earth-engine/datasets/catalog/JRC_GHSL_P2023A_GHS_BUILT_S", probe_html: true }
      - { id: jrc, url: "https://human-settlement.emergency.copernicus.eu/download.php", probe_html: true }
    archived: { enabled: false }

  # ---------------------------------------------------------------- comparator (never a feature)
  - id: meta-rwi-phl
    description: Meta Relative Wealth Index, Philippines, 2.4 km (April 2021); used only as a cross-sectional comparator
    kind: file
    format: csv
    filename: phl_relative_wealth_index.csv
    local_path: data/raw/rwi/phl_relative_wealth_index.csv
    licence: "HDX licence field 'Other'; terms to be confirmed before any redistribution"
    attribution: "Chi, G., Fang, H., Chatterjee, S., Blumenstock, J.E. (2022) PNAS, doi:10.1073/pnas.2113658119; Meta Data for Good"
    cadence: static
    links:
      - { id: hdx, url: "https://data.humdata.org/dataset/relative-wealth-index/resource/…" }   # confirm resource URL
      - { id: archive, archive: true }
    checks: { bytes: { min: 500000, max: 50000000 }, required_columns: [latitude, longitude, rwi, error] }
    archived: { enabled: true, retention: all }
```

What the registry deliberately does not do: fetch rasters (GEE and LAADS have their own authenticated clients, and the kit's `remote-dataset` kind exists for exactly this: health-checked, never downloaded); archive the 1 GB HDX GeoJSON more than once a year (`max_age_days`, change detection by ETag first).
