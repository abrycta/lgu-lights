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

from .rounds import ROUNDS

PI = re.compile(r"^Poverty Incidence among Population")

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


def read_jsonstat(path: Path) -> pd.DataFrame:
    """JSON-stat 1.0 table -> long rows (name, depth, year, pi) for the poverty-incidence item."""
    d = json.loads(path.read_text(encoding="utf-8-sig"))["dataset"]
    dims = d["dimension"]["id"]
    d["size"] = d["dimension"]["size"]
    geo, item, year = dims[0], dims[1], dims[2]
    cats = {k: d["dimension"][k]["category"] for k in dims}
    order = {k: sorted(c["index"], key=c["index"].get) for k, c in cats.items()}
    labels = {k: [cats[k]["label"][v] for v in order[k]] for k in dims}
    vals = d["value"]
    vals = [vals.get(str(i)) for i in range(int(np.prod(d["size"])))] if isinstance(vals, dict) else vals
    arr = np.array([np.nan if v is None else float(v) for v in vals]).reshape(d["size"])
    k = next(i for i, lab in enumerate(labels[item]) if PI.match(lab))
    rows = []
    for g, name in enumerate(labels[geo]):
        depth = len(name) - len(name.lstrip("."))
        for y, yl in enumerate(labels[year]):
            rows.append({"name": name.lstrip(". ").strip(), "depth": depth, "year": int(yl), "pi": arr[g, k, y]})
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
