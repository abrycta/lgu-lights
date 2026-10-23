"""PSA provincial poverty statistics (FIES, official full-year) -> data/build/provinces_fies.parquet.

Model v3 (DECISIONS, v3 enhancement) uses them in two ways, never for the year being estimated:

* as a **lagged** provincial input: the FIES poverty incidence of the province in the previous SAE round
  r (released 1-2 years before that round's SAE), compared with the mean SAE estimate of the province
  in r (`lgu-core::features`, `prov_fies_gap`);
* as a **second yardstick** for province-level accuracy (`train.province_metrics`): model town
  estimates aggregated to the province against FIES "province without its highly urbanised cities"
  (table 2a, 2018/2021/2023), which covers the same towns as the SAE.

FIES for year t itself is never a feature: there is no FIES for the nowcast years (2024, 2025) or the
years between rounds, so a model using it could not produce the map's estimates.

Inputs (OpenSTAT PXWeb tables, JSON-stat 1.0; registry ids in sources.yaml):
    psa-fies-prov-2006-2015   table 3D/0023C3DP020   provinces incl. HUCs, 2006/2009/2012/2015 (+1991)
    psa-fies-prov-2018-2023   table 1F/FY/0031F3DF020 provinces incl. HUCs, 2018/2021/2023
    psa-fies-prov-nohuc       table 1F/FY/0041F3DF02A provinces without HUCs and HUCs, 2018/2021/2023
"""
from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import numpy as np
import pandas as pd

from .labels import SchemaError
from .rounds import ROUNDS

PI = re.compile(r"^Poverty Incidence among Population")
# A precision item for the same indicator ("... - Coefficient of Variation", "... Standard Error") is never the PI.
NOT_PI = re.compile(r"coefficient|variation|\bcv\b|standard|error|interval|margin|lower|upper", re.IGNORECASE)

