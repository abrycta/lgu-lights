import pandas as pd

from lgu import features


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
