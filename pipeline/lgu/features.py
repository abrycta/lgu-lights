"""Merge the zonal-statistics tables into the feature store (data/build/features.parquet).

One row per (adm3_pcode, year): Black Marble radiance (bm_*), MODIS NDVI/EVI, WorldPop population,
SRTM elevation and slope, and (when computed) NOAA-20 VJ113A1 NDVI. Data-quality gates run here:
a failed gate raises, so a bad feature store is never published (DATA-ARCHIVING.md principle 4).
"""
from __future__ import annotations

from pathlib import Path

import pandas as pd

GATES = {  # column: (min, max) over non-null values
    "bm_mean": (0.0, 500.0),
    "bm_lit_frac": (0.0, 1.0),
    "bm_valid_frac": (0.0, 1.0),
    "ndvi_mean": (-0.2, 1.0),
    "evi_mean": (-0.2, 1.0),
    "pop": (0.0, 5_000_000.0),
}


def merge(interim: Path, out: Path) -> dict:
    bm = pd.read_parquet(interim / "zonal_bm.parquet")
    ee = pd.read_parquet(interim / "zonal_ee.parquet")
    df = bm.merge(ee, on=["adm3_pcode", "year"], how="outer", validate="one_to_one")
    vj = interim / "zonal_vj.parquet"
    if vj.exists():
        df = df.merge(pd.read_parquet(vj), on=["adm3_pcode", "year"], how="left", validate="one_to_one")
    lgus = pd.read_parquet(interim / "lgus.parquet")
    problems = []
    if set(df.adm3_pcode) != set(lgus.adm3_pcode):
        problems.append(f"LGU sets differ: {len(set(df.adm3_pcode) ^ set(lgus.adm3_pcode))} codes")
    per_year = df.groupby("year").size()
    if (per_year != len(lgus)).any():
        problems.append(f"rows per year differ from {len(lgus)}: {per_year.to_dict()}")
    for col, (lo, hi) in GATES.items():
        v = df[col].dropna()
        if len(v) < 0.95 * len(df):
            problems.append(f"{col}: {len(df) - len(v)} missing values")
        if len(v) and (v.min() < lo or v.max() > hi):
            problems.append(f"{col}: range [{v.min():.3f}, {v.max():.3f}] outside [{lo}, {hi}]")
    if problems:
        raise ValueError("feature store gates failed: " + "; ".join(problems))
    df = df.sort_values(["adm3_pcode", "year"]).reset_index(drop=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False, compression="snappy")
    return {"rows": len(df), "years": sorted(int(y) for y in df.year.unique()), "columns": list(df.columns),
            "missing": {c: int(df[c].isna().sum()) for c in df.columns if df[c].isna().any()}}
