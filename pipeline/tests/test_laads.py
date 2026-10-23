"""Black Marble product per year and the S-NPP/NOAA-20 cross-calibration (audit M4)."""
import numpy as np
import pytest

from lgu import laads


def test_product_switches_to_noaa20_in_2026():
    assert [laads.bm_product(y) for y in (2012, 2025, 2026, 2030)] == ["VNP46A4", "VNP46A4", "VJ146A4", "VJ146A4"]
    assert laads.BM_OVERLAP_YEAR == 2025


def test_ratio_scales_noaa20_onto_snpp_over_lit_pixels():
    snpp = np.array([[10.0, 2.0, 0.1], [np.nan, 4.0, 0.0]], dtype=np.float32)
    noaa20 = np.array([[8.0, 1.6, 5.0], [9.0, np.nan, 0.0]], dtype=np.float32)
    # lit in S-NPP and valid in both: 10/8 and 2/1.6 -> 12 / 9.6
    assert laads.bm_ratio(snpp, noaa20) == pytest.approx(1.25)
    with pytest.raises(RuntimeError):
        laads.bm_ratio(np.zeros((2, 2), np.float32), np.ones((2, 2), np.float32))


def test_lit_fraction_is_calibrated_per_lgu_in_noaa20_years_only():
    import pandas as pd

    res = pd.DataFrame({"adm3_pcode": ["A", "B", "C", "A", "B", "C"], "year": [2025] * 3 + [2026] * 3,
                        "bm_lit_frac": [0.3, 0.1, 0.0, 0.2, 0.05, 0.1]})
    snpp = pd.Series({"A": 0.3, "B": 0.1, "C": 0.02})
    noaa20 = pd.Series({"A": 0.2, "B": 0.05, "C": 0.0})
    out = laads.calibrate_lit(res, snpp, noaa20)
    assert out.bm_lit_frac[:3].tolist() == [0.3, 0.1, 0.0]  # S-NPP year untouched
    nat = 0.42 / 0.25  # C has no NOAA-20 lit pixels in the overlap year: national ratio
    assert out.bm_lit_frac[3:].tolist() == pytest.approx([0.3, 0.1, 0.1 * nat])
    capped = laads.calibrate_lit(res.assign(bm_lit_frac=0.9), snpp, noaa20)
    assert capped.bm_lit_frac.max() == 1.0


# ------------------------------------------------------------------ chaos: tiles, moved and dead sources (L-C2, L-C3, L-C10)
import json

import httpx


def test_a_fill_only_tile_is_rejected():
    with pytest.raises(RuntimeError, match="fill-only"):
        laads.check_tile("VNP46A4.A2025001.h30v08.002.h5", np.full((2400, 2400), np.nan, np.float32))
    ocean = np.full((100, 100), np.nan, np.float32)
    ocean[:4] = 1.0  # 4 % land (h30v06): still a tile
    laads.check_tile("h30v06", ocean)


def cmr_entry(name: str, host: str = "https://data.laadsdaac.earthdatacloud.nasa.gov/prod-lads/VNP46A4") -> dict:
    return {"producer_granule_id": name, "links": [
        {"rel": "http://esipfed.org/ns/fedsearch/1.1/data#", "href": f"{host}/{name}"},
        {"rel": "http://esipfed.org/ns/fedsearch/1.1/s3#", "href": f"s3://prod-lads/VNP46A4/{name}"}]}


