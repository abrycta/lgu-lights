"""Model training and honest validation (MODELING-PLAN §4.4, §5, §6). Offline only: the Rust core
executes the exported trees (lgu-core::forest) and must match LightGBM's own predict() (parity gate).

Data: the design matrix written by the Rust CLI (`lgu design`), so training and serving share one
feature implementation. A labelled row is a transition "official in round r -> official in round t".
Transitions: 2012->2015, 2015->2018, 2018->2021, 2021->2023 (plus longer gaps where an LGU missed a round).

Target (model v2, DECISIONS "v2 enhancement"): the change in percentage points **minus the mean change
of the LGU's province in the same transition** (`within_target`). Most of the change between two PSA
rounds is shared by a whole province (47-84 % of its variance) and is not predictable from these inputs:
its correlation with the province's previous level, trend or lights flips from round to round. Trees
fitted on the raw change (v1) learned each training round's provincial shifts and applied them to the
next round, which failed across the ELL -> Census EB change. The v2 model learns only how an LGU moves
relative to its province (mean reversion towards the province, persistence of the previous trend), which
is stable across rounds, and otherwise carries the province's level forward. The estimate was
`clamp(official_r + prediction, 0, 100)`; since data v5 a predicted fall below half the previous figure
tapers instead of reaching 0 % (`level`, mirrored in lgu-core).

Model v3 (DECISIONS "v3 enhancement"): the 2006 and 2009 SAE rounds add the transitions 2006->2009 and
2009->2012 (no satellite inputs before 2012: NaN, LightGBM's missing-value handling) and give every
fold inner folds; two optional linear terms model the shared shift (national drift; the province's
lagged FIES-vs-SAE gap), each kept only when inner forward-chaining prefers it (`select_linear`).

Validation, forward-chaining by target round (no information from the test round or later is used for
fitting, tuning, term selection or interval calibration):
  F1  train t<=2015 (2009, 2012, 2015)  -> test 2018
  F2  train t<=2018                     -> test 2021  (across the ELL -> Census EB estimator change)
  F3  train t<=2021                     -> test 2023  (the nowcast case; headline)
Hyper-parameters for fold k are chosen by inner forward-chaining inside its training rounds (F1 uses
the defaults), scored on the within-province error (`within_rmse`): the provincial shift of an inner
test round is the same for every configuration and would only add noise to the ranking. Conformal
intervals for a model trained on rounds S use absolute residuals that models made on rounds in S they
had not seen (inner forward-chaining); for a single training round, 5-fold
province-grouped cross-validation. The final model (all rounds) is tuned and calibrated the same way.

Outputs (out/): model.json (final), backtest-<year>.json (fold models, displayed as backtests),
metrics.json (leaderboard incl. baselines and ablation), expected.csv (LightGBM predictions of every
model on every design row, for the parity gate).
"""
from __future__ import annotations

import itertools
import json
import logging
import math
import time
from dataclasses import dataclass
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from .rounds import BACKTESTS, ROUNDS

log = logging.getLogger("lgu.train")

FEATURES = ["y_prev", "gap", "trend_prev", "era_cross", "prov_prev_mean", "se_prev", "l_bm", "d_l_bm", "lit",
            "d_lit", "l_rpc", "l_dens", "d_l_pop", "ndvi", "d_ndvi", "evi", "elev", "slope", "bm_valid"]
SATELLITE = ["l_bm", "d_l_bm", "lit", "d_lit", "l_rpc", "ndvi", "d_ndvi", "evi", "bm_valid"]
# Brighter (or brightening) places should not be predicted to get poorer, all else equal.
MONOTONE = {"d_l_bm": -1, "l_rpc": -1}
SEEDS = (11, 23, 37, 41, 53)
Z90 = 1.6448536269514722
WHATIF_WIDEN = 1.25
TARGET_NOTE = ("forest: change since the previous round minus the province's mean change in the same "
               "transition (v2); linear: national drift and lagged provincial FIES gap when selected (v3)")
N_BINS = 4
OUTER_TESTS = BACKTESTS  # F1, F2, F3 (the folds reported since v1), config/rounds.json
DEFAULT = {"num_leaves": 15, "learning_rate": 0.03, "n_estimators": 400, "min_child_samples": 40,
           "lambda_l2": 5.0, "objective": "huber"}
