"""Repository paths shared by the pipeline modules."""
from __future__ import annotations

from pathlib import Path

PIPELINE_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = PIPELINE_DIR.parent
DATA = REPO_ROOT / "data"
RAW = DATA / "raw"
INTERIM = DATA / "interim"
REGISTRY_PATH = PIPELINE_DIR / "sources.yaml"
CROSSWALK_OVERRIDES = PIPELINE_DIR / "crosswalk" / "sae_overrides.csv"