# FIES names that differ from HDX COD-AB ADM2 names (normalised), -> ADM2 pcodes
ALIAS = {
    "1stdistrict": ["PH13039"], "2nddistrict": ["PH13074"], "3rddistrict": ["PH13075"], "4thdistrict": ["PH13076"],
    "compostelavalley": ["PH11082"], "davaodeoro": ["PH11082"], "samar": ["PH08060"], "westernsamar": ["PH08060"],
    "cotabato": ["PH12047"], "northcotabato": ["PH12047"], "saranggani": ["PH12080"],
    "isabelacity": ["PH09097"], "cityofisabela": ["PH09097"],
    # one province until 2022: its figure stands for both halves until FIES publishes them separately
    "maguindanao": ["PH19087", "PH19088"],
}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)|\(.*$", " ", s)  # "(w/o the City of ...)", "(Western Samar)"
    s = re.sub(r"\sr\d+,.*$|\s[a-z0-9*]+/.*$|\*.*$", " ", s)  # footnote marks "r1, 1/", "b/, c/", "*, **"
    s = s.replace("mt.", "mountain").replace("metropolitan manila", "")
    return re.sub(r"[^a-z0-9]", "", s)


def _dims(d: dict) -> tuple[str, str, str]:
    """(geo, item, year) dimension ids, found by content, not position (audit L-C8): the year dimension's labels
    are all years, the item dimension holds the poverty-incidence label, the geo dimension is the other one
    with more than one category. Any further dimension must have a single category."""
    dims = d["dimension"]["id"]
    labs = {k: list(d["dimension"][k]["category"].get("label", {}).values()) for k in dims}
    year = [k for k in dims if labs[k] and all(re.fullmatch(r"\s*\d{4}\s*", str(v)) for v in labs[k])]
    item = [k for k in dims if any(PI.match(str(v)) for v in labs[k])]
    if len(year) != 1 or len(item) != 1 or year == item:
        raise SchemaError(f"JSON-stat: cannot tell the year and item dimensions apart in {dims}")
    rest = [k for k in dims if k not in (year[0], item[0])]
    geo = [k for k in rest if len(labs[k]) > 1]
    if len(geo) != 1:
        raise SchemaError(f"JSON-stat: expected one geography dimension besides year and item, found {geo}")
    return geo[0], item[0], year[0]


def read_jsonstat(path: Path) -> pd.DataFrame:
    """JSON-stat 1.0 table -> long rows (name, depth, year, pi) for the poverty-incidence item."""
    d = json.loads(path.read_text(encoding="utf-8-sig"))["dataset"]
    dims = d["dimension"]["id"]
    size = [int(x) for x in d["dimension"]["size"]]
    geo, item, year = _dims(d)
    cats = {k: d["dimension"][k]["category"] for k in dims}
    order = {k: sorted(c["index"], key=c["index"].get) for k, c in cats.items()}
    labels = {k: [cats[k]["label"][v] for v in order[k]] for k in dims}
    vals = d["value"]
    vals = [vals.get(str(i)) for i in range(int(np.prod(size)))] if isinstance(vals, dict) else vals
    if len(vals) != int(np.prod(size)):
        raise SchemaError(f"JSON-stat: {len(vals)} values for a {size} table")
    arr = np.array([np.nan if v is None else float(v) for v in vals]).reshape(size)
    # any single-category dimension is dropped; the rest is put in (geo, item, year) order
    arr = arr.reshape([n for k, n in zip(dims, size) if k in (geo, item, year)])
    kept = [k for k in dims if k in (geo, item, year)]
    arr = np.transpose(arr, [kept.index(geo), kept.index(item), kept.index(year)])
    ks = [i for i, lab in enumerate(labels[item]) if PI.match(lab) and not NOT_PI.search(lab)]
    if len(ks) != 1:
        raise SchemaError(f"{path.name}: {len(ks)} poverty-incidence items (expected exactly 1): {labels[item]}")
    k = ks[0]
    pis = arr[:, k, :]
    if np.isfinite(pis).any() and (np.nanmin(pis) < 0 or np.nanmax(pis) > 100):
        raise SchemaError(f"{path.name}: poverty incidence outside [0, 100] ({np.nanmin(pis)}, {np.nanmax(pis)})")
    rows = []
    for g, name in enumerate(labels[geo]):
        depth = len(name) - len(name.lstrip("."))
        for y, yl in enumerate(labels[year]):
            rows.append({"name": name.lstrip(". ").strip(), "depth": depth, "year": int(yl), "pi": pis[g, y]})
    return pd.DataFrame(rows)


def to_provinces(df: pd.DataFrame, adm2: pd.DataFrame) -> pd.DataFrame:
    """Province rows (not regions or the country) mapped to ADM2 pcodes; unmapped names are dropped
    (HUCs, Cotabato City) and returned in the report by the caller."""
    byname = {norm(n): [p] for p, n in zip(adm2.adm2_pcode, adm2.adm2_name)}
    out = []
    for r in df[(df.depth >= 2) & df.pi.notna()].itertuples():
        for p in ALIAS.get(norm(r.name)) or byname.get(norm(r.name)) or []:
            out.append({"adm2_pcode": p, "round_year": r.year, "pi": r.pi, "fies_name": r.name})
    o = pd.DataFrame(out)
    # a specific figure (e.g. "Maguindanao del Sur", 2023) wins over the combined province's
    o["specific"] = [norm(n) not in ALIAS or len(ALIAS[norm(n)]) == 1 for n in o.fies_name]
    o = o.sort_values("specific", ascending=False).drop_duplicates(["adm2_pcode", "round_year"])
    return o.drop(columns="specific")


def build(raw: Path, adm2: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    incl = pd.concat([read_jsonstat(raw / "psa-fies-prov-2006-2015.json"),
                      read_jsonstat(raw / "psa-fies-prov-2018-2023.json")])
    nohuc = read_jsonstat(raw / "psa-fies-prov-nohuc.json")
    a = to_provinces(incl[incl.year.isin(ROUNDS)], adm2).rename(columns={"pi": "pi", "fies_name": "name"})
    b = to_provinces(nohuc[nohuc.year.isin(ROUNDS)], adm2).rename(columns={"pi": "pi_nohuc", "fies_name": "name_nohuc"})
    df = a.merge(b, on=["adm2_pcode", "round_year"], how="outer").sort_values(["adm2_pcode", "round_year"])
    df = df.reset_index(drop=True)
    names = set(incl[incl.depth >= 2].name) | set(nohuc[nohuc.depth >= 2].name)
    report = {"rows": len(df), "provinces": int(df.adm2_pcode.nunique()),
              "per_round": {int(k): int(v) for k, v in df.dropna(subset=["pi"]).round_year.value_counts().sort_index().items()},
              "unmapped_names": sorted(n for n in names if not (ALIAS.get(norm(n)) or norm(n) in
                                                               {norm(x) for x in adm2.adm2_name})),
              "adm2_without_figure": sorted(set(adm2.adm2_pcode) - set(df.dropna(subset=["pi"]).adm2_pcode))}
    return df, report


MIN_PROVINCES = 80  # provinces with a FIES figure per round (85-87 since 2006)


def gate_report(new: dict, committed: dict) -> list[str]:
    """Audit L-C8: every round keeps at least MIN_PROVINCES mapped provinces, and no FIES name is unmapped that
    the committed report (pipeline/inputs/provinces-fies-report.json) did not already list (names compared
    without footnote marks, so a re-issued table with new footnotes passes)."""
    problems = [f"round {y}: {n} provinces with a FIES figure (expected >= {MIN_PROVINCES})"
                for y, n in sorted(new.get("per_round", {}).items()) if int(n) < MIN_PROVINCES]
    rounds_new = {int(y) for y in new.get("per_round", {})}
    problems += [f"round {y}: no FIES figure any more" for y in sorted(ROUNDS) if y not in rounds_new
                 and str(y) in {str(k) for k in committed.get("per_round", {})}]
    known = {norm(n) for n in committed.get("unmapped_names", [])}
    fresh = sorted(n for n in new.get("unmapped_names", []) if norm(n) not in known)
    if fresh:
        problems.append(f"FIES names not mapped to a province (add an ALIAS in lgu/fies.py): {'; '.join(fresh)}")
    return problems
