"""Black Marble product per year and the S-NPP/NOAA-20 cross-calibration (audit M4)."""
import numpy as np
import pytest

from lgu import laads


def test_product_switches_to_noaa20_in_2026():
    assert [laads.bm_product(y) for y in (2012, 2025, 2026, 2030)] == ["VNP46A4", "VNP46A4", "VJ146A4", "VJ146A4"]
    assert laads.BM_OVERLAP_YEAR == 2025


def test_ratio_scales_noaa20_onto_snpp_over_lit_pixels():
    snpp = np.array([[10.0, 2.0, 0.1], [np.nan, 4.0, 0.0]], dtype=np.float32)
    noaa20 = np.array([[8.0, 1.6, 5.0], [9.0, np.nan, 0.0]], dtype=np.float32)
    # lit in S-NPP and valid in both: 10/8 and 2/1.6 -> 12 / 9.6
    assert laads.bm_ratio(snpp, noaa20) == pytest.approx(1.25)
    with pytest.raises(RuntimeError):
        laads.bm_ratio(np.zeros((2, 2), np.float32), np.ones((2, 2), np.float32))


def test_lit_fraction_is_calibrated_per_lgu_in_noaa20_years_only():
    import pandas as pd

    res = pd.DataFrame({"adm3_pcode": ["A", "B", "C", "A", "B", "C"], "year": [2025] * 3 + [2026] * 3,
                        "bm_lit_frac": [0.3, 0.1, 0.0, 0.2, 0.05, 0.1]})
    snpp = pd.Series({"A": 0.3, "B": 0.1, "C": 0.02})
    noaa20 = pd.Series({"A": 0.2, "B": 0.05, "C": 0.0})
    out = laads.calibrate_lit(res, snpp, noaa20)
    assert out.bm_lit_frac[:3].tolist() == [0.3, 0.1, 0.0]  # S-NPP year untouched
    nat = 0.42 / 0.25  # C has no NOAA-20 lit pixels in the overlap year: national ratio
    assert out.bm_lit_frac[3:].tolist() == pytest.approx([0.3, 0.1, 0.1 * nat])
    capped = laads.calibrate_lit(res.assign(bm_lit_frac=0.9), snpp, noaa20)
    assert capped.bm_lit_frac.max() == 1.0
