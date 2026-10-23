"""scripts/swap-release.sh against a stub gh (audit L-C5): a transient API error while publishing never leaves the
tag without a release, and the previous release is kept as <tag>-prev (keep-two)."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUB = Path(__file__).parent / "fixtures" / "gh-stub.sh"
pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")


def swap(tmp_path: Path, fails: int, assets: int = 2) -> subprocess.CompletedProcess:
    bin_ = tmp_path / "bin"
    bin_.mkdir(exist_ok=True)
    if not (bin_ / "gh").exists():
        (bin_ / "gh").symlink_to(STUB)
    files = []
    for i in range(assets):
        f = tmp_path / f"a{i}"
        f.write_text("x")
        files.append(str(f))
    env = os.environ | {"PATH": f"{bin_}:{os.environ['PATH']}", "GH_STATE": str(tmp_path), "SWAP_DELAY": "0",
                        "SWAP_ATTEMPTS": "3", "STUB_FAIL_PUBLISH": str(fails), "GITHUB_RUN_ID": "9",
                        "GITHUB_RUN_ATTEMPT": "1", "GITHUB_REPOSITORY": "o/r"}
    return subprocess.run(["bash", str(ROOT / "scripts" / "swap-release.sh"), "data-v5", "newsha", "data-v5", "notes",
                           "false", *files], env=env, capture_output=True, text=True, check=False)


def state(tmp_path: Path, tag: str) -> list[str] | None:
    f = tmp_path / f"rel_{tag}"
    return f.read_text().split() if f.exists() else None


def old_release(tmp_path: Path) -> None:
    (tmp_path / "rel_data-v5").write_text("published oldsha 2 data-v5\n")
    (tmp_path / "tag_data-v5").write_text("oldsha\n")


def test_transient_publish_errors_are_retried_and_the_old_release_is_kept(tmp_path):
    old_release(tmp_path)
    r = swap(tmp_path, fails=2)
    assert r.returncode == 0, r.stdout + r.stderr
    assert state(tmp_path, "data-v5")[:3] == ["published", "newsha", "2"]
    assert state(tmp_path, "data-v5-prev")[:2] == ["published", "oldsha"]


def test_a_failed_publish_restores_the_previous_release(tmp_path):
    old_release(tmp_path)
    r = swap(tmp_path, fails=99)
    assert r.returncode == 1
    assert state(tmp_path, "data-v5")[:2] == ["published", "oldsha"]  # never missing
    assert state(tmp_path, "data-v5-run9-1")[0] == "draft"  # the complete draft is kept
    assert "restored data-v5" in r.stdout


def test_first_publish_has_no_previous_release(tmp_path):
    r = swap(tmp_path, fails=0)
    assert r.returncode == 0, r.stdout + r.stderr
    assert state(tmp_path, "data-v5")[:2] == ["published", "newsha"] and state(tmp_path, "data-v5-prev") is None