GRID = {"num_leaves": [7, 15, 31], "n_estimators": [250, 600], "min_child_samples": [20, 60],
        "lambda_l2": [0.0, 10.0], "objective": ["l2", "huber"]}


@dataclass
class Fit:
    boosters: list[lgb.Booster]
    features: list[str]

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        x = X[self.features].to_numpy(dtype=np.float64)
        return np.mean([b.predict(x) for b in self.boosters], axis=0)


def _params(cfg: dict, features: list[str], seed: int) -> dict:
    p = {"objective": cfg["objective"], "learning_rate": cfg["learning_rate"], "num_leaves": cfg["num_leaves"],
         "min_child_samples": cfg["min_child_samples"], "lambda_l2": cfg["lambda_l2"], "feature_fraction": 0.8,
         "bagging_fraction": 0.8, "bagging_freq": 1, "seed": seed, "deterministic": True, "force_row_wise": True,
         "num_threads": 2, "verbose": -1,
         "monotone_constraints": [MONOTONE.get(f, 0) for f in features]}
    if cfg["objective"] == "huber":
        p["alpha"] = 3.0  # pp; residuals beyond this are treated linearly (noisy small-area labels)
    return p


GROUP = ["year", "prev_year", "province"]  # one transition of one province


def within_target(lab: pd.DataFrame) -> pd.Series:
    """Change since the previous round minus the mean change of the province's LGUs in the same transition.

    Uses only the labels of that transition, so a model trained on rounds S never sees a later round."""
    return lab["target"] - lab.groupby(GROUP)["target"].transform("mean")


def within_rmse(test: pd.DataFrame, est: np.ndarray) -> float:
    """RMSE after removing each province's mean error: the part of the error the model controls."""
    e = pd.Series(est - test["y"].to_numpy(), index=test.index)
    return float(np.sqrt(np.mean((e - e.groupby([test[c] for c in GROUP]).transform("mean")) ** 2)))


def fit(train: pd.DataFrame, cfg: dict, features: list[str] = FEATURES, seeds: tuple[int, ...] = SEEDS,
        target: str = "target_within") -> Fit:
    """An average of boosters with different bagging seeds (variance reduction; one forest in the core)."""
    x = train[features].to_numpy(dtype=np.float64)
    y = train[target].to_numpy(dtype=np.float64)
    boosters = [lgb.train(_params(cfg, features, s), lgb.Dataset(x, y, free_raw_data=False),
                          num_boost_round=cfg["n_estimators"]) for s in seeds]
    return Fit(boosters, features)


def rmse(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.sqrt(np.mean((a - b) ** 2)))


def inner_folds(rounds: list[int]) -> list[tuple[list[int], int]]:
    """Forward-chaining splits inside the training rounds: ([r1..rk], r_{k+1})."""
    return [(rounds[:k], rounds[k]) for k in range(1, len(rounds))]


def tune(lab: pd.DataFrame, rounds: list[int]) -> tuple[dict, list[dict]]:
    folds = inner_folds(rounds)
    if not folds:
        return dict(DEFAULT), []
    results = []
    keys = list(GRID)
    for values in itertools.product(*(GRID[k] for k in keys)):
        cfg = dict(DEFAULT, **dict(zip(keys, values)))
        errs = []
        for tr, te in folds:
            f = fit(lab[lab.year.isin(tr)], cfg, seeds=SEEDS[:1])  # tuning: one seed keeps CI minutes low
            test = lab[lab.year == te]
            errs.append(within_rmse(test, (test.y_prev + f.predict(test)).to_numpy()))
        results.append({"cfg": cfg, "within_rmse": float(np.mean(errs))})
    best = min(results, key=lambda r: r["within_rmse"])
    return best["cfg"], sorted(results, key=lambda r: r["within_rmse"])[:5]


# ------------------------------------------------------------------ linear terms (model v3)
# The forest predicts how an LGU moves within its province. Two optional linear terms model the shared
# part, each fitted on the training rounds only and kept only when inner forward-chaining says so:
#   gap            national drift: the mean change per year of the training transitions, times the gap
#   prov_fies_gap  provincial term: the province's lagged FIES-vs-SAE gap (lgu-core::features) times a
#                  coefficient fitted across training provinces and transitions (centred per transition)
LINEAR_OPTIONS: list[tuple[str, ...]] = [(), ("gap",), ("prov_fies_gap",), ("gap", "prov_fies_gap")]


