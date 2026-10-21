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
