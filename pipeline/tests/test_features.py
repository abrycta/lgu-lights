"""Feature-store gates per year (audit L-C2): one blacked-out tile in one year must stop the store."""
import numpy as np
import pandas as pd

from lgu import features


def store(years=(2023, 2024, 2025), n=1642, seed=0):
    rng = np.random.default_rng(seed)
    rows = []
    for y in years:
        bm = rng.uniform(0.1, 20, n)
        rows.append(pd.DataFrame({"adm3_pcode": [f"PH{i:07d}" for i in range(n)], "year": y, "bm_mean": bm,
                                  "bm_sum": bm * 100, "bm_lit_frac": rng.uniform(0, 1, n), "bm_valid_frac": 1.0,
                                  "ndvi_mean": 0.6, "evi_mean": 0.4, "pop": 30000.0}))
    return pd.concat(rows, ignore_index=True)


def test_a_clean_store_passes():
    assert features.gate_years(store()) == []


def test_a_blacked_out_tile_in_one_year_fails_although_it_is_under_2_percent_of_rows():
    df = store(years=tuple(range(2012, 2026)))
    hit = (df.year == 2025) & (df.adm3_pcode.str[2:].astype(int) < 430)  # 430 Mindanao LGUs: 1.9 % of all rows
    df.loc[hit, ["bm_mean", "bm_lit_frac"]] = np.nan
    df.loc[hit, ["bm_sum", "bm_valid_frac"]] = 0.0
    problems = features.gate_years(df)
    assert hit.mean() < 0.02
    assert any("bm_mean" in p and "2025" in p for p in problems)
    assert any("bm_valid_frac" in p and "2025" in p for p in problems)


def test_an_abrupt_national_radiance_change_fails():
    df = store()
    df.loc[df.year == 2024, "bm_sum"] *= 2.0
    assert any("bm_sum" in p and "2024" in p for p in features.gate_years(df))


def _tables(tmp_path, composites):  # two LGUs, years 2025 (full) and 2027 (Terra's last months only)
    rows = [(p, y) for p in ("PH01", "PH02") for y in composites]
    pd.DataFrame([{"adm3_pcode": p, "year": y, "bm_mean": 1.0, "bm_lit_frac": 0.5, "bm_valid_frac": 1.0}
                  for p, y in rows]).to_parquet(tmp_path / "zonal_bm.parquet")
    pd.DataFrame([{"adm3_pcode": p, "year": y, "ndvi_mean": 0.6, "evi_mean": 0.4, "pop": 1000.0,
                   "veg_composites": composites[y]} for p, y in rows]).to_parquet(tmp_path / "zonal_ee.parquet")
    pd.DataFrame({"adm3_pcode": ["PH01", "PH02"]}).to_parquet(tmp_path / "lgus.parquet")


def test_partial_terra_year_is_skipped_silently(tmp_path, capsys):
    _tables(tmp_path, {2025: 23, 2027: 4})
    rep = features.merge(tmp_path, tmp_path / "features.parquet")
    out = pd.read_parquet(tmp_path / "features.parquet")
    assert rep["years"] == [2025] and rep["skipped_years"] == [2027]
    assert set(out.year) == {2025} and "veg_composites" not in out.columns
    assert "::notice::" in capsys.readouterr().out