TAPER = 0.5  # mirrors lgu-core model::TAPER


def level(y_prev: pd.Series | np.ndarray, change: np.ndarray | pd.Series) -> np.ndarray:
    """The level from the previous official figure and the predicted change, as the Rust core computes it
    (lgu-core `model::level`, data v5): a rise, or a fall to no less than TAPER of the previous figure,
    adds; a larger fall tapers hyperbolically below f = TAPER * y_prev (f^2 / (2f - raw)), so no estimate is
    exactly 0 %. The
    baselines (carry forward, drift) stay additive so they remain comparable across versions."""
    y = np.asarray(y_prev, dtype=np.float64)
    raw = y + np.asarray(change, dtype=np.float64)
    floor = TAPER * y
    with np.errstate(divide="ignore", invalid="ignore"):
        tapered = floor * floor / (2 * floor - raw)
    return np.clip(np.where((y > 0) & (raw < floor), tapered, raw), 0, 100)


def fit_linear(train: pd.DataFrame, terms: tuple[str, ...]) -> dict[str, float]:
    coef: dict[str, float] = {}
    if "gap" in terms:
        coef["gap"] = float((train.target / train.gap).mean())
    if "prov_fies_gap" in terms:
        g = train.groupby(GROUP).agg(c=("target", "mean"), x=("prov_fies_gap", "first")).reset_index()
        g = g[np.isfinite(g.x)]
        g["c"] -= g.groupby(["year", "prev_year"]).c.transform("mean")
        coef["prov_fies_gap"] = float(np.sum(g.c * g.x) / np.sum(g.x ** 2)) if len(g) else 0.0
    return coef


def linear(X: pd.DataFrame, coef: dict[str, float]) -> np.ndarray:
    """As lgu-core::model::Linear: a missing input contributes 0."""
    out = np.zeros(len(X))
    for f, c in coef.items():
        out += c * np.nan_to_num(X[f].to_numpy(dtype=np.float64), nan=0.0)
    return out


def inner_runs(lab: pd.DataFrame, rounds: list[int], cfg: dict) -> list[tuple[pd.DataFrame, pd.DataFrame, np.ndarray]]:
    """(train, test, forest prediction) for every inner forward-chaining split inside `rounds`."""
    out = []
    for tr, te in inner_folds(rounds):
        train, test = lab[lab.year.isin(tr)], lab[lab.year == te]
        out.append((train, test, fit(train, cfg).predict(test)))
    return out


def select_linear(runs: list) -> tuple[tuple[str, ...], list[dict]]:
    """The linear terms with the lowest mean inner-fold MAE (ties: fewer terms). No inner folds: none."""
    if not runs:
        return (), []
    scores = []
    for terms in LINEAR_OPTIONS:
        maes = []
        for train, test, fp in runs:
            est = level(test.y_prev, fp + linear(test, fit_linear(train, terms)))
            maes.append(float(np.mean(np.abs(est - test.y.to_numpy()))))
        scores.append({"terms": list(terms), "inner_mae": float(np.mean(maes)), "per_fold": maes})
    best = min(scores, key=lambda r: (round(r["inner_mae"], 6), len(r["terms"])))
    return tuple(best["terms"]), scores


def calibration_residuals(lab: pd.DataFrame, rounds: list[int], cfg: dict, runs: list | None = None,
                          terms: tuple[str, ...] = ()) -> np.ndarray:
    """Residuals on rounds the model had not seen, inside `rounds` only (see module docs)."""
    res = []
    runs = inner_runs(lab, rounds, cfg) if runs is None else runs
    if runs:
        for train, test, fp in runs:
            est = level(test.y_prev, fp + linear(test, fit_linear(train, terms)))
            res.append(pd.DataFrame({"y_prev": test.y_prev, "r": est - test.y}))
    else:
        d = lab[lab.year.isin(rounds)]
        provs = np.array(sorted(d.province.unique()))
        rng = np.random.default_rng(7)
        fold_of = dict(zip(provs, rng.permutation(len(provs)) % 5))
        k = d.province.map(fold_of)
        for i in range(5):
            f = fit(d[k != i], cfg)
            test = d[k == i]
            res.append(pd.DataFrame({"y_prev": test.y_prev, "r": level(test.y_prev, f.predict(test)) - test.y}))
    return pd.concat(res).to_numpy()


