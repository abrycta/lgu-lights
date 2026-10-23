"""Is newer upstream data available than the app's runs use? (audit L-C7; `uv run python -m lgu freshness`)

A cheap monthly check (.github/workflows/freshness.yml, no satellite work, no data touched):
  * Black Marble: are the five PH tiles of the year after the last run year (config/rounds.json run_years)
    listed in CMR (VNP46A4 or, from 2026, VJ146A4)?
  * PSA FIES (OpenSTAT): does a table's metadata list a year after the newest SAE round?
Findings are printed as ::warning:: lines and as JSON; the workflow turns them into one deduplicated issue in the
private archive repo, and check errors (a dead source, a moved collection) into another. Nothing here is public: the app keeps serving the last published version.
New SAE rounds and PSGC quarters sit behind PSA's Cloudflare challenge and are not checked here.
"""
from __future__ import annotations

import logging
import re

import httpx

from . import laads
from .rounds import ROUNDS, RUN_YEARS

log = logging.getLogger("lgu.freshness")
FIES_TABLES = {
    "psa-fies-prov-2018-2023": "https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB/1F/FY/0031F3DF020.px",
    "psa-fies-prov-nohuc": "https://openstat.psa.gov.ph/PXWeb/api/v1/en/DB/1F/FY/0041F3DF02A.px",
}


def _bm_tiles(client: httpx.Client, year: int) -> tuple[str, set[str]]:
    product = laads.bm_product(year)
    day = f"{year}-01-01T00:00:00Z"
    tag = f".A{year}001."
    names = {(laads._data_link(e) or "").rsplit("/", 1)[-1] for e in laads._cmr_entries(client, product, day, day)}
    return product, {t for t in laads.PH_TILES for n in names if tag in n and f".{t}." in n}


def black_marble(client: httpx.Client, year: int) -> dict | None:
    """A finding when all PH tiles of `year` are in CMR. The year before (already in the runs, so known to exist)
    is queried first: if CMR has none of its tiles, the pinned collection version has moved and "no new data" would
    be reported forever, so that is an error (verifier gap A2-9)."""
    known, have = _bm_tiles(client, year - 1)
    if len(have) < len(laads.PH_TILES):
        raise ValueError(f"CMR lists {len(have)} of {len(laads.PH_TILES)} PH tiles of {known} {year - 1}, a year "
                         f"the runs already use (collection version {laads.CMR_VERSION[known]} moved?)")
    product, tiles = _bm_tiles(client, year)
    if len(tiles) == len(laads.PH_TILES):
        return {"source": f"black-marble ({product})", "new": str(year),
                "action": f"run a data version with years ending {year} (features on, canary on)"}
    return None


def fies_years(meta: dict) -> list[int]:
    """Years listed by a PXWeb table's metadata (the variable whose values are all years)."""
    for v in meta.get("variables", []):
        texts = [str(x) for x in v.get("valueTexts") or v.get("values") or []]
        if texts and all(re.fullmatch(r"\d{4}", t) for t in texts):
            return sorted(int(t) for t in texts)
    raise ValueError("no year variable in the table metadata")


def fies(client: httpx.Client, sid: str, url: str, newest_round: int) -> dict | None:
    r = client.get(url)
    r.raise_for_status()
    newer = [y for y in fies_years(r.json()) if y > newest_round]
    if newer:
        return {"source": sid, "new": ", ".join(map(str, newer)),
                "action": "fetch with tools/fetch_openstat.py, adopt, update the pin, then `lgu fies` (gated)"}
    return None


def check(client: httpx.Client, last_year: int | None = None) -> dict:
    last_year = last_year or int(RUN_YEARS.split("-")[-1])
    findings, errors = [], []
    checks = [("black-marble", lambda: black_marble(client, last_year + 1))]
    checks += [(sid, lambda sid=sid, url=url: fies(client, sid, url, max(ROUNDS))) for sid, url in FIES_TABLES.items()]
    for name, fn in checks:
        try:
            f = fn()
        except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
            errors.append(f"{name}: {type(e).__name__}: {str(e)[:200]}")
            continue
        if f:
            findings.append(f)
    for f in findings:
        print(f"::warning title=new upstream data::{f['source']}: {f['new']} available ({f['action']})")
    for e in errors:
        print(f"::warning title=freshness check failed::{e}")
    return {"last_run_year": last_year, "newest_round": max(ROUNDS), "findings": findings, "errors": errors}
