#!/usr/bin/env python3
"""Validation gates for an automatic data version (docs/architecture/AUTO-DATA-UPDATES.md).

    scripts/data-gates.py --new data/dist/v6 --prev <unpacked live version> --version v6 [--new-year 2026] [--report f.json]

Compares the read models a data run just built with the version the app serves now, before anything is published.
Every gate must pass; the exit code is 1 when any fails (each failure is an ::error:: line), 2 on bad arguments.
Stdlib only, so it runs on a bare runner. The thresholds are module constants, chosen from the published versions
(v3 -> v4 -> v5 differ far less than these) and kept loose enough for one more satellite year:

  files     every file the app reads exists (manifest, index, metrics, tiles-attrs, lgu/, tiles/, whatif/)
  schema    manifest keys, tiles-attrs columns and the per-LGU document keys are a superset of the live version's;
            manifest.version is the version being built
  years     the feature years contain every live year, are contiguous, and end at --new-year when given
  lgus      no LGU dropped: the manifest count, index.json, lgu/*.json and tiles-attrs rows all cover the live set
  coverage  each live year has at least as many shown values as live (minus 1 % of LGUs); a new year at least
            the live minimum
  values    every shown value is a percentage in [0, 100]; official (PSA) values of live years are unchanged;
            model values of live years move by a median of at most 3 points and a 95th percentile of at most 12,
            overall and in every year;
            the new year's median is within 6 points of the year before it
  tiles     at least 95 % as many vector tiles as live; the what-if model and snapshot exist
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import statistics
import sys
from pathlib import Path

APP_FILES = ["manifest.json", "index.json", "metrics.json", "tiles-attrs.csv", "lgu", "tiles", "whatif"]
COVERAGE_SLACK = 0.01        # share of LGUs a live year may lose
OFFICIAL_TOL = 0.051         # official values are printed with one decimal; equal means within rounding
OFFICIAL_CHANGED_MAX = 0.005 # share of live official cells allowed to change (a PSA re-weighting such as v5's Manila)
MODEL_MEDIAN_MAX = 3.0       # points, median |new - live| of model values in live years
MODEL_P95_MAX = 12.0         # points, 95th percentile of the same
NEW_YEAR_MEDIAN_MAX = 6.0    # points, |median(new year) - median(year before)|
TILES_MIN_RATIO = 0.95


def read_attrs(d: Path) -> tuple[list[str], dict[str, dict[str, str]]]:
    with open(d / "tiles-attrs.csv", newline="") as f:
        r = csv.DictReader(f)
        return list(r.fieldnames or []), {row["pcode"]: row for row in r}


def num(x: str | None) -> float | None:
    try:
        return float(x) if x not in (None, "") else None
    except ValueError:
        return None


def p95(xs: list[float]) -> float:
    s = sorted(xs)
    return s[min(len(s) - 1, round(0.95 * (len(s) - 1)))] if s else 0.0


def gates(new: Path, prev: Path, version: str, new_year: int | None) -> tuple[list[str], dict]:
    fail: list[str] = []
    rep: dict = {"version": version, "new_year": new_year}

    missing = [f for f in APP_FILES if not (new / f).exists()]
    if missing:
        return [f"files: missing {', '.join(missing)}"], rep

    mn, mp = (json.loads((d / "manifest.json").read_text()) for d in (new, prev))
    if mn.get("version") != version:
        fail.append(f"schema: manifest.version is {mn.get('version')!r}, expected {version!r}")
    if lost := sorted(set(mp) - set(mn)):
        fail.append(f"schema: manifest lost keys {lost}")
    if lost := sorted(set(mp.get("rounds", [])) - set(mn.get("rounds", []))):
        fail.append(f"schema: SAE rounds dropped {lost}")

    yn, yp = list(mn.get("years", [])), list(mp.get("years", []))
    rep["years"] = {"new": [yn[0], yn[-1]] if yn else None, "live": [yp[0], yp[-1]] if yp else None}
    if lost := sorted(set(yp) - set(yn)):
        fail.append(f"years: live years missing {lost}")
    if not yn or yn != list(range(yn[0], yn[-1] + 1)):
        fail.append(f"years: not contiguous {yn}")
    if new_year is not None and (not yn or yn[-1] != new_year):
        fail.append(f"years: last year {yn[-1] if yn else None}, expected {new_year}")

    cols_n, an = read_attrs(new)
    cols_p, ap = read_attrs(prev)
    if lost := [c for c in cols_p if c not in cols_n]:
        fail.append(f"schema: tiles-attrs lost columns {lost[:10]}")
    idx_n = {x["p"] for x in json.loads((new / "index.json").read_text())["lgus"]}
    idx_p = {x["p"] for x in json.loads((prev / "index.json").read_text())["lgus"]}
    docs_n = {p.stem for p in (new / "lgu").glob("*.json")}
    rep["lgus"] = {"new": mn.get("lgus"), "live": mp.get("lgus"), "index": len(idx_n), "docs": len(docs_n),
                   "attrs": len(an)}
    if (mn.get("lgus") or 0) < (mp.get("lgus") or 0):
        fail.append(f"lgus: manifest count {mn.get('lgus')} < live {mp.get('lgus')}")
    for name, have in (("index.json", idx_n), ("lgu/*.json", docs_n), ("tiles-attrs", set(an))):
        if lost := sorted(idx_p - have):
            fail.append(f"lgus: {len(lost)} live LGUs missing from {name} (e.g. {lost[:3]})")
    if sample := sorted(idx_p & docs_n)[:1]:
        kn = set(json.loads((new / "lgu" / f"{sample[0]}.json").read_text()))
        kp = set(json.loads((prev / "lgu" / f"{sample[0]}.json").read_text()))
        if lost := sorted(kp - kn):
            fail.append(f"schema: LGU document lost keys {lost}")

    def yy(y: int) -> str:
        return f"{y % 100:02d}"

    n_lgus = max(len(idx_p), 1)
    cov: dict = {}
    live_min = 1.0
    for y in yn:
        c_new = sum(1 for r in an.values() if num(r.get(f"v{yy(y)}")) is not None)
        c_old = sum(1 for r in ap.values() if num(r.get(f"v{yy(y)}")) is not None) if y in yp else None
        cov[y] = {"new": c_new, "live": c_old}
        if c_old is not None:
            live_min = min(live_min, c_old / n_lgus)
            if c_new < c_old - COVERAGE_SLACK * n_lgus:
                fail.append(f"coverage: {y} has {c_new} shown values, live {c_old}")
    for y in (y for y in yn if y not in yp):
        if cov[y]["new"] < (live_min - COVERAGE_SLACK) * n_lgus:
            fail.append(f"coverage: new year {y} has {cov[y]['new']} shown values (live minimum {live_min:.1%})")
    rep["coverage"] = cov

    bad_range = [(p, y) for p, r in an.items() for y in yn
                 if (v := num(r.get(f"v{yy(y)}"))) is not None and not 0.0 <= v <= 100.0]
    if bad_range:
        fail.append(f"values: {len(bad_range)} shown values outside [0, 100] (e.g. {bad_range[:3]})")

    off_total = off_changed = 0
    model_d: list[float] = []
    by_year: dict[int, list[float]] = {}
    for p, ro in ap.items():
        rn = an.get(p)
        if rn is None:
            continue
        for y in yp:
            k = yy(y)
            vo, vn = num(ro.get(f"v{k}")), num(rn.get(f"v{k}"))
            if vo is None:
                continue
            if ro.get(f"s{k}") == "0":
                off_total += 1
                if vn is None or rn.get(f"s{k}") != "0" or abs(vn - vo) > OFFICIAL_TOL:
                    off_changed += 1
            elif vn is not None and rn.get(f"s{k}") == "1":
                model_d.append(abs(vn - vo))
                by_year.setdefault(y, []).append(abs(vn - vo))
    med = statistics.median(model_d) if model_d else 0.0
    rep["values"] = {"official_cells": off_total, "official_changed": off_changed, "model_cells": len(model_d),
                     "model_median_abs_diff": round(med, 3), "model_p95_abs_diff": round(p95(model_d), 3)}
    if off_total and off_changed > OFFICIAL_CHANGED_MAX * off_total:
        fail.append(f"values: {off_changed} of {off_total} official values changed")
    if med > MODEL_MEDIAN_MAX:
        fail.append(f"values: model values moved by a median of {med:.2f} points (max {MODEL_MEDIAN_MAX})")
    if p95(model_d) > MODEL_P95_MAX:
        fail.append(f"values: model values moved by {p95(model_d):.2f} points at the 95th percentile (max {MODEL_P95_MAX})")
    for y, d in sorted(by_year.items()):
        if statistics.median(d) > MODEL_MEDIAN_MAX or p95(d) > MODEL_P95_MAX:
            fail.append(f"values: {y} model values moved by a median of {statistics.median(d):.2f} and a 95th "
                        f"percentile of {p95(d):.2f} points (max {MODEL_MEDIAN_MAX} / {MODEL_P95_MAX})")
    for y in (y for y in yn if y not in yp and y - 1 in yn):
        a = [v for r in an.values() if (v := num(r.get(f"v{yy(y)}"))) is not None]
        b = [v for r in an.values() if (v := num(r.get(f"v{yy(y - 1)}"))) is not None]
        if a and b and abs(statistics.median(a) - statistics.median(b)) > NEW_YEAR_MEDIAN_MAX:
            fail.append(f"values: {y} median {statistics.median(a):.1f} vs {y - 1} {statistics.median(b):.1f}")
        rep["values"][f"median_{y}"] = round(statistics.median(a), 2) if a else None

    tn = sum(1 for _ in (new / "tiles").rglob("*") if _.is_file())
    tp = sum(1 for _ in (prev / "tiles").rglob("*") if _.is_file())
    rep["tiles"] = {"new": tn, "live": tp}
    if tn < TILES_MIN_RATIO * tp:
        fail.append(f"tiles: {tn} tiles, live {tp}")
    if missing := [f for f in ("model.json", "snapshot.bin") if not (new / "whatif" / f).is_file()]:
        fail.append(f"files: whatif/{', '.join(missing)} missing")
    return fail, rep


def main() -> int:
    a = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    a.add_argument("--new", type=Path, required=True)
    a.add_argument("--prev", type=Path, required=True)
    a.add_argument("--version", required=True)
    a.add_argument("--new-year", type=int)
    a.add_argument("--report", type=Path)
    o = a.parse_args()
    if not re.fullmatch(r"v\d+", o.version):
        print(f"bad version {o.version!r}", file=sys.stderr)
        return 2
    fail, rep = gates(o.new, o.prev, o.version, o.new_year)
    rep["passed"] = not fail
    rep["failures"] = fail
    if o.report:
        o.report.write_text(json.dumps(rep, indent=1))
    for f in fail:
        print(f"::error title=data gate::{f}")
    print(json.dumps({k: rep[k] for k in rep if k not in ("coverage",)}, indent=1))
    return 1 if fail else 0


if __name__ == "__main__":
    sys.exit(main())
