"""PSA Small Area Estimates -> labels.parquet on the analysis vintage (HDX COD-AB v03 ADM3).

Rounds used for the models (DECISIONS Q4, VIIRS era): 2012 and 2015 (ELL) from the "2018 - 2021"
workbook's per-round sheets, 2018 (ELL), 2021 and 2023 (Census EB) from the 2023 workbook's Annex 1,
which also publishes standard errors. Values are poverty incidence among the population in percent.

PSA keys rows by a 6-digit pre-2021 code (region 2 + province 2 + municipality 2, leading zero
dropped). The crosswalk to the HDX pcode ("PH" + region 2 + province 3 + municipality 2) is, in order:
(1) a manual override (crosswalk/sae_overrides.csv), (2) the rule PH + RR + 0PP + MM when the names
agree, (3) a unique name match inside the same province, (4) a unique name match nationally. Rows that
stay unmatched (the 14 City of Manila districts, which have no ADM3 polygon of their own) are reported
in crosswalk_report.json and left out of the labels.
"""
from __future__ import annotations

import csv
import io
import json
import re
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path

import openpyxl
import pandas as pd

ROUNDS = (2012, 2015, 2018, 2021, 2023)
ESTIMATOR = {2012: "ELL", 2015: "ELL", 2018: "ELL", 2021: "CensusEB", 2023: "CensusEB"}
Z90 = 1.6448536269514722


@dataclass
class SaeRow:
    code6: str
    province: str
    name: str
    year: int
    estimate: float
    cv: float | None
    se: float | None
    ci_lo: float | None
    ci_hi: float | None
    source_id: str


def _num(v: object) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _rows(ws) -> list[tuple[str, str, str, tuple]]:  # type: ignore[no-untyped-def]
    """(code6, province context, name, full row) for every LGU row of a sheet."""
    out, province = [], ""
    for r in ws.iter_rows(values_only=True):
        c0, c1, c2 = (r + (None, None, None))[:3]
        if isinstance(c0, (int, float)) and c2:
            if c1:  # the first LGU row of a province carries the province name in column 1
                province = str(c1).strip()
            out.append((f"{int(c0):06d}", province, str(c2).strip(), r))
        elif c0 is None and c1 and not c2:
            province = str(c1).strip()
    return out


def parse_round_sheet(wb: openpyxl.Workbook, year: int, source_id: str) -> list[SaeRow]:
    """A per-round sheet ('2012', '2015'): estimate, CV, 90 % CI lower, upper in columns 3-6."""
    rows = []
    for code, prov, name, r in _rows(wb[str(year)]):
        est, cv, lo, hi = (_num(r[i]) for i in (3, 4, 5, 6))
        if est is None:
            continue
        se = cv * est / 100 if cv is not None else None
        rows.append(SaeRow(code, prov, name, year, est, cv, se, lo, hi, source_id))
    return rows


def parse_annex_2023(wb: openpyxl.Workbook, source_id: str) -> list[SaeRow]:
    """2023 Annex 1: estimates 2018/2021/2023 (cols 3-5), CV (6-8), SE (9-11), CI pairs (12-17)."""
    rows = []
    ws = wb.worksheets[0]
    for code, prov, name, r in _rows(ws):
        for k, year in enumerate((2018, 2021, 2023)):
            est = _num(r[3 + k])
            if est is None:
                continue
            rows.append(SaeRow(code, prov, name, year, est, _num(r[6 + k]), _num(r[9 + k]),
                               _num(r[12 + 2 * k]), _num(r[13 + 2 * k]), source_id))
    return rows


# ------------------------------------------------------------------ crosswalk

_DROP = re.compile(r"\b(city|of|municipality|capital|the)\b")


def norm(name: str) -> str:
    s = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\(.*?\)", " ", s)
    s = s.replace("sto.", "santo").replace("sta.", "santa").replace("gen.", "general")
    s = _DROP.sub(" ", s)
    return re.sub(r"[^a-z]", "", s)


def same_name(a: str, b: str) -> bool:
    na, nb = norm(a), norm(b)
    return na == nb or (len(na) > 4 and (na in nb or nb in na)) or SequenceMatcher(None, na, nb).ratio() >= 0.85


def load_overrides(path: Path) -> dict[str, str]:
    """code6 -> pcode (or '' = deliberately unmatched)."""
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8") as f:
        return {r["code6"]: r["pcode"] for r in csv.DictReader(r for r in f if not r.startswith("#"))}


def _ratio(a: str, b: str) -> float:
    return SequenceMatcher(None, norm(a), norm(b)).ratio()


def _region_ok(code6: str, pcode: str) -> bool:
    """Same region, allowing ARMM (15) -> BARMM (19)."""
    r_old, r_new = code6[:2], pcode[2:4]
    return r_old == r_new or (r_old == "15" and r_new == "19")