def conformal(res: np.ndarray, bins: int = N_BINS) -> dict:
    """Split-conformal |residual| quantiles per y_prev bin, finite-sample corrected."""
    y_prev, r = res[:, 0], np.abs(res[:, 1])
    edges = list(np.quantile(y_prev, np.linspace(0, 1, bins + 1)[1:-1]).round(4))
    idx = np.searchsorted(edges, y_prev, side="left")  # matches core: count of edges < y_prev

    def cq(a: np.ndarray, level: float) -> float:
        n = len(a)
        k = min(n, math.ceil((n + 1) * level))
        return float(np.sort(a)[k - 1])

    q50 = [cq(r[idx == b], 0.5) for b in range(bins)]
    q90 = [cq(r[idx == b], 0.9) for b in range(bins)]
    return {"edges": [float(e) for e in edges], "q50": q50, "q90": q90, "n": len(r)}


def apply_calibration(cal: dict, y_prev: np.ndarray, est: np.ndarray) -> dict[str, np.ndarray]:
    b = np.searchsorted(cal["edges"], y_prev, side="left")
    h50, h90 = np.array(cal["q50"])[b], np.array(cal["q90"])[b]
    return {"lo50": np.maximum(est - h50, 0), "hi50": np.minimum(est + h50, 100),
            "lo90": np.maximum(est - h90, 0), "hi90": np.minimum(est + h90, 100), "h90": h90}


def _flatten(root: dict) -> dict:
    """One dump_model tree -> LightGBM's flat node encoding (children < 0 are leaves, ~index)."""
    sf: list[int] = []
    th: list[float] = []
    dt: list[int] = []
    lc: list[int] = []
    rc: list[int] = []
    lv: dict[int, float] = {}
    if "split_feature" not in root:
        return {"split_feature": [], "threshold": [], "decision_type": [], "left_child": [], "right_child": [],
                "leaf_value": [float(root["leaf_value"])]}

    def walk(node: dict) -> int:
        if "leaf_index" in node:
            lv[int(node["leaf_index"])] = float(node["leaf_value"])
            return ~int(node["leaf_index"])
        i = len(sf)
        sf.append(int(node["split_feature"]))
        th.append(float(node["threshold"]))
        if node["decision_type"] != "<=":
            raise ValueError("only numerical <= splits are supported")
        miss = {"None": 0, "Zero": 1, "NaN": 2}[node["missing_type"]]
        dt.append((2 if node["default_left"] else 0) | (miss << 2))
        lc.append(0)
        rc.append(0)
        lc[i] = walk(node["left_child"])
        rc[i] = walk(node["right_child"])
        return i

    walk(root)
    return {"split_feature": sf, "threshold": th, "decision_type": dt, "left_child": lc, "right_child": rc,
            "leaf_value": [lv[k] for k in range(len(lv))]}


def export(f: Fit, cal: dict, name: str, cfg: dict, trained_on: list[int], coef: dict[str, float]) -> dict:
    """LightGBM dump_model -> flat arrays read by lgu-core::forest (LightGBM's own node encoding)."""
    trees = [_flatten(t["tree_structure"]) for b in f.boosters for t in b.dump_model()["tree_info"]]
    return {"name": name, "version": time.strftime("%Y-%m-%d"), "features": f.features,
            "forest": {"n_features": len(f.features), "trees": trees, "scale": 1.0 / len(f.boosters)},
            "linear": {"features": list(coef), "coef": list(coef.values())},
            "calibration": {k: cal[k] for k in ("edges", "q50", "q90")}, "whatif_widen": WHATIF_WIDEN,
            "meta": {"trained_on_rounds": trained_on, "config": cfg, "seeds": list(SEEDS), "target": TARGET_NOTE,
                     "calibration_residuals": cal["n"], "lightgbm": lgb.__version__}}


