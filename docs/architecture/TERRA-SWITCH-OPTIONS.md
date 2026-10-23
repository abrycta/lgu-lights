# Vegetation after Terra: options (audit L-C6)

Status: **Option A chosen by Kurt 2026-10-23** (without the NOAA-21 mirror; see `docs/DECISIONS.md`). Researched 2026-10-23.

## 1. The problem in one paragraph

Lights takes yearly NDVI and EVI per LGU from MODIS **Terra** `MOD13Q1` v061 (250 m, 16-day) in Earth Engine
(`pipeline/lgu/ee_zonal.py:24`). The model uses three vegetation features: `ndvi`, `d_ndvi` (NDVI now minus NDVI
in the last PSA round year) and `evi` (`pipeline/lgu/train.py:57`). Terra stops producing science data around
**February 2027**, so no full 2027 year of MOD13Q1 will ever exist. The audit says such a run "fails safely". That is
only partly true (§3).

## 2. Facts checked today (2026-10-23)

| Item | Finding | Source |
|---|---|---|
| Terra end of science | **February 2027** (projection; fuel and power limits). Terra drifts already: equator crossing about 10:15 by fall 2022 | [NASA, "Terra: the end of an era", updated 2026-03-20](https://science.nasa.gov/science-research/earth-science/terra-the-end-of-an-era) |
| Aqua end of science | **September 2027** | same page |
| S-NPP | new data deliveries **stop 2026-11-02** (so VNP13A1 ends too) | [Earthdata alert 22341](https://www.earthdata.nasa.gov/data/alerts-outages/content/data-alert-history/22341), [VIIRS transition resources](https://www.earthdata.nasa.gov/data/instruments/viirs/transition-resources) |
| MOD13Q1 v061 | CMR and EE both current to composite 2026-09-30 | CMR `C1748066515-LPCLOUD`; EE STAC `MODIS_061_MOD13Q1` |
| **VJ113A1 v002** (NOAA-20) | in CMR since **2018-01-01**, open-ended, latest composite 2026-09-22; LP DAAC cloud, **also on LAADS** `allData/5200/VJ113A1` (the path `laads.py` already uses; listing checked today) | CMR `C2519122065-LPCLOUD`, DOI 10.5067/VIIRS/VJ113A1.002 |
| VJ113A1 on Earth Engine | **No.** EE STAC has `NASA_VIIRS_002_VNP13A1` (S-NPP, ends with S-NPP) but no `VJ113A1` or `VJ213A1` (404 today); spike S3 found the same | EE STAC catalog |
| VJ113A1 grid and cadence | 500 m (463 m) MODIS sinusoidal, 16-day composites **released every 8 days (46 per year)**, layers NDVI, EVI, EVI2 + pixel reliability. MOD13Q1 is 250 m, 23 per year | LAADS listing 2025: DOY 001, 009, 017 … |
| VJ113A1 size for the 5 PH tiles | about 94 MB per composite date → about 4.3 GB per year (2.2 GB if only MOD13Q1's DOY phase 001, 017, … is used) | LAADS listing, DOY 2026-265 |
| NOAA-21 VJ213A1 v002 | same format, since 2023-02-10, on LAADS: a natural mirror/fallback for VJ113A1 | CMR `C2817367150-LPCLOUD` |
| EE noncommercial quota | Community tier **150 EECU-hours per month**, per project, in force since 2026-04-27; past it EE slows down rather than bills | [EE noncommercial tiers](https://developers.google.com/earth-engine/guides/noncommercial_tiers) |
| GitHub Actions | `abrycta/lgu-lights` is public: minutes are free; runner disk is the limit (handled: `laads.py` deletes each year's files) | `gh repo view` |
| How much vegetation matters | in the published v5 model all nine satellite features together improve the 2023 backtest MAE from 5.576 to 5.545 pp; the three vegetation features carry about 2 % of total gain (`d_ndvi` 9.1k, `evi` 8.0k, `ndvi` 7.3k of 1.22M) | `data-v5/metrics.json` |

## 3. What actually happens in 2027 if nothing changes

- A run cannot include 2027 before the NOAA-20 Black Marble yearly product for 2027 (`VJ146A4`) exists, since
  `laads.py` raises on missing tiles. Judging by 2025 (published by October 2026), that is **around mid or late 2028**.
- By then MOD13Q1 will hold **only January–February 2027 composites** (if Terra delivers to its end date). The
  2027 yearly mean would be a dry-season mean, present for nearly every LGU, so the feature-store gate (`features.py`:
  at least 95 % non-missing, values in range) **passes**. The run would publish biased 2027 vegetation silently, not
  fail. Only if Terra delivers nothing in 2027 does the gate fail as the audit expects.
- So, whatever Kurt chooses, Lights needs a **completeness gate**: a yearly vegetation mean counts only if it has
  most of the year's composites (for example at least 20 of 23 for MOD13Q1). This is small, needs no choice, and is
  listed as a follow-up below.
- The `vj113a1` switch in `.github/data-run.json` exists but has **never run in CI** (`features-v1` has no
  `zonal_vj.parquet`), and `laads.zonal_vj113a1` reads NDVI only, not EVI.

## 4. Options

### Option A. Calibrate NOAA-20 VJ113A1 onto the MODIS series (the Black Marble pattern) — recommended

How: the vegetation product becomes per-year, like `bm_product()` in PR #40: `MOD13Q1` up to 2026, `VJ113A1` from
2027. VJ113A1 NDVI and EVI are computed per LGU for the overlap years **2018–2026** (nine years; 2026 is the last
full Terra year, complete around mid-January 2027). Each LGU gets its own mapping from VJ113A1 to MOD13Q1
(offset per LGU, slope national, fitted separately for NDVI and EVI), with the national mapping where an LGU's fit
is poor, the way `calibrate_lit` falls back to the national ratio. NOAA-21 `VJ213A1` is added as a mirror.

- **Model:** unchanged. No re-train; `d_ndvi` compares calibrated NOAA-20 values with MODIS values of the round
  year, which is what the calibration is for.
- **Proof before use:** fit on 2018–2024, test on 2025–2026: per-LGU error of calibrated VJ113A1 against MOD13Q1
  must be well below the typical change in NDVI between rounds (median |`d_ndvi`|). A swap test then replaces 2023
  MODIS values with calibrated VJ113A1 values, re-predicts 2023 with the published model and reports how far the
  estimates move. If they move more than, say, 0.5 pp at the median, fall back to Option C.
- **Past numbers:** unchanged. Every year to 2026 keeps MOD13Q1 values (already archived in the `features-v1`
  release), the model file is reused, and a parity run like PR #40's shows the design rows and read models for
  2012–2025 byte-identical.
- **Cost:** free. LAADS with the existing Earthdata login; a nine-year backfill downloads about 20–40 GB once, then
  about 2–4 GB per new year, on free public-repo runners. No new EE load.
- **Risk:** low to medium. VIIRS and MODIS differ in bands and pixel size (500 m vs 250 m), so small LGUs
  (Manila districts, island towns) fit worse; the national fallback covers them. NOAA-20 itself is an aging
  satellite (launched 2017); NOAA-21 is the fallback with overlap from 2023.
- **Effort:** about 1–2 agent days: read EVI too and only MOD13Q1's DOY phase in `laads.py`; `veg_product(year)`
  and the calibration function with tests; completeness gate; `sources.yaml` mirror; one data run with
  `vj113a1: true` for 2018–2026 (canary first, rule 18); the calibration report in `docs/`.

### Option B. Re-train on a VIIRS-only vegetation series (VJ113A1, or S-NPP VNP13A1 spliced to VJ113A1)

How: drop MODIS entirely; vegetation comes from VIIRS for every year (VNP13A1 on EE 2012–2025, VJ113A1 after,
itself calibrated across the two VIIRS satellites), and the model is re-trained on it.

- **Model:** re-trained; results for every year change.
- **Past numbers:** change. They stay available only as the old immutable releases (`data-v1`…`v5`); the site would
  show a new data version with new numbers for all years, which needs a public note (not decided here).
- **Cost:** free, but heavier: a 2012–2026 VIIRS backfill plus a second calibration (S-NPP → NOAA-20).
- **Risk:** medium. It moves away from the paper's MOD13Q1 baseline, and still needs a satellite-to-satellite splice,
  so it does not remove the calibration problem; it only moves it.
- **Effort:** about 3–5 agent days plus a full re-train and review of all backtests.

### Option C. Drop vegetation from the model

How: re-train without `ndvi`, `d_ndvi`, `evi`; stop fetching MOD13Q1 (Earth Engine still serves WorldPop and SRTM).

- **Model:** re-trained. The v5 numbers suggest a very small loss (all satellite features together are worth
  0.03 pp MAE), but a vegetation-only ablation has not been run and must be, before choosing this.
- **Past numbers:** change in a new data version, as in B.
- **Cost:** none; removes a source for good.
- **Risk:** low technically; the project, its page and the paper it builds on describe Lights as night lights *and
  vegetation*, so this changes the story told about it (Kurt's call).
- **Effort:** about 1 agent day plus the re-train, the ablation and copy changes.

### Rejected stopgaps

- **Aqua MYD13Q1** (EE, same algorithm and 250 m): ends September 2027, so it never gives a full 2027 year either.
- **S-NPP VNP13A1** (EE): ends November 2026.
- **Sentinel-2 NDVI on EE** (10 m, from 2017; reliable L2A over the Philippines later): heavy cloud, a new
  compositing method and unknown EECU cost against the 150-hour monthly quota; nothing gained over Option A.

## 5. Recommendation

**Option A**, with Option C as the fallback if the swap test fails. It keeps every published number, needs no
re-train, reuses code and credentials that already exist (`laads.py`, Earthdata token, the PR #40 calibration
pattern), and costs nothing. Add the completeness gate in any case.

## 6. Deadline

- **Hard deadline:** before the first data run that includes 2027, expected when NOAA-20 Black Marble 2027
  (`VJ146A4`) appears, around mid or late 2028. Without the gate, that run would publish biased vegetation silently.
- **Practical deadline: end of March 2027.** The calibration needs the full 2026 Terra year (complete around
  mid-January 2027), and fitting it while Terra and NOAA-20 data are both fresh, with the result documented, avoids a
  rushed change in 2028. The completeness gate can ship now as a small request.

## 7. What Kurt decides

1. Option A, B or C (recommended: A, with C as fallback if the swap test shows estimates move more than about 0.5 pp).
2. Whether the completeness gate ships now as its own small PR (recommended: yes).
3. Whether NOAA-21 `VJ213A1` is registered as the mirror for VJ113A1 (recommended: yes).

## 8. Follow-ups (not done here)

- Completeness gate for yearly vegetation means (composites per year) in `ee_zonal.py` / `features.py`.
- `laads.zonal_vj113a1`: read EVI as well as NDVI, and only MOD13Q1's DOY phase; prove the path in one canary run.
- Update `docs/DATA-PLAN.md` §1.2, which still names VNP13A1 as the continuity series, and `docs/OPEN-QUESTIONS.md`
  (VJ113A1 on EE: answered, no).
- Record the choice in `docs/DECISIONS.md`.
