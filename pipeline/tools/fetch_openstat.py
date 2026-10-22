"""Fetch the PSA OpenSTAT (PXWeb) tables of the registry as JSON-stat (1.0) files.

PXWeb serves table data only to a POST with a query, which archivekit's GET-based fetch cannot send:
an automated fetch of these sources gets the table's metadata, fails validation and falls back to the
archive. This tool sends the query (every value of every variable), writes the file to the source's
local_path, and the file is then adopted as the archive snapshot with tools/adopt_manual.py:

    uv run python tools/fetch_openstat.py psa-fies-prov-2006-2015 psa-fies-prov-2018-2023 psa-fies-prov-nohuc
    GITHUB_TOKEN=$(gh auth token) uv run python tools/adopt_manual.py psa-fies-prov-nohuc \\
        data/raw/psa/psa-fies-prov-nohuc.json --date 2026-10-21

Then set the source's checks.sha256 in sources.yaml to the adopted file's sha256: the pin makes the
archive's snapshot job skip a source whose pinned file is already archived, instead of fetching the
metadata and failing (or quarantining it).
"""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parents[2]
REGISTRY = ROOT / "pipeline" / "sources.yaml"


def query_for(meta: dict) -> dict:
    return {"query": [{"code": v["code"], "selection": {"filter": "item", "values": v["values"]}}
                      for v in meta["variables"]], "response": {"format": "json-stat"}}  # json-stat2 comes back empty from OpenSTAT


def main(ids: list[str]) -> int:
    reg = yaml.safe_load(REGISTRY.read_text())
    srcs = {s["id"]: s for s in reg["sources"]}
    with httpx.Client(timeout=60, headers={"user-agent": reg["health"]["user_agent"]}) as c:
        for sid in ids:
            src = srcs[sid]
            url = src["links"][0]["url"]
            meta = c.get(url).raise_for_status().json()
            r = c.post(url, json=query_for(meta)).raise_for_status()
            body = r.content
            data = json.loads(body)
            if len(data.get("dataset", {}).get("value", [])) < 100:
                raise SystemExit(f"{sid}: unexpected response ({len(body)} bytes)")
            dest = ROOT / src["local_path"]
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(body)
            print(sid, dest.relative_to(ROOT), len(body), hashlib.sha256(body).hexdigest())
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