def metrics(test: pd.DataFrame, est: np.ndarray, iv: dict | None) -> dict:
    y, yp = test.y.to_numpy(), test.y_prev.to_numpy()
    se = test.se.to_numpy()
    ss_tot = np.sum((y - y.mean()) ** 2)
    out = {"n": len(y), "mae": float(np.mean(np.abs(est - y))), "rmse": rmse(est, y),
           "r2": float(1 - np.sum((est - y) ** 2) / ss_tot), "bias": float(np.mean(est - y))}
    # error left after removing each province's mean error (the shared provincial shift)
    e = pd.Series(est - y, index=test.index)
    out["mae_within_province"] = float(np.mean(np.abs(e - e.groupby([test[c] for c in GROUP]).transform("mean"))))
    # within-region R2 (between-region variance cannot flatter the score)
    reg = test.adm3_pcode.str[:4].to_numpy()
    dy = y - pd.Series(y).groupby(reg).transform("mean").to_numpy()
    de = est - pd.Series(est).groupby(reg).transform("mean").to_numpy()
    out["r2_within_region"] = float(1 - np.sum((de - dy) ** 2) / np.sum(dy ** 2))
    ch, ch_hat = y - yp, est - yp
    out["change_mae"] = float(np.mean(np.abs(ch_hat - ch)))
    out["change_r2"] = float(1 - np.sum((ch_hat - ch) ** 2) / np.sum((ch - ch.mean()) ** 2))
    out["change_corr"] = float(np.corrcoef(ch, ch_hat)[0, 1]) if np.std(ch_hat) > 0 else 0.0
    out["spearman"] = float(spearmanr(y, est).statistic)
    k = max(1, len(y) // 10)
    top_true, top_hat = set(np.argsort(-y)[:k]), set(np.argsort(-est)[:k])
    out["top_decile_recall"] = len(top_true & top_hat) / k
    ok = np.isfinite(se)
    out["psa_noise_mae_floor"] = float(np.sqrt(2 / np.pi) * np.mean(se[ok]))  # E|N(0, se^2)|
    rel = (test.cv.to_numpy() < 20) if "cv" in test else np.ones(len(y), bool)
    out["mae_psa_cv_lt_20"] = float(np.mean(np.abs(est - y)[rel]))
    if iv is not None:
        out["coverage90"] = float(np.mean((y >= iv["lo90"]) & (y <= iv["hi90"])))
        out["coverage50"] = float(np.mean((y >= iv["lo50"]) & (y <= iv["hi50"])))
        out["width90"] = float(np.mean(iv["hi90"] - iv["lo90"]))
        lo, hi = test.ci_lo.to_numpy(), test.ci_hi.to_numpy()
        out["overlap_psa_ci"] = float(np.mean((iv["lo90"] <= hi) & (iv["hi90"] >= lo)))
        out["psa_ci_width90"] = float(np.nanmean(hi - lo))
        # reliability tiers as the core assigns them: model CV = (90 % half-width / z90) / estimate
        with np.errstate(divide="ignore"):
            cv = np.where(est > 0, 100 * (iv["h90"] / Z90) / est, np.inf)
        out["tier_reliable"] = float(np.mean(cv <= 10))
        out["tier_caution"] = float(np.mean((cv > 10) & (cv <= 20)))
        out["tier_unreliable"] = float(np.mean(cv > 20))
    return out


def province_metrics(test: pd.DataFrame, est: np.ndarray, fies: pd.DataFrame) -> dict:
    """Province-level accuracy: population-weighted means of the town estimates per province against
    (a) the same weighting of PSA's SAE town figures (same towns, so only the estimate differs) and
    (b) PSA's FIES provincial figure without highly urbanised cities (table 2a; 2018 onwards), for
    provinces outside Metro Manila with at least 3 towns. (b) carries FIES's own sampling error, so
    PSA's SAE aggregate is scored against it too as a reference."""
    w = test["pop"].to_numpy(dtype=np.float64)
    df = pd.DataFrame({"prov": test.province.to_numpy(), "w": np.where(np.isfinite(w) & (w > 0), w, np.nan),
                       "est": est, "y": test.y.to_numpy()}).dropna(subset=["w"])
    g = df.groupby("prov").apply(lambda x: pd.Series({"est": np.average(x.est, weights=x.w),
                                                      "y": np.average(x.y, weights=x.w), "n": len(x)}),
                                 include_groups=False)
    out = {"province_n": len(g), "province_mae_vs_sae": float(np.mean(np.abs(g.est - g.y)))}
    f = fies[fies.round_year == int(test.year.iloc[0])].set_index("adm2_pcode").pi_nohuc
    h = g[(g.n >= 3) & ~g.index.str.startswith("PH13")].join(f, how="inner").dropna()
    if len(h):
        out["province_n_fies"] = len(h)
        out["province_mae_vs_fies"] = float(np.mean(np.abs(h.est - h.pi_nohuc)))
        out["psa_sae_province_mae_vs_fies"] = float(np.mean(np.abs(h.y - h.pi_nohuc)))
    return out


# Metrics gate against the published data version (audit L-C1): wrong labels (a shifted column) or a broken feature
# store show up as a much worse headline. MAE may grow by 10 %, R2 fall by 0.05, scored LGUs fall by 2 %.
GATE_MAE_REL, GATE_R2_ABS, GATE_N_REL = 0.10, 0.05, 0.02


def gate_metrics(new: dict, baseline: dict) -> list[str]:
    """Problems of a new headline against the published one (both metrics.json["headline"])."""
    problems = []
    if new.get("test_round") != baseline.get("test_round"):
        return []  # a new headline round is not comparable; the parity and feature gates still apply
    nm, bm = new["model"], baseline["model"]
    if nm["mae"] > bm["mae"] * (1 + GATE_MAE_REL):
        problems.append(f"headline MAE {nm['mae']:.3f} vs published {bm['mae']:.3f} (max +{GATE_MAE_REL:.0%})")
    if nm["r2"] < bm["r2"] - GATE_R2_ABS:
        problems.append(f"headline R2 {nm['r2']:.3f} vs published {bm['r2']:.3f} (max -{GATE_R2_ABS})")
    if new["n"] < baseline["n"] * (1 - GATE_N_REL):
        problems.append(f"headline rows {new['n']} vs published {baseline['n']} (max -{GATE_N_REL:.0%})")
    return problems


def run(design_path: Path, out: Path, baseline: Path | None = None) -> dict:
    t_start = time.time()
    out.mkdir(parents=True, exist_ok=True)
    d = pd.read_csv(design_path, dtype={"adm3_pcode": str, "province": str}, float_precision="round_trip")
    lab = d[d.label == 1].copy()
    # PSA CV and CI for the test rows (scoring against PSA's own uncertainty)
    labels = pd.read_parquet(design_path.parent / "labels.parquet")[["adm3_pcode", "round_year", "cv", "ci_lo", "ci_hi"]]
    lab = lab.merge(labels.rename(columns={"round_year": "year"}), on=["adm3_pcode", "year"], how="left")
    lab["target_within"] = within_target(lab)
    # WorldPop population of the target year (province-level aggregation weights)
    pop = pd.read_parquet(design_path.parent / "features.parquet", columns=["adm3_pcode", "year", "pop"])
    # first transition whose both ends are in the feature years (2015 with feature years from 2012)
    viirs_first_target = min(r for r in ROUNDS if r > int(pop.year.min()))
    lab = lab.merge(pop, on=["adm3_pcode", "year"], how="left")
    fies_path = design_path.parent / "provinces_fies.parquet"
    fies = pd.read_parquet(fies_path) if fies_path.exists() else pd.DataFrame(
        columns=["adm2_pcode", "round_year", "pi", "pi_nohuc"])
    rounds = sorted(lab.year.unique().tolist())  # [2015, 2018, 2021, 2023]
    log.info("labelled transitions per target round: %s", lab.year.value_counts().sort_index().to_dict())

    report: dict = {"rounds": rounds, "folds": [], "generated": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    expected = {}
    for k, te in enumerate(OUTER_TESTS, start=1):
        tr_rounds = [r for r in rounds if r < te]
        cfg, top = tune(lab, tr_rounds)
        train = lab[lab.year.isin(tr_rounds)]
        test = lab[lab.year == te]
        f = fit(train, cfg)
        runs = inner_runs(lab, tr_rounds, cfg)
        terms, lin_scores = select_linear(runs)
        coef = fit_linear(train, terms)
        cal = conformal(calibration_residuals(lab, tr_rounds, cfg, runs, terms))
        est = level(test.y_prev, f.predict(test) + linear(test, coef))
        iv = apply_calibration(cal, test.y_prev.to_numpy(), est)
        row = {"fold": f"F{k}", "train_rounds": tr_rounds, "test_round": te, "config": cfg, "tuning_top5": top,
               "linear": coef, "linear_selection": lin_scores, "calibration": cal,
               "model": metrics(test, est, iv) | province_metrics(test, est, fies)}
        # the forest alone (the v2 method on this data), to show what the linear terms add
        row["ablation_forest_only"] = metrics(test, level(test.y_prev, f.predict(test)), None)
        # baselines on the same rows
        carry = test.y_prev.to_numpy()
        row["carry_forward"] = metrics(test, carry, None) | province_metrics(test, carry, fies)
        # mean change per year in the training rounds of the VIIRS era (the v1/v2 definition, so the
        # baseline stays comparable across versions); the all-rounds variant is reported beside it
        viirs = train[train.year >= viirs_first_target]
        drift = float((viirs.target / viirs.gap).mean())
        drift_all = float((train.target / train.gap).mean())
        row["carry_forward_drift_all_rounds"] = metrics(
            test, (test.y_prev.to_numpy() + drift_all * test.gap.to_numpy()).clip(0, 100), None)
        row["carry_forward_drift"] = metrics(test, (carry + drift * test.gap.to_numpy()).clip(0, 100), None)
        no_sat = [c for c in FEATURES if c not in SATELLITE]
        f_ns = fit(train, cfg, no_sat)
        row["ablation_no_satellite"] = metrics(
            test, level(test.y_prev, f_ns.predict(test) + linear(test, coef)), None)
        report["folds"].append(row)
        name = f"lightgbm-backtest-{te}"
        (out / f"backtest-{te}.json").write_text(json.dumps(export(f, cal, name, cfg, tr_rounds, coef)))
        expected[name] = f.predict(d) + linear(d, coef)
        log.info("F%d -> %d: MAE %.2f (carry-forward %.2f, no-satellite %.2f), coverage90 %.2f, linear %s", k, te,
                 row["model"]["mae"], row["carry_forward"]["mae"], row["ablation_no_satellite"]["mae"],
                 row["model"]["coverage90"], coef)

    cfg, top = tune(lab, rounds)
    f = fit(lab, cfg)
    runs = inner_runs(lab, rounds, cfg)
    terms, lin_scores = select_linear(runs)
    coef = fit_linear(lab, terms)
    cal = conformal(calibration_residuals(lab, rounds, cfg, runs, terms))
    (out / "model.json").write_text(json.dumps(export(f, cal, "lightgbm-final", cfg, rounds, coef)))
    expected["lightgbm-final"] = f.predict(d) + linear(d, coef)
    imp = np.mean([b.feature_importance("gain") for b in f.boosters], axis=0)
    report["final"] = {"config": cfg, "tuning_top5": top, "linear": coef, "linear_selection": lin_scores,
                       "calibration": cal, "trained_on": rounds,
                       "importance_gain": dict(sorted(zip(FEATURES, imp.round(1).tolist()), key=lambda kv: -kv[1]))}
    exp = d[["adm3_pcode", "year"]].copy()
    for name, pred in expected.items():
        exp[name] = pred
    exp.to_csv(out / "expected.csv", index=False, float_format="%.17g")
    f3 = report["folds"][-1]
    report["headline"] = {
        "fold": f3["fold"], "test_round": f3["test_round"],
        "model": {k: round(v, 4) for k, v in f3["model"].items() if isinstance(v, float)},
        "carry_forward_mae": round(f3["carry_forward"]["mae"], 4),
        "no_satellite_mae": round(f3["ablation_no_satellite"]["mae"], 4),
        "n": f3["model"]["n"],
    }
    report["seconds"] = round(time.time() - t_start, 1)
    (out / "metrics.json").write_text(json.dumps(report, indent=1))
    if baseline is not None and baseline.exists():
        problems = gate_metrics(report["headline"], json.loads(baseline.read_text())["headline"])
        if problems:
            raise RuntimeError("metrics gate failed (pass --accept-metrics after review): " + "; ".join(problems))
    return report
