"""Vegetation after Terra (Option A, chosen by Kurt 2026-10-23; docs/architecture/TERRA-SWITCH-OPTIONS.md).

The model's NDVI and EVI are yearly means of MODIS Terra MOD13Q1. Terra stops around February 2027, so a year
that MOD13Q1 does not cover in full takes NOAA-20 VJ113A1 (VIIRS, 500 m) instead, mapped onto the MOD13Q1 series
per LGU with a calibration fitted on the overlap years (2018 onwards), the way the Black Marble NOAA-20 years
are calibrated (lgu.laads.calibrate_lit). Per index (NDVI, EVI):

    mod13q1 ~= slope * vj113a1 + offset[lgu]

The slope is national (the within-LGU slope over all LGU-years of the overlap). Each LGU gets its own offset, the mean of
(MOD13Q1 - slope * VJ113A1) over its overlap years, when that beats the national offset out of sample
(leave-one-year-out) and it has at least MIN_YEARS overlap years; otherwise it takes the national offset.
Offsets are capped at MAX_OFFSET_SHIFT from the national one, and calibrated values are clipped to the
feature-store range.

Which source a year uses (lgu.features.merge): MOD13Q1 when its year is complete, otherwise calibrated VJ113A1
when that year is complete, otherwise the year is left out silently. Years MOD13Q1 covers keep their MOD13Q1
values, so every published number stays as it was.

The calibration is committed as pipeline/inputs/veg_calibration.json (like bm_ratio.json) and made with
`python -m lgu veg-calibrate <features.parquet> <zonal_vj.parquet>`.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .paths import PIPELINE_DIR

CAL_PATH = PIPELINE_DIR / "inputs" / "veg_calibration.json"
INDICES = {"ndvi": ("ndvi_mean", "vj_ndvi_mean"), "evi": ("evi_mean", "vj_evi_mean")}
OVERLAP_FROM = 2018          # VJ113A1 v002 starts 2018-01-01
MIN_YEARS = 5                # overlap years an LGU needs for its own offset
MAX_OFFSET_SHIFT = 0.15      # an LGU offset further than this from the national one is clipped to it
VALUE_RANGE = (-0.2, 1.0)    # the feature-store gate range for ndvi_mean and evi_mean


def _pairs(mod: pd.DataFrame, vj: pd.DataFrame, years: list[int] | None = None) -> pd.DataFrame:
    df = mod[["adm3_pcode", "year", *(m for m, _ in INDICES.values())]].merge(
        vj[["adm3_pcode", "year", *(v for _, v in INDICES.values())]], on=["adm3_pcode", "year"], how="inner",
        validate="one_to_one")
    df = df[df.year >= OVERLAP_FROM]
    if years is not None:
        df = df[df.year.isin(years)]
    return df


def fit_index(df: pd.DataFrame, mcol: str, vcol: str) -> dict:
    """National slope and offset, per-LGU offsets where they help out of sample, and fit statistics."""
    d = df[["adm3_pcode", "year", mcol, vcol]].dropna()
    x, y = d[vcol].to_numpy(float), d[mcol].to_numpy(float)
    # within-LGU (fixed-effects) slope: LGU levels differ between the sensors (pixel size, bands), and that
    # difference goes to the offsets instead of tilting the slope
    xd = x - d.groupby("adm3_pcode")[vcol].transform("mean").to_numpy(float)
    yd = y - d.groupby("adm3_pcode")[mcol].transform("mean").to_numpy(float)
    slope = float(np.sum(xd * yd) / np.sum(xd * xd))
    nat = float(np.mean(y - slope * x))
    d = d.assign(r=y - slope * x)  # MOD13Q1 - slope * VJ113A1: each row's implied offset
    g = d.groupby("adm3_pcode").r
    n, s, mean = g.size(), g.transform("sum"), g.mean()
    cnt = d.adm3_pcode.map(n)
    # leave-one-year-out error of an own offset vs the national offset, per LGU
    loo = ((s - d.r) / (cnt - 1)).where(cnt > 1)
    own_err = (d.r - loo).abs().groupby(d.adm3_pcode).mean()
    nat_err = (d.r - nat).abs().groupby(d.adm3_pcode).mean()
    use = (n >= MIN_YEARS) & (own_err < nat_err)
    offsets = mean[use].clip(nat - MAX_OFFSET_SHIFT, nat + MAX_OFFSET_SHIFT)
    fitted = d.adm3_pcode.map(offsets).fillna(nat) + slope * d[vcol]
    resid = d[mcol] - fitted
    return {"slope": slope, "offset": nat, "offsets": {k: round(float(v), 6) for k, v in offsets.sort_index().items()},
            "lgus_own": int(use.sum()), "lgus_national": int(len(n) - use.sum()),
            "offsets_clipped": int((mean[use].sub(nat).abs() > MAX_OFFSET_SHIFT).sum()),
            "r2_national": float(1 - np.sum((y - (slope * x + nat)) ** 2) / np.sum((y - y.mean()) ** 2)),
            "mae_in_sample": float(resid.abs().mean())}


def fit(mod: pd.DataFrame, vj: pd.DataFrame, years: list[int] | None = None) -> dict:
    df = _pairs(mod, vj, years)
    cal = {"method": "mod13q1 = slope * vj113a1 + offset[adm3_pcode] (national offset where the LGU's own does not "
                     "help out of sample); docs/architecture/TERRA-SWITCH-OPTIONS.md, Option A",
           "overlap_years": sorted(int(y) for y in df.year.unique()), "computed": time.strftime("%Y-%m-%d")}
    for k, (m, v) in INDICES.items():
        cal[k] = fit_index(df, m, v)
    return cal


def apply(vj: pd.DataFrame, cal: dict) -> pd.DataFrame:
    """VJ113A1 rows (adm3_pcode, year, vj_ndvi_mean, vj_evi_mean) -> calibrated (adm3_pcode, year, ndvi_mean,
    evi_mean) on the MOD13Q1 scale."""
    out = vj[["adm3_pcode", "year"]].copy()
    for k, (m, v) in INDICES.items():
        c = cal[k]
        off = vj.adm3_pcode.map(pd.Series(c["offsets"], dtype=float)).fillna(c["offset"])
        out[m] = (c["slope"] * vj[v] + off).clip(*VALUE_RANGE)
    return out


def validate(mod: pd.DataFrame, vj: pd.DataFrame, fit_years: list[int], test_years: list[int]) -> dict:
    """Out-of-sample check: fit on fit_years, compare calibrated VJ113A1 with MOD13Q1 in test_years, against the
    typical change in NDVI between rounds (three years apart: the median |d_ndvi| scale)."""
    cal = fit(mod, vj, fit_years)
    test = _pairs(mod, vj, test_years)
    pred = apply(test, cal)
    rep: dict = {"fit_years": fit_years, "test_years": test_years}
    m = mod.sort_values(["adm3_pcode", "year"])
    for k, (mc, _) in INDICES.items():
        err = (pred[mc] - test[mc]).abs().dropna()
        lag = m.groupby("adm3_pcode")[mc].shift(3)
        typical = float((m[mc] - lag).abs().median())
        rep[k] = {"mae": float(err.mean()), "median_abs_err": float(err.median()),
                  "p90_abs_err": float(err.quantile(0.9)), "bias": float((pred[mc] - test[mc]).mean()),
                  "median_abs_change_3y": typical}
    return rep


def load(path: Path = CAL_PATH) -> dict | None:
    if not path.exists():
        return None
    cal = json.loads(path.read_text())
    if not all(k in cal and {"slope", "offset", "offsets"} <= set(cal[k]) for k in INDICES):
        raise RuntimeError(f"{path}: not a VJ113A1 -> MOD13Q1 calibration")
    return cal
