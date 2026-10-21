"""Token-less fallback for CI: download public, sha256-pinned file sources straight from their first
upstream link, without archivekit (which needs ARCHIVE_READ_TOKEN to install). Bytes must equal the
registry's `checks.sha256` pin, i.e. the exact file archivekit validated; anything else fails the run.
Sources without a public pinned link (the PSA workbooks) are not fetched here: the committed
pipeline/inputs/labels.parquet, built from archivekit-validated files, is used instead.
Remove once ARCHIVE_READ_TOKEN exists (then `lgu inputs` fetches everything through archivekit).
"""
from __future__ import annotations

import hashlib
from pathlib import Path

import httpx
import yaml

from .paths import REGISTRY_PATH, REPO_ROOT


def fetch(source_id: str) -> Path:
    reg = yaml.safe_load(REGISTRY_PATH.read_text())
    src = next(s for s in reg["sources"] if s["id"] == source_id)
    pin = src.get("checks", {}).get("sha256")
    if not pin:
        raise ValueError(f"{source_id}: no sha256 pin; only pinned sources can be fetched without archivekit")
    url = next(lk["url"] for lk in src["links"] if lk.get("url") and lk.get("automatic", True))
    dest = REPO_ROOT / src["local_path"]
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and hashlib.sha256(dest.read_bytes()).hexdigest() == pin:
        return dest
    h = hashlib.sha256()
    tmp = dest.with_name(dest.name + ".part")
    with httpx.stream("GET", url, follow_redirects=True, timeout=httpx.Timeout(300, connect=30)) as r, open(tmp, "wb") as f:
        r.raise_for_status()
        for chunk in r.iter_bytes(1 << 20):
            h.update(chunk)
            f.write(chunk)
    if h.hexdigest() != pin:
        tmp.unlink()
        raise ValueError(f"{source_id}: sha256 {h.hexdigest()} differs from the pinned {pin}")
    tmp.rename(dest)
    return dest
