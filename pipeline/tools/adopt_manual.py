"""Adopt a file downloaded by hand as an archivekit snapshot of a registry source.

psa.gov.ph answers every automated client with a Cloudflare challenge (spike S7), so some PSA files
can only be downloaded in a browser. This tool feeds such a file to archivekit's own `snapshot()`
as if the source's primary link had served it (an in-memory transport answers that one URL with the
local bytes), so the release gets the kit's normal checks, hooks, manifest, SHA256SUMS and tag
`<id>-<YYYY-MM-DD>`, and every reader of the archive (fetch, restore, doctor) can use it.

    GITHUB_TOKEN=$(gh auth token) uv run python tools/adopt_manual.py psa-sae-2023 <file> --date 2026-10-21 \
        --note "downloaded by hand from <page> on 2026-10-21"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import httpx
from archivekit import load_registry
from archivekit.github import ArchiveClient
from archivekit.registry import automatic_links
from archivekit.snapshot import snapshot

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from lgu.paths import REGISTRY_PATH, REPO_ROOT  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("source_id")
    ap.add_argument("file", type=Path)
    ap.add_argument("--date", required=True, help="the day the file was downloaded by hand (YYYY-MM-DD)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    reg = load_registry(REGISTRY_PATH, root=REPO_ROOT)
    src = reg.source(a.source_id)
    url = automatic_links(src)[0]["url"]
    body = a.file.read_bytes()

    def serve(req: httpx.Request) -> httpx.Response:
        if req.url == httpx.URL(url) and req.method in ("GET", "HEAD"):
            return httpx.Response(200, stream=httpx.ByteStream(b"" if req.method == "HEAD" else body), headers={
                "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "content-length": str(len(body))})
        return httpx.Response(404)

    local = httpx.Client(transport=httpx.MockTransport(serve))
    archive = ArchiveClient(reg.archive["repo"], os.environ["GITHUB_TOKEN"], httpx.Client(timeout=120))
    res = snapshot(reg, a.source_id, client=local, archive=archive, out_dir=Path("snapshots"),
                   dry_run=a.dry_run, date=a.date)
    print(json.dumps(res, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
