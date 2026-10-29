"""scripts/deploy-web.sh and scripts/release-status.sh against a stub gh: a GitHub API error (rate limit, 5xx) is
never read as "release missing", so a deploy never drops a live data version (verifier gap A2-1)."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
STUB = Path(__file__).parent / "fixtures" / "gh-stub.sh"
pytestmark = pytest.mark.skipif(shutil.which("bash") is None, reason="needs bash")


def env(tmp_path: Path, **extra: str) -> dict[str, str]:
    bin_ = tmp_path / "bin"
    bin_.mkdir(exist_ok=True)
    if not (bin_ / "gh").exists():
        (bin_ / "gh").symlink_to(STUB)
    for v in ("v4", "v5"):
        (tmp_path / f"rel_data-{v}").write_text(f"published sha{v} 1 data-{v}\n")
        (tmp_path / f"digest_data-{v}").write_text(f"digest{v}\n")
    return os.environ | {"PATH": f"{bin_}:{os.environ['PATH']}", "GH_STATE": str(tmp_path), "GH_DELAY": "0",
                         "GITHUB_REPOSITORY": "o/r"} | extra


def status(tmp_path: Path, tag: str, **extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(ROOT / "scripts" / "release-status.sh"), tag, ".digest"],
                          env=env(tmp_path, **extra), capture_output=True, text=True, check=False)


def test_release_status_tells_absent_from_api_error(tmp_path):
    assert status(tmp_path, "data-v9").stdout.split() == ["absent"]
    r = status(tmp_path, "data-v4", STUB_API_FAIL="2", GH_ATTEMPTS="3")  # two 403s, then 200
    assert r.returncode == 0 and r.stdout.split() == ["present", "sha256:digestv4"]
    (tmp_path / "apifails").unlink()
    r = status(tmp_path, "data-v4", STUB_API_FAIL="99", GH_ATTEMPTS="2")  # a lasting rate limit is an error
    assert r.returncode == 1 and "absent" not in r.stdout


def test_deploy_stops_on_an_api_error_instead_of_dropping_a_live_version(tmp_path):
    r = subprocess.run(["bash", str(ROOT / "scripts" / "deploy-web.sh"), "--no-deploy"],
                       env=env(tmp_path, DATA_VERSIONS="v4 v5", LATEST="v5", STUB_API_FAIL="99",
                               STUB_API_FAIL_TAG="data-v4", GH_ATTEMPTS="2"),
                       capture_output=True, text=True, check=False)
    assert r.returncode == 1
    assert "GitHub API error while looking up the data-v4 release" in r.stderr
    assert "left out of this deploy" not in r.stdout + r.stderr
    assert "==> WASM" not in r.stdout  # stopped before building or deploying anything


def versions(tmp_path: Path, **extra: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", str(ROOT / "scripts" / "deploy-web.sh"), "--versions"],
                          env=env(tmp_path, **extra), capture_output=True, text=True, check=False)


def test_only_auto_validated_releases_after_latest_are_added(tmp_path):
    # no release after v5: exactly the committed list
    assert versions(tmp_path).stdout.split() == ["DATA_VERSIONS=v1", "v3", "v4", "v5", "LATEST=v5"]
    # a manual v6 (no marker) is not served; auto-validated v7, v8, v9: the newest two, v9 latest
    for v in ("v6", "v7", "v8", "v9"):
        (tmp_path / f"rel_data-{v}").write_text(f"published sha{v} 1 data-{v}\n")
    for v in ("v7", "v8", "v9"):
        (tmp_path / f"auto_data-{v}").write_text("")
    assert versions(tmp_path).stdout.split() == ["DATA_VERSIONS=v1", "v3", "v4", "v5", "v8", "v9", "LATEST=v9"]
    # an explicit list is never extended
    assert versions(tmp_path, DATA_VERSIONS="v4 v5", LATEST="v5").stdout.split() == [
        "DATA_VERSIONS=v4", "v5", "LATEST=v5"]
    # an API error stops the deploy instead of serving fewer versions
    r = versions(tmp_path, STUB_API_FAIL="99", STUB_API_FAIL_TAG="data-v6", GH_ATTEMPTS="2")
    assert r.returncode == 1 and "looking for automatic data versions" in r.stderr
