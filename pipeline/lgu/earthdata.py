"""NASA Earthdata Login bearer token for LAADS downloads.

Preferred: mint (or reuse) a token per run from EARTHDATA_USERNAME / EARTHDATA_PASSWORD through the
Earthdata Login API, the way `earthaccess` does (`find_or_create_token`). Fallback: the long-lived
EARTHDATA_TOKEN secret (expires about 2026-12-20; tracked in sources.yaml health.token_expires).
Locally, the same values come from the macOS Keychain (services earthdata-login, earthdata-token).
The token is never printed or written to disk.
"""
from __future__ import annotations

import logging
import os
import subprocess

import httpx

EDL = "https://urs.earthdata.nasa.gov"
log = logging.getLogger("lgu.earthdata")


def _keychain(service: str, account: bool = False) -> str | None:
    try:
        if account:
            out = subprocess.run(["security", "find-generic-password", "-s", service], capture_output=True,
                                 text=True, check=True).stdout
            for line in out.splitlines():
                if '"acct"' in line:
                    return line.split("=", 1)[1].strip().strip('"')
            return None
        return subprocess.run(["security", "find-generic-password", "-s", service, "-w"], capture_output=True,
                              text=True, check=True).stdout.strip() or None
    except (OSError, subprocess.CalledProcessError):
        return None


def token() -> str:
    user = os.environ.get("EARTHDATA_USERNAME") or _keychain("earthdata-login", account=True)
    pwd = os.environ.get("EARTHDATA_PASSWORD") or _keychain("earthdata-login")
    if user and pwd:
        try:
            r = httpx.post(f"{EDL}/api/users/find_or_create_token", auth=(user, pwd), timeout=60)
            if r.status_code == 200 and r.json().get("access_token"):
                log.info("Earthdata: using a token from find_or_create_token (expires %s)",
                         r.json().get("expiration_date"))
                return str(r.json()["access_token"])
            log.warning("Earthdata: token minting failed (HTTP %s); falling back to EARTHDATA_TOKEN", r.status_code)
        except httpx.HTTPError as e:
            log.warning("Earthdata: token minting failed (%s); falling back to EARTHDATA_TOKEN", type(e).__name__)
    t = os.environ.get("EARTHDATA_TOKEN") or _keychain("earthdata-token")
    if not t:
        raise RuntimeError("no Earthdata credentials: set EARTHDATA_USERNAME/EARTHDATA_PASSWORD or EARTHDATA_TOKEN")
    return t