def crosswalk(rows: list[SaeRow], adm3: pd.DataFrame, overrides: dict[str, str]) -> tuple[dict[str, str], dict]:
    """Map each PSA code to an HDX adm3 pcode. Returns (code6 -> pcode, report).

    A code is matched once, using every name PSA printed for it across rounds (some round sheets
    carry typos or shifted names, e.g. two "Araceli" rows in 2012), then rows whose own name does not
    resemble the unit are dropped in build_labels.
    """
    by_pcode = adm3.set_index("adm3_pcode")
    names: dict[str, set[str]] = {}
    prov: dict[str, str] = {}
    for r in rows:
        names.setdefault(r.code6, set()).add(r.name)
        prov.setdefault(r.code6, r.province)
    mapping: dict[str, str] = {}
    how = {"override": 0, "rule": 0, "province-name": 0, "national-name": 0}
    unmatched: list[dict] = []
    for code in sorted(names):
        ns = names[code]
        if code in overrides:
            if overrides[code]:
                mapping[code] = overrides[code]
                how["override"] += 1
            else:
                unmatched.append({"code6": code, "names": sorted(ns), "why": "override: no ADM3 unit"})
            continue
        cand = f"PH{code[:2]}0{code[2:4]}{code[4:6]}"
        if cand in by_pcode.index and max(_ratio(n, by_pcode.loc[cand, "adm3_name"]) for n in ns) >= 0.75:
            mapping[code] = cand
            how["rule"] += 1
            continue
        pool = adm3[(adm3.adm2_name.map(norm) == norm(prov[code]))]
        hits = pool[pool.adm3_name.map(lambda u, ns=ns: any(same_name(n, u) for n in ns))]
        if len(hits) == 1:
            mapping[code] = hits.adm3_pcode.iloc[0]
            how["province-name"] += 1
            continue
        hits = adm3[adm3.adm3_name.map(lambda u, ns=ns: any(norm(n) == norm(u) for n in ns))
                    & adm3.adm3_pcode.map(lambda p, code=code: _region_ok(code, p))]
        if len(hits) == 1:
            mapping[code] = hits.adm3_pcode.iloc[0]
            how["national-name"] += 1
            continue
        unmatched.append({"code6": code, "names": sorted(ns), "province": prov[code], "candidate": cand})
    dup = pd.Series(mapping).value_counts() if mapping else pd.Series(dtype=int)
    report = {"matched": how, "unmatched": unmatched,
              "many_to_one": {p: sorted(c for c, q in mapping.items() if q == p) for p in dup[dup > 1].index}}
    return mapping, report


def _rematch(name: str, pcode: str, adm3: pd.DataFrame) -> str | None:
    for prefix in (pcode[:7], pcode[:4]):  # province (PH + RR + PPP), then region (PH + RR)
        pool = adm3[adm3.adm3_pcode.str.startswith(prefix)]
        hits = pool[pool.adm3_name.map(lambda u: same_name(name, u))]
        if len(hits) == 1:
            return str(hits.adm3_pcode.iloc[0])
    return None


def build_labels(sae_2018_2021: Path, sae_2023: Path, adm3: pd.DataFrame, overrides: dict[str, str],
                 shas: dict[str, str]) -> tuple[pd.DataFrame, dict]:
    def open_wb(p: Path) -> openpyxl.Workbook:
        return openpyxl.load_workbook(io.BytesIO(p.read_bytes()), read_only=True, data_only=True)

    wb1, wb2 = open_wb(sae_2018_2021), open_wb(sae_2023)
    rows = parse_round_sheet(wb1, 2012, "psa-sae-2018-2021") + parse_round_sheet(wb1, 2015, "psa-sae-2018-2021")
    rows += parse_annex_2023(wb2, "psa-sae-2023")
    mapping, report = crosswalk(rows, adm3, overrides)
    adm3_names = dict(zip(adm3.adm3_pcode, adm3.adm3_name))
    name_mismatch: list[dict] = []
    rematched: list[dict] = []
    recs = []
    for r in rows:
        p = mapping.get(r.code6)
        if p is None:
            continue
        unit = adm3_names[p]
        if r.code6 not in overrides and _ratio(r.name, unit) < 0.6 and not same_name(r.name, unit):
            # Some round sheets (2012, 2015) shift codes against names within a province; the names are
            # right. Re-match by name inside the code's province, then its region; drop if not unique.
            q = _rematch(r.name, p, adm3)
            if q is None:
                name_mismatch.append({"code6": r.code6, "year": r.year, "psa_name": r.name, "unit": unit})
                continue
            rematched.append({"code6": r.code6, "year": r.year, "psa_name": r.name, "pcode": q})
            p = q
        se = r.se if r.se is not None else (r.cv * r.estimate / 100 if r.cv is not None else None)
        recs.append({"adm3_pcode": p, "psgc10": p[2:] + "000", "round_year": r.year, "estimate": r.estimate,
                     "se": se, "cv": r.cv, "ci_lo": r.ci_lo, "ci_hi": r.ci_hi, "estimator": ESTIMATOR[r.year],
                     "psa_code": r.code6, "psa_name": r.name, "source_id": r.source_id,
                     "source_sha256": shas.get(r.source_id)})
    report["dropped_name_mismatch"] = name_mismatch
    report["rematched_by_name"] = len(rematched)
    df = pd.DataFrame.from_records(recs)
    # Many-to-one (e.g. a municipality split after the round): keep one label per unit only when the
    # unit maps from one PSA row in that round; otherwise drop it from training (honest, no averaging).
    n = df.groupby(["adm3_pcode", "round_year"]).estimate.transform("size")
    report["dropped_many_to_one_rows"] = int((n > 1).sum())
    df = df[n == 1].sort_values(["adm3_pcode", "round_year"]).reset_index(drop=True)
    report["rows_per_round"] = {int(k): int(v) for k, v in df.round_year.value_counts().sort_index().items()}
    return df, report


def write_report(report: dict, path: Path) -> None:
    path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n")
