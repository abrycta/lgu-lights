"""Freshness check (audit L-C7), with mocked HTTP."""
import httpx

from lgu import freshness, laads


def bm_client(tiles, known=laads.PH_TILES):
    """CMR with `tiles` for 2026 and `known` for 2025 (a year the runs already use)."""
    def handler(req):
        y = req.url.params["temporal"][:4]
        names = [f"VJ146A4.A{y}001.{t}.002.2027001000000.h5" for t in (tiles if y == "2026" else known)]
        return httpx.Response(200, json={"feed": {"entry": [
            {"links": [{"rel": "http://esipfed.org/ns/fedsearch/1.1/data#", "href": f"https://x/{n}"}]}
            for n in names]}})
    return httpx.Client(transport=httpx.MockTransport(handler))


def test_a_new_black_marble_year_is_reported_only_when_all_tiles_exist():
    with bm_client(laads.PH_TILES) as c:
        assert freshness.black_marble(c, 2026)["new"] == "2026"
    with bm_client(laads.PH_TILES[:3]) as c:
        assert freshness.black_marble(c, 2026) is None


def test_a_moved_collection_is_an_error_not_no_new_data():
    with bm_client((), known=()) as c:
        rep = freshness.check(c, last_year=2025)
    assert any("collection version" in e and "moved" in e for e in rep["errors"])


def test_fies_years_come_from_the_year_variable():
    meta = {"variables": [{"code": "Geolocation", "valueTexts": ["PHILIPPINES"]},
                          {"code": "Year", "values": ["0", "1"], "valueTexts": ["2023", "2025"]}]}
    assert freshness.fies_years(meta) == [2023, 2025]


def test_unreachable_sources_are_warnings_not_failures(capsys):
    with httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(503))) as c:
        rep = freshness.check(c, last_year=2025)
    assert rep["findings"] == [] and len(rep["errors"]) == 3
    assert "::warning title=freshness check failed::" in capsys.readouterr().out
