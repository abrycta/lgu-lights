"""Merge the zonal-statistics tables into the feature store (data/build/features.parquet).

One row per (adm3_pcode, year): Black Marble radiance (bm_*), MODIS NDVI/EVI, WorldPop population,
SRTM elevation and slope, and (when computed) NOAA-20 VJ113A1 NDVI. Data-quality gates run here:
a failed gate raises, so a bad feature store is never published (DATA-ARCHIVING.md principle 4).
A year without a full MODIS vegetation year (fewer than MIN_VEG_COMPOSITES 16-day composites, as when
Terra ends around February 2027) is left out silently: no failure, nothing published for that year,
only an internal ::notice in the run log.
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

MIN_VEG_COMPOSITES = 20  # of 23 MOD13Q1 composites a year; fewer would bias the yearly mean to one season


def partial_veg_years(ee: pd.DataFrame) -> list[int]:
    """Years whose yearly NDVI/EVI mean rests on too few composites (needs the `veg_composites` column)."""
    if "veg_composites" not in ee.columns:  # zonal tables from before the column existed
        return []
    n = ee.groupby("year")["veg_composites"].max()
    return sorted(int(y) for y in n[n < MIN_VEG_COMPOSITES].index)


MAX_MISSING_PER_YEAR = 0.01   # per column and year (real stores: at most 0.12 %, NDVI on small islands)
MIN_VALID_PER_YEAR = 0.9      # mean bm_valid_frac per year (real stores: 1.00)
BM_SUM_JUMP = (0.3, 0.5)      # national bm_sum vs its neighbours' mean: interior years, first/last year


def gate_years(df: pd.DataFrame) -> list[str]:
    """Per-year gates (audit L-C2): a gate over all years lets one blacked-out tile in one year through
    (430 Mindanao LGUs are 1.9 % of 14 years of rows). Each year must have few missing values per column, mostly
    valid Black Marble pixels, and a national radiance sum close to its neighbouring years (real stores move at
    most 17 % against the neighbours' mean and 36 % year on year, 2022 to 2023)."""
    problems = []
    g = df.groupby("year")
    for col in GATES:
        miss = g[col].apply(lambda v: float(v.isna().mean()))
        for y, m in miss[miss > MAX_MISSING_PER_YEAR].items():
            problems.append(f"{col}: {m:.1%} missing in {y} (max {MAX_MISSING_PER_YEAR:.0%} per year)")
    valid = g.bm_valid_frac.mean()
    for y, v in valid[valid < MIN_VALID_PER_YEAR].items():
        problems.append(f"bm_valid_frac: mean {v:.3f} in {y} (min {MIN_VALID_PER_YEAR})")
    if "bm_sum" in df:
        tot = g.bm_sum.sum(min_count=1)
        ys = sorted(tot.index)
        for i, y in enumerate(ys):
            nb = [tot[ys[j]] for j in (i - 1, i + 1) if 0 <= j < len(ys) and abs(ys[j] - y) == 1]
            if not nb or not pd.notna(tot[y]) or sum(nb) <= 0:
                continue
            tol = BM_SUM_JUMP[0] if len(nb) == 2 else BM_SUM_JUMP[1]
            ratio = float(tot[y] / (sum(nb) / len(nb)))
            if abs(ratio - 1) > tol:
                problems.append(f"bm_sum: national total in {y} is {ratio:.2f}x its neighbouring years (max ±{tol:.0%})")
    return problems


def merge(interim: Path, out: Path) -> dict:
    bm = pd.read_parquet(interim / "zonal_bm.parquet")
    ee = pd.read_parquet(interim / "zonal_ee.parquet")
    skipped = partial_veg_years(ee)
    if skipped:
        print(f"::notice::partial MODIS vegetation year(s) {skipped} (under {MIN_VEG_COMPOSITES} composites) left out")
        ee = ee[~ee.year.isin(skipped)]
        bm = bm[~bm.year.isin(skipped)]
    ee = ee.drop(columns="veg_composites", errors="ignore")  # the feature store keeps its columns
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
    problems += gate_years(df)
    for col, (lo, hi) in GATES.items():
        v = df[col].dropna()
        if len(v) and (v.min() < lo or v.max() > hi):
            problems.append(f"{col}: range [{v.min():.3f}, {v.max():.3f}] outside [{lo}, {hi}]")
    if problems:
        raise ValueError("feature store gates failed: " + "; ".join(problems))
    df = df.sort_values(["adm3_pcode", "year"]).reset_index(drop=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False, compression="snappy")
    return {"rows": len(df), "years": sorted(int(y) for y in df.year.unique()), "columns": list(df.columns),
            "skipped_years": skipped,
            "missing": {c: int(df[c].isna().sum()) for c in df.columns if df[c].isna().any()}}