def mocked(laads_status: int, cmr_status: int = 200, seen: list | None = None,
           laads_names: list[str] | None = None) -> httpx.Client:
    names = [f"VNP46A4.A{y}001.{t}.002.2025162083150.h5" for y in (2024, 2025)
             for t in laads.PH_TILES + ("h29v06",)]

    def handler(req: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(str(req.url))
        if req.url.host == "ladsweb.modaps.eosdis.nasa.gov" and laads_names is not None:
            return httpx.Response(200, json={"content": [{"name": n} for n in laads_names]})
        if req.url.host == "ladsweb.modaps.eosdis.nasa.gov":
            return httpx.Response(laads_status, text="<html>Service Unavailable</html>")
        if req.url.host == "cmr.earthdata.nasa.gov":
            assert req.url.params["version"] == "2"
            return httpx.Response(cmr_status, json={"feed": {"entry": [cmr_entry(n) for n in names]}})
        return httpx.Response(200, content=b"\x89HDF" + b"\0" * 1_000_001,
                              headers={"content-type": "application/octet-stream"})

    return httpx.Client(transport=httpx.MockTransport(handler))


def test_laads_down_falls_back_to_cmr_with_exact_year_and_own_data_links(tmp_path):
    seen: list = []
    with mocked(503, seen=seen) as client:
        found = laads._listing(client, "VNP46A4", 2025, "001")
        assert [n for n, _ in found] == sorted(n for n, _ in found) and len(found) == len(laads.PH_TILES)
        assert all(".A2025001." in n for n, _ in found)  # not the 2024 tiles CMR also returns
        assert all(u.startswith("https://data.laadsdaac.earthdatacloud.nasa.gov/") for _, u in found)
        f = laads._download(client, found[0][1], tmp_path)
    assert f.name == found[0][0] and not any("ladsweb" in u and "/archive/" in u for u in seen)


def test_cmr_fallback_lists_days_of_a_year(monkeypatch):
    with mocked(503) as client:
        assert laads._days(client, "VNP46A4", 2025) == ["001"]


def test_a_partial_or_empty_laads_listing_is_completed_from_cmr():
    part = [f"VNP46A4.A2025001.{t}.002.2025162083150.h5" for t in laads.PH_TILES[:3]]
    with mocked(200, laads_names=part) as client:
        found = laads._listing(client, "VNP46A4", 2025, "001")
    assert len(found) == len(laads.PH_TILES)
    assert sum("ladsweb" in u for _, u in found) == 3  # LAADS links kept for the tiles it listed
    with mocked(200, laads_names=[]) as client:
        assert len(laads._listing(client, "VNP46A4", 2025, "001")) == len(laads.PH_TILES)
        assert laads._days(client, "VNP46A4", 2025) == ["001"]


def test_a_dead_source_fails_loudly():
    with mocked(503, cmr_status=503) as client, pytest.raises(httpx.HTTPStatusError):
        laads._listing(client, "VNP46A4", 2025, "001")


def test_committed_ratio_is_used_and_a_moved_ratio_fails(tmp_path):
    p = tmp_path / "bm_ratio.json"
    p.write_text(json.dumps({"overlap_year": laads.BM_OVERLAP_YEAR, "ratio": 1.2, "lit": {"VNP46A4": {}, "VJ146A4": {}}}))
    rec = laads.load_ratio(p)
    laads.check_ratio(1.21, rec)  # within 2 %
    with pytest.raises(RuntimeError, match="moved"):
        laads.check_ratio(1.26, rec)
    laads.check_ratio(1.5, None)  # first derivation: nothing to compare
    p.write_text(json.dumps({"overlap_year": 2019, "ratio": 1.2, "lit": {"x": {}}}))
    with pytest.raises(RuntimeError):
        laads.load_ratio(p)


def test_a_vj113a1_year_with_few_composites_fails(monkeypatch, tmp_path):
    import sys
    import types

    monkeypatch.setitem(sys.modules, "h5py", sys.modules.get("h5py") or types.ModuleType("h5py"))  # not opened here
    monkeypatch.setattr(laads, "_days", lambda client, product, year: ["001", "017", "033", "049"])
    monkeypatch.setattr(laads, "_listing", lambda client, product, year, doy: [])
    with pytest.raises(RuntimeError, match="0 composites"):
        laads.vj113_year_mean(None, 2025, tmp_path)


def test_vj113a1_uses_the_mod13q1_composite_phase():
    days = [f"{d:03d}" for d in range(1, 366, 8)]  # VJ113A1 releases a composite every 8 days
    phase = laads.vj_phase_days(days)
    assert phase[:3] == ["001", "017", "033"] and phase[-1] == "353" and len(phase) == 23


def test_an_incomplete_vj113a1_year_is_an_incomplete_year(monkeypatch, tmp_path):
    import sys
    import types

    monkeypatch.setitem(sys.modules, "h5py", sys.modules.get("h5py") or types.ModuleType("h5py"))
    monkeypatch.setattr(laads, "_days", lambda client, product, year: ["001", "009", "017"])
    monkeypatch.setattr(laads, "_listing", lambda client, product, year, doy: [])
    with pytest.raises(laads.IncompleteYear):
        laads.vj113_year_mean(None, 2027, tmp_path)
