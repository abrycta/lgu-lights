"""Interval calibration must bin exactly as lgu-core does (count of edges strictly below y_prev)."""
import numpy as np
import pytest

lgb = pytest.importorskip("lightgbm")
from lgu import train


def test_conformal_quantile_is_finite_sample_corrected_and_bins_match_core():
    y_prev = np.repeat([5.0, 15.0, 25.0, 35.0], 50)
    res = np.tile(np.arange(1, 51, dtype=float), 4)
    cal = train.conformal(np.column_stack([y_prev, res]), bins=4)
    assert cal["q90"] == [46.0] * 4  # ceil(51 * 0.9) = 46th smallest of 1..50
    assert cal["q50"] == [26.0] * 4
    iv = train.apply_calibration(cal, np.array([cal["edges"][0]]), np.array([10.0]))
    assert iv["h90"][0] == 46.0  # a value equal to an edge stays in the lower bin, as in the core


def test_within_target_removes_the_province_mean_change_of_each_transition():
    import pandas as pd
    lab = pd.DataFrame({"year": [2018, 2018, 2018, 2021], "prev_year": [2015, 2015, 2015, 2018],
                        "province": ["A", "A", "B", "A"], "target": [-4.0, 2.0, 5.0, 3.0],
                        "y": [10.0, 20.0, 30.0, 40.0]})
    assert train.within_target(lab).tolist() == [-3.0, 3.0, 0.0, 0.0]
    # a province-wide shift in the estimate is not counted as within-province error
    assert train.within_rmse(lab, lab.y.to_numpy() + [1.0, 1.0, -2.0, 7.0]) == 0.0


def test_linear_terms_drift_and_provincial_gap():
    import numpy as np
    import pandas as pd
    # two provinces x two transitions; province A's FIES gap is +2 and it rises 1 pp more than B
    lab = pd.DataFrame({"year": [2015, 2015, 2018, 2018], "prev_year": [2012, 2012, 2015, 2015],
                        "province": ["A", "B", "A", "B"], "gap": [3.0] * 4,
                        "target": [-2.0, -4.0, -5.0, -7.0], "prov_fies_gap": [2.0, -2.0, 2.0, -2.0]})
    coef = train.fit_linear(lab, ("gap", "prov_fies_gap"))
    assert coef["gap"] == -1.5  # mean change per year
    assert coef["prov_fies_gap"] == 0.5  # +-1 pp around the transition mean per +-2 of gap
    x = pd.DataFrame({"gap": [2.0], "prov_fies_gap": [np.nan]})
    assert train.linear(x, coef).tolist() == [-3.0]  # a missing FIES figure contributes 0, as in the core


def test_level_tapers_a_large_fall_like_the_core():
    y = np.array([20.0, 20.0, 2.0, 2.0])
    v = train.level(y, np.array([3.0, -10.0, -4.0, -40.0]))
    assert v[0] == 23.0 and v[1] == 10.0
    assert abs(v[2] - 0.25) < 1e-12 and 0 < v[3] < v[2]


def test_metrics_gate_stops_a_much_worse_model_against_the_published_one():
    base = {"test_round": 2023, "n": 1598, "model": {"mae": 5.55, "r2": 0.58}}
    assert train.gate_metrics({"test_round": 2023, "n": 1598, "model": {"mae": 5.9, "r2": 0.55}}, base) == []
    shifted = {"test_round": 2023, "n": 1598, "model": {"mae": 14.2, "r2": -1.3}}  # labels from a shifted column
    assert len(train.gate_metrics(shifted, base)) == 3  # MAE, R2 against the published one, and R2 <= 0
    assert train.gate_metrics({"test_round": 2023, "n": 1500, "model": {"mae": 5.5, "r2": 0.58}}, base)


def test_a_new_headline_round_still_needs_to_beat_carry_forward_and_positive_r2():
    base = {"test_round": 2023, "n": 1598, "model": {"mae": 5.55, "r2": 0.58}}
    good = {"test_round": 2025, "n": 1598, "carry_forward_mae": 6.3, "model": {"mae": 5.8, "r2": 0.5}}
    assert train.gate_metrics(good, base) == []
    broken = {"test_round": 2025, "n": 1598, "carry_forward_mae": 6.3, "model": {"mae": 30.0, "r2": -0.5}}
    assert len(train.gate_metrics(broken, base)) == 2


def test_an_implausibly_better_headline_on_the_same_round_is_stopped():
    base = {"test_round": 2023, "n": 1598, "model": {"mae": 5.55, "r2": 0.58}}
    fractions = {"test_round": 2023, "n": 1598, "carry_forward_mae": 0.06, "model": {"mae": 0.055, "r2": 0.58}}
    assert any("implausibly better" in p for p in train.gate_metrics(fractions, base))
