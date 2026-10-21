"""LGU Lights' adapter over archivekit (abrycta/data-archive-kit).

Fallback (primary -> mirrors -> private archive), validation, provenance and issues live in the kit.
This module binds the project's registry and holds the project hooks referenced from it.

    uv run python -m lgu sources fetch psa-sae-2023      # = archivekit fetch --registry pipeline/sources.yaml
"""
from __future__ import annotations

import dataclasses
import io
import tempfile
import zipfile
from functools import lru_cache
from pathlib import Path
from typing import Any

import archivekit
from archivekit import Provenance, Registry, RunManifest, SchemaError

from .paths import REGISTRY_PATH, REPO_ROOT

__all__ = ["check_adm3", "check_sae", "ensure", "fetch", "local_path", "registry"]


@lru_cache(maxsize=1)
def registry() -> Registry:
    return archivekit.load_registry(REGISTRY_PATH, root=REPO_ROOT)


def local_path(source_id: str) -> Path:
    return REPO_ROOT / str(registry().source(source_id)["local_path"])


def fetch(source_id: str, dest: Path | None = None, **kw: Any) -> Provenance:
    return archivekit.fetch(source_id, registry(), dest or local_path(source_id), **kw)


def ensure(source_id: str, manifest: RunManifest | None = None) -> Path:
    """Fetch unless a local copy with a provenance sidecar exists; record provenance in `manifest`."""
    path = local_path(source_id)
    side = archivekit.read_provenance(path) if path.exists() else None
    if side is not None:
        fields = {f.name for f in dataclasses.fields(Provenance)}
        prov = Provenance(**{k: v for k, v in side.items() if k in fields})
    else:
        prov = fetch(source_id)
    if manifest is not None:
        manifest.add(prov)
    return path


def check_sae(path: Path, src: dict[str, Any]) -> list[str]:
    """Hook: the workbook has a PSGC-keyed sheet with at least 1,500 LGU rows."""
    import openpyxl

    try:  # a file object: archivekit validates temp files without an .xlsx suffix
        wb = openpyxl.load_workbook(io.BytesIO(Path(path).read_bytes()), read_only=True, data_only=True)
    except Exception as e:
        raise SchemaError(f"not a readable xlsx workbook: {e}") from e
    try:
        best = 0
        for ws in wb.worksheets:
            ids = sum(1 for r in ws.iter_rows(max_col=3, values_only=True)
                      if isinstance(r[0], (int, float)) and r[2])
            best = max(best, ids)
        if best < 1500:
            raise SchemaError(f"no sheet with >= 1,500 PSGC-keyed LGU rows (best {best})")
    finally:
        wb.close()
    return []


def check_adm3(path: Path, src: dict[str, Any]) -> list[str]:
    """Hook: the geodatabase has an admin3 layer with about 1,642 features and pcodes."""
    import pyogrio

    with zipfile.ZipFile(path) as z:
        gdbs = {n.split("/")[0] for n in z.namelist() if ".gdb" in n.split("/")[0]}
    if len(gdbs) != 1:
        raise SchemaError(f"expected one .gdb folder in the zip, found {sorted(gdbs)}")
    # GDAL recognises /vsizip/ archives by their .zip suffix; archivekit validates suffix-less temp files
    with tempfile.TemporaryDirectory() as td:
        link = Path(td) / "candidate.zip"
        link.symlink_to(Path(path).resolve())
        ds = f"/vsizip/{link}/{gdbs.pop()}"
        layers = [n for n, _ in pyogrio.list_layers(ds) if "adm3" in n.lower() or "admin3" in n.lower()]
        if not layers:
            raise SchemaError("no admin3 layer in the geodatabase")
        info = pyogrio.read_info(ds, layer=layers[0])
    if not 1600 <= info["features"] <= 1700:
        raise SchemaError(f"admin3 layer has {info['features']} features (expected about 1,642)")
    cols = {c.lower() for c in info["fields"]}
    if "adm3_pcode" not in cols:
        raise SchemaError("admin3 layer has no adm3_pcode field")
    return []
