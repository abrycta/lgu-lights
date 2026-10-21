"""Regenerate crates/lgu-core/tests/fixtures/{forest.json,parity.csv}: a small LightGBM ensemble trained
on synthetic data with NaNs, zeros and monotone constraints, exported exactly as lgu/train.py exports,
plus LightGBM's own predictions. `cargo test -p lgu-core` checks the core against them (<= 1e-9).

    uv run --group train python tools/make_parity_fixture.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lgu import train

OUT = Path(__file__).resolve().parents[2] / "crates" / "lgu-core" / "tests" / "fixtures"


def main() -> None:
    rng = np.random.default_rng(2026)
    n, k = 600, len(train.FEATURES)
    x = rng.normal(size=(n, k))
    x[rng.random((n, k)) < 0.08] = np.nan          # missing values -> NaN missing type
    x[:, 3] = rng.integers(0, 2, n)                # a binary feature
    x[rng.random(n) < 0.3, 9] = 0.0                # exact zeros
    y = 3 * np.nan_to_num(x[:, 0]) - 2 * np.nan_to_num(x[:, 7]) + np.sin(np.nan_to_num(x[:, 13])) + rng.normal(0, 0.3, n)
    df = pd.DataFrame(x, columns=train.FEATURES).assign(target=y)
    cfg = dict(train.DEFAULT, n_estimators=40, num_leaves=15, objective="huber")
    f = train.fit(df, cfg, seeds=(1, 2))
    cal = {"edges": [0.0], "q50": [1.0, 2.0], "q90": [3.0, 4.0], "n": 0}
    model = train.export(f, cal, "parity-fixture", cfg, [])
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "forest.json").write_text(json.dumps(model["forest"]))
    test = pd.DataFrame(rng.normal(size=(64, k)), columns=train.FEATURES)
    test.iloc[::5, 7] = np.nan
    test.iloc[::7, 9] = 0.0
    test["pred"] = f.predict(test)
    test.to_csv(OUT / "parity.csv", index=False, float_format="%.17g", na_rep="NaN")
    print(f"wrote {OUT} (lightgbm {lgb.__version__})")


if __name__ == "__main__":
    main()
