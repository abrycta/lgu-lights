"""PSA SAE rounds, estimators, backtest folds and the default run years, from config/rounds.json (audit M5).

The same file feeds the Rust core (crates/lgu-core/build.rs) and the web app (web/src/lib/rounds.gen.ts), so
a new round is data, not code in three languages. The panel's feature years come from the feature store.
"""
from __future__ import annotations

import json
from pathlib import Path

CONFIG = Path(__file__).resolve().parents[2] / "config" / "rounds.json"
_C = json.loads(CONFIG.read_text())

ROUNDS: tuple[int, ...] = tuple(r["year"] for r in _C["rounds"])
ESTIMATOR: dict[int, str] = {r["year"]: r["estimator"] for r in _C["rounds"]}
BACKTESTS: tuple[int, ...] = tuple(_C["backtests"])
RUN_YEARS: str = _C["run_years"]


def from_workbook(source_id: str) -> tuple[int, ...]:
    """The rounds read from one PSA workbook (registry source id)."""
    return tuple(r["year"] for r in _C["rounds"] if r["workbook"] == source_id)


assert list(ROUNDS) == sorted(set(ROUNDS)), "config/rounds.json: rounds must be ascending and unique"
assert set(BACKTESTS) <= set(ROUNDS), "config/rounds.json: every backtest is a round"
