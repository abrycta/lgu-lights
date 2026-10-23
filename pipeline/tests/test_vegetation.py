import numpy as np
import pandas as pd

from lgu import vegetation


def _overlap(seed=0):
    """Ten LGUs over 2018-2025; MOD13Q1 = 0.9 * VJ + 0.1 + an LGU bias (+ small noise). L9 has two years only."""
    rng = np.random.default_rng(seed)
    rows = []
    for i in range(10):
        bias = 0.04 * (i - 4.5) / 4.5
        base = 0.3 + 0.05 * i
        for y in range(2018, 2026):
            if i == 9 and y < 2024:
                continue
            for _ in range(1):
                vj = base + rng.normal(0, 0.03)
                rows.append({"adm3_pcode": f"L{i}", "year": y, "vj_ndvi_mean": vj, "vj_evi_mean": vj * 0.6,
                             "ndvi_mean": 0.9 * vj + 0.1 + bias + rng.normal(0, 0.002),
                             "evi_mean": 0.9 * vj * 0.6 + 0.05 + bias + rng.normal(0, 0.002)})
    df = pd.DataFrame(rows)
    return df[["adm3_pcode", "year", "ndvi_mean", "evi_mean"]], df[["adm3_pcode", "year", "vj_ndvi_mean", "vj_evi_mean"]]


def test_per_lgu_offsets_with_national_fallback():
    mod, vj = _overlap()
    cal = vegetation.fit(mod, vj)
    assert cal["overlap_years"] == list(range(2018, 2026))
    for k in ("ndvi", "evi"):
        c = cal[k]
        assert "L9" not in c["offsets"] and c["lgus_national"] >= 1  # too few overlap years: national offset
        assert c["lgus_own"] >= 8
    # calibrated VJ113A1 lands on MOD13Q1 closely, in and out of sample
    rep = vegetation.validate(mod, vj, list(range(2018, 2024)), [2024, 2025])
    assert rep["ndvi"]["mae"] < 0.01 and rep["evi"]["mae"] < 0.01


def test_apply_maps_and_clips():
    cal = {k: {"slope": 2.0, "offset": 0.1, "offsets": {"A": 0.0}} for k in ("ndvi", "evi")}
    vj = pd.DataFrame({"adm3_pcode": ["A", "B", "B"], "year": 2027, "vj_ndvi_mean": [0.3, 0.3, 0.9],
                       "vj_evi_mean": [0.2, 0.2, float("nan")]})
    out = vegetation.apply(vj, cal)
    assert np.allclose(out.ndvi_mean, [0.6, 0.7, 1.0])  # 1.9 clipped to the store's range
    assert np.isclose(out.evi_mean[0], 0.4) and np.isnan(out.evi_mean[2])


def test_the_committed_calibration_loads():
    cal = vegetation.load()
    if cal is not None:  # committed with the overlap run
        assert 0.5 < cal["ndvi"]["slope"] < 1.5 and cal["overlap_years"][0] == 2018
