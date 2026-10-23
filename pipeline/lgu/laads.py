"""LAADS DAAC (NASA) client + exactextract zonal statistics, run in GitHub Actions.

Products (sources.yaml):
  * black-marble-vnp46a4: yearly nighttime lights, 15 arc-second linear lat/lon tiles. One 4,800 x 7,200
    float32 mosaic per year (lon 110-130 E, lat 0-30 N) from tiles h29-h30 x v06-v08, layer
    AllAngle_Composite_Snow_Free (fill -999.9). All years are stacked as bands of one GeoTIFF so that
    exactextract computes each polygon's pixel coverage once for every year.
    S-NPP deliveries end 2026-11-02, so from 2026 the same product from NOAA-20 (VJ146A4: same grid, layer
    and units) is used, scaled onto the S-NPP series by one radiance ratio estimated in the overlap year 2025
    (bm_ratio); its lit fraction is then calibrated per LGU against S-NPP in the same year (calibrate_lit).
  * viirs-vj113a1: NOAA-20 16-day NDVI on the 500 m MODIS sinusoidal grid. Per year, the per-pixel mean
    of valid composites (pixel reliability 0-1) is mosaicked and reduced the same way (continuity for MODIS).

Links are tried in registry order: the LAADS archive listing, then CMR granule search for the same
files. Downloads use a bearer token from lgu.earthdata.token() and are deleted after each year.
"""
from __future__ import annotations

import concurrent.futures as cf
import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import time
from pathlib import Path

import httpx
import numpy as np

from .earthdata import token
from .paths import PIPELINE_DIR

log = logging.getLogger("lgu.laads")
LAADS = "https://ladsweb.modaps.eosdis.nasa.gov"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
PH_TILES = ("h29v07", "h29v08", "h30v06", "h30v07", "h30v08")
# CMR collection versions (Collection 2 Black Marble; VJ113A1 is LP DAAC's 002), checked against CMR 2026-10-23
CMR_VERSION = {"VNP46A4": "2", "VJ146A4": "2", "VJ113A1": "002"}
# A tile whose finite share is below this is a fill-only (blacked-out) file, not data (audit L-C2). Ocean pixels may
# be fill, and h30v06 is about 4 % land (Taiwan, Batanes), so the floor stays low; regional gaps on land are caught
# per year by the feature-store gates (lgu.features.gate_years).
MIN_TILE_FINITE = 0.01
# The committed S-NPP/NOAA-20 calibration (audit L-C10): used as is unless a run asks to recompute it; a recomputed
# ratio more than RATIO_TOLERANCE away from it fails the run.
RATIO_PATH = PIPELINE_DIR / "inputs" / "bm_ratio.json"
RATIO_TOLERANCE = 0.02

# VNP46A4: linear lat/lon, 10 x 10 degree tiles of 2,400 px (1/240 degree)
BM_RES = 1 / 240
BM_WEST, BM_NORTH, BM_W, BM_H = 110.0, 30.0, 4800, 7200

# The Black Marble product per year (audit M4): S-NPP VNP46A4 to 2025, NOAA-20 VJ146A4 from 2026 (S-NPP deliveries
# end 2026-11-02). Both exist for 2018-2025; the last S-NPP year is the overlap year for the cross-calibration.
BM_NOAA20_FROM = 2026
BM_OVERLAP_YEAR = BM_NOAA20_FROM - 1
LIT = 0.5  # nW cm-2 sr-1


def bm_product(year: int) -> str:
    return "VJ146A4" if year >= BM_NOAA20_FROM else "VNP46A4"


def bm_ratio(snpp: np.ndarray, noaa20: np.ndarray) -> float:
    """S-NPP / NOAA-20 radiance ratio over pixels lit in S-NPP and valid in both (same year). Multiplying
    NOAA-20 mosaics by it keeps the series continuous (NOAA-20 reads about 18 % lower over the Philippines in
    2024: measured on tile h30v07, sum ratio 0.825)."""
    m = np.isfinite(snpp) & np.isfinite(noaa20) & (snpp > LIT)
    if not m.any() or np.sum(noaa20[m]) <= 0:
        raise RuntimeError("Black Marble cross-calibration: no pixels lit in both products")
    return float(np.sum(snpp[m], dtype=np.float64) / np.sum(noaa20[m], dtype=np.float64))


def calibrate_lit(res, overlap_snpp, overlap_noaa20):  # type: ignore[no-untyped-def]
    """Per-LGU lit-fraction calibration of the NOAA-20 years, in the overlap year, like the radiance ratio.

    NOAA-20 sets more dim pixels to zero than S-NPP, so a radiance ratio alone leaves its lit fraction low
    (2024, tile h30v07: 2.5 % of pixels lit against 3.6 %). Each LGU's NOAA-20 lit fraction is multiplied by
    its own S-NPP / NOAA-20 ratio of the overlap year (NOAA-20 already radiance-scaled); an LGU with no NOAA-20
    lit pixels that year takes the ratio of the national sums. Results are clipped to 1. `overlap_*` are
    Series of bm_lit_frac indexed by adm3_pcode; `res` rows of S-NPP years are returned unchanged."""
    nat = float(overlap_snpp.sum() / overlap_noaa20.sum()) if overlap_noaa20.sum() > 0 else 1.0
    ratio = (overlap_snpp / overlap_noaa20.where(overlap_noaa20 > 0)).fillna(nat)
    res = res.copy()
    noaa = res.year.map(bm_product) != "VNP46A4"
    k = res.loc[noaa, "adm3_pcode"].map(ratio).fillna(nat)
    res.loc[noaa, "bm_lit_frac"] = (res.loc[noaa, "bm_lit_frac"] * k).clip(upper=1.0)
    log.warning("Black Marble: NOAA-20 lit fraction calibrated per LGU (national ratio %.4f)", nat)
    return res


# VJ113A1: MODIS sinusoidal grid, 500 m (2,400 px per tile)
SIN_CRS = "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs"
SIN_TILE = 1111950.5197665
SIN_X0, SIN_Y0 = -20015109.354, 10007554.677
SIN_PX = 2400


def _laads_url(product: str, year: int, doy: str, name: str) -> str:
    return f"{LAADS}/archive/allData/5200/{product}/{year}/{doy}/{name}"


def _cmr_entries(client: httpx.Client, product: str, start: str, end: str) -> list[dict]:
    r = client.get(CMR, params={"short_name": product, "version": CMR_VERSION[product], "temporal": f"{start},{end}",
                                "page_size": 2000, "bounding_box": "116,4,127,21"})
    r.raise_for_status()
    return list(r.json()["feed"]["entry"])


def _data_link(entry: dict) -> str | None:
    """A granule's own download link in CMR (LAADS or the Earthdata cloud), not a LAADS path built from its name."""
    return next((lk["href"] for lk in entry.get("links", [])
                 if str(lk.get("rel", "")).endswith("/data#") and str(lk.get("href", "")).startswith("https://")), None)


def _listing(client: httpx.Client, product: str, year: int, doy: str) -> list[tuple[str, str]]:
    """(file name, download URL) of the PH tiles for one product/year/day: the LAADS listing, then CMR (audit L-C3).

    CMR's temporal search also returns granules that merely overlap the day (the previous year's yearly tiles,
    the 16-day composite started before it), so names are kept only for exactly this year and day; one granule
    per tile (the newest production) is kept."""
    try:
        r = client.get(f"{LAADS}/api/v2/content/details/allData/5200/{product}/{year}/{doy}",
                       headers={"Accept": "application/json"})
        r.raise_for_status()
        found = [(c["name"], _laads_url(product, year, doy, c["name"])) for c in r.json()["content"]]
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as e:
        log.warning("%s %s/%s: LAADS listing failed (%s); trying CMR", product, year, doy, type(e).__name__)
        print(f"::warning title=LAADS listing failed::{product} {year}/{doy}: {type(e).__name__}; using CMR granule links")
        day = _doy_date(year, doy)
        found = []
        for e in _cmr_entries(client, product, day, day):
            url = _data_link(e)
            if url:
                found.append((url.rsplit("/", 1)[-1], url))
    tag = f".A{year}{doy}."
    keep: dict[str, tuple[str, str]] = {}
    for name, url in sorted(found):
        if tag in name and name.endswith(".h5"):
            tile = next((t for t in PH_TILES if f".{t}." in name), None)
            if tile:
                keep[tile] = (name, url)  # sorted: the newest production timestamp wins
    return [keep[t] for t in sorted(keep)]


def _doy_date(year: int, doy: str) -> str:
    return time.strftime("%Y-%m-%dT00:00:00Z", time.strptime(f"{year} {doy}", "%Y %j"))


def _days(client: httpx.Client, product: str, year: int) -> list[str]:
    """Days (DOY) with granules in one year: the LAADS listing, then CMR."""
    try:
        r = client.get(f"{LAADS}/api/v2/content/details/allData/5200/{product}/{year}",
                       headers={"Accept": "application/json"})
        r.raise_for_status()
        return sorted(c["name"] for c in r.json()["content"])
    except (httpx.HTTPError, KeyError, ValueError, TypeError) as e:
        log.warning("%s %s: LAADS day listing failed (%s); trying CMR", product, year, type(e).__name__)
        pat = re.compile(rf"\.A{year}(\d{{3}})\.")
        names = [(_data_link(e) or "").rsplit("/", 1)[-1] for e in
                 _cmr_entries(client, product, f"{year}-01-01T00:00:00Z", f"{year}-12-31T23:59:59Z")]
        return sorted({m.group(1) for n in names if (m := pat.search(n))})


def _download(client: httpx.Client, url: str, dest: Path) -> Path:
    out = dest / url.rsplit("/", 1)[-1]
    for attempt in range(4):
        try:
            with client.stream("GET", url) as r:
                if r.status_code != 200 or "html" in r.headers.get("content-type", ""):
                    raise httpx.HTTPError(f"HTTP {r.status_code} ({r.headers.get('content-type')})")
                with open(out, "wb") as f:
                    f.writelines(r.iter_bytes(1 << 20))
            if out.stat().st_size < 1_000_000 or out.read_bytes()[:4] != b"\x89HDF":
                raise httpx.HTTPError("not an HDF5 file")
            return out
        except httpx.HTTPError as e:
            log.warning("%s: attempt %d failed: %s", out.name, attempt + 1, e)
            time.sleep(5 * 2**attempt)
    raise RuntimeError(f"could not download {url}")


def _client() -> httpx.Client:
    return httpx.Client(headers={"Authorization": f"Bearer {token()}",
                                 "User-Agent": "lgu-lights-pipeline/0.1 (+https://github.com/abrycta/lgu-lights)"},
                        follow_redirects=True, timeout=httpx.Timeout(120, connect=30))


def check_tile(name: str, a: np.ndarray) -> None:
    """Reject a fill-only tile (a valid HDF5 file with no data, audit L-C2) instead of mosaicking NaN."""
    share = float(np.isfinite(a).mean()) if a.size else 0.0
    if share < MIN_TILE_FINITE:
        raise RuntimeError(f"{name}: only {share:.2%} of pixels hold data (min {MIN_TILE_FINITE:.0%}); "
                           "a fill-only tile is not used")


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""):
            h.update(b)
    return h.hexdigest()


def _tile_hv(name: str) -> tuple[int, int]:
    t = next(p for p in name.split(".") if p.startswith("h") and "v" in p and len(p) == 6)
    return int(t[1:3]), int(t[4:6])


def bm_year_mosaic(client: httpx.Client, year: int, work: Path, product: str | None = None,
                   granules: dict[str, str] | None = None) -> np.ndarray:
    """Black Marble radiance mosaic (nW cm-2 sr-1, NaN = no data) for one year, unscaled (bm_product by default).
    With `granules`, each tile's file name -> sha256 is recorded there (provenance of the calibration)."""
    import h5py

    product = product or bm_product(year)
    found = _listing(client, product, year, "001")
    if len(found) != len(PH_TILES):
        raise RuntimeError(f"{product} {year}: expected {len(PH_TILES)} PH tiles, found {[n for n, _ in found]}")
    mosaic = np.full((BM_H, BM_W), np.nan, dtype=np.float32)
    with cf.ThreadPoolExecutor(4) as ex:
        files = list(ex.map(lambda nu: _download(client, nu[1], work), found))
    for f in files:
        h, v = _tile_hv(f.name)
        if granules is not None:
            granules[f.name] = _sha256(f)
        with h5py.File(f) as h5:
            ds = h5["HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields/AllAngle_Composite_Snow_Free"]
            a = ds[:].astype(np.float32)
            fill = float(np.asarray(ds.attrs.get("_FillValue", [-999.9])).ravel()[0])
            a[np.isclose(a, fill) | (a < 0)] = np.nan
        check_tile(f.name, a)
        x0 = round(((-180 + 10 * h) - BM_WEST) / BM_RES)
        y0 = round((BM_NORTH - (90 - 10 * v)) / BM_RES)
        mosaic[y0:y0 + 2400, x0:x0 + 2400] = a
        f.unlink()
    return mosaic


def vj113_year_mean(client: httpx.Client, year: int, work: Path) -> tuple[np.ndarray, tuple[float, float]]:
    """Mean of valid 16-day NDVI composites (pixel reliability 0-1) on the sinusoidal grid, one year."""
    import h5py

    hs = [_tile_hv(f".{t}.") for t in PH_TILES]
    hmin, vmin = min(h for h, _ in hs), min(v for _, v in hs)
    nh, nv = max(h for h, _ in hs) - hmin + 1, max(v for _, v in hs) - vmin + 1
    total = np.zeros((nv * SIN_PX, nh * SIN_PX), dtype=np.float32)
    count = np.zeros_like(total, dtype=np.uint16)
    for doy in _days(client, "VJ113A1", year):
        found = _listing(client, "VJ113A1", year, doy)
        with cf.ThreadPoolExecutor(4) as ex:
            files = list(ex.map(lambda nu: _download(client, nu[1], work), found))
        for f in files:
            h, v = _tile_hv(f.name)
            with h5py.File(f) as h5:
                grp = next(g for k, g in h5["HDFEOS/GRIDS"].items())["Data Fields"]
                key = next(k for k in grp if "NDVI" in k and "500m" in k)
                rel = next((k for k in grp if "pixel_reliability" in k.lower()), None)
                raw = grp[key][:].astype(np.float32)
                scale = float(np.asarray(grp[key].attrs.get("scale_factor", [10000.0])).ravel()[0])
                fill = float(np.asarray(grp[key].attrs.get("_FillValue", [-15000])).ravel()[0])
                ok = raw != fill
                if rel is not None:
                    ok &= np.isin(grp[rel][:], (0, 1))
                # MODIS/VIIRS VI files store NDVI x 10000 with scale_factor 10000 (divide)
                val = raw / scale if scale > 1 else raw * scale
                ok &= (val >= -0.2) & (val <= 1.0)
            ys, xs = (v - vmin) * SIN_PX, (h - hmin) * SIN_PX
            total[ys:ys + SIN_PX, xs:xs + SIN_PX][ok] += val[ok]
            count[ys:ys + SIN_PX, xs:xs + SIN_PX][ok] += 1
            f.unlink()
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = np.where(count > 0, total / count, np.nan).astype(np.float32)
    origin = (SIN_X0 + hmin * SIN_TILE, SIN_Y0 - vmin * SIN_TILE)
    return mean, origin


def _write_stack(path: Path, bands: list[np.ndarray], transform, crs: str) -> None:  # type: ignore[no-untyped-def]
    import rasterio

    h, w = bands[0].shape
    with rasterio.open(path, "w", driver="GTiff", width=w, height=h, count=len(bands), dtype="float32", crs=crs,
                       transform=transform, nodata=np.nan, tiled=True, blockxsize=512, blockysize=512,
                       compress="deflate", predictor=3, BIGTIFF="IF_SAFER") as d:
        for i, b in enumerate(bands, start=1):
            d.write(b, i)


def load_ratio(path: Path = RATIO_PATH) -> dict | None:
    """The committed S-NPP/NOAA-20 calibration (pipeline/inputs/bm_ratio.json), or None before the first one."""
    if not path.exists():
        return None
    rec = json.loads(path.read_text())
    if rec.get("overlap_year") != BM_OVERLAP_YEAR or not rec.get("ratio") or not rec.get("lit"):
        raise RuntimeError(f"{path}: not a calibration for overlap year {BM_OVERLAP_YEAR}")
    return rec


def check_ratio(new: float, committed: dict | None) -> None:
    """A recomputed ratio must stay within RATIO_TOLERANCE of the committed one (audit L-C10): a NASA reprocessing
    that shifts it would otherwise move the whole NOAA-20 series silently."""
    if committed is None:
        return
    old = float(committed["ratio"])
    if abs(new / old - 1) > RATIO_TOLERANCE:
        raise RuntimeError(f"Black Marble cross-calibration moved from {old:.4f} to {new:.4f} (more than "
                           f"{RATIO_TOLERANCE:.0%}): review the overlap-year granules before committing a new "
                           "pipeline/inputs/bm_ratio.json")


def zonal_black_marble(adm3_path: Path, years: list[int], out: Path, recompute_ratio: bool = False,
                       ratio_path: Path = RATIO_PATH) -> Path:
    """Per-LGU yearly Black Marble stats -> Parquet (adm3_pcode, year, bm_mean, bm_sum, bm_lit_frac, bm_valid_frac).

    NOAA-20 years use the committed calibration (ratio_path) when there is one, so a run neither downloads the
    overlap year again nor depends on S-NPP staying online (audit L-C10). Without one, or with recompute_ratio, it
    is derived from the overlap year and written next to `out` as bm_ratio.json with its granules' sha256, to be
    reviewed and committed."""
    import geopandas as gpd
    import pandas as pd
    import rasterio
    from exactextract import exact_extract
    from rasterio.transform import from_origin

    polys = gpd.read_parquet(adm3_path)[["adm3_pcode", "geometry"]]
    noaa20 = any(bm_product(y) != "VNP46A4" for y in years)
    committed = load_ratio(ratio_path) if noaa20 else None
    derive = noaa20 and (committed is None or recompute_ratio)
    # Layers: the output years, plus, when the calibration is derived, the overlap year from both satellites (the
    # lit fraction calibration); each layer is three bands (radiance, lit, valid).
    layers = [(y, bm_product(y)) for y in years]
    if derive:
        layers += [(BM_OVERLAP_YEAR, "VNP46A4"), (BM_OVERLAP_YEAR, "VJ146A4")]
    n = len(layers)
    granules: dict[str, str] = {}
    with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as td, _client() as client:
        work = Path(td)
        stack = work / "bm.tif"
        # Bands 1..n radiance, n+1..2n lit (radiance > 0.5), 2n+1..3n valid; written one year at a time so
        # memory stays at one mosaic (138 MB) instead of all years.
        with rasterio.open(stack, "w", driver="GTiff", width=BM_W, height=BM_H, count=3 * n, dtype="float32",
                           crs="EPSG:4326", transform=from_origin(BM_WEST, BM_NORTH, BM_RES, BM_RES), nodata=np.nan,
                           tiled=True, blockxsize=512, blockysize=512, compress="deflate", predictor=3,
                           BIGTIFF="YES") as dst:
            scale, overlap = 1.0, {}
            if derive:
                overlap = {p: bm_year_mosaic(client, BM_OVERLAP_YEAR, work, p, granules) for p in ("VNP46A4", "VJ146A4")}
                scale = bm_ratio(overlap["VNP46A4"], overlap["VJ146A4"])
                check_ratio(scale, committed)
            elif committed is not None:
                scale = float(committed["ratio"])
            if noaa20:
                log.warning("Black Marble: NOAA-20 years scaled by %.4f (S-NPP/NOAA-20, overlap year %d, %s)",
                            scale, BM_OVERLAP_YEAR, "derived in this run" if derive else f"committed {ratio_path.name}")
            for k, (y, product) in enumerate(layers):
                t0 = time.time()
                m = overlap.pop(product) if k >= len(years) else bm_year_mosaic(client, y, work, product)
                if product != "VNP46A4":
                    m *= np.float32(scale)
                dst.write(m, k + 1)
                dst.write(np.where(np.isnan(m), np.nan, (m > LIT).astype(np.float32)), n + k + 1)
                dst.write((~np.isnan(m)).astype(np.float32), 2 * n + k + 1)
                del m
                log.info("%s %d mosaicked in %.0f s (disk free %.1f GB)", product, y, time.time() - t0,
                         disk_free_gb(td))
        t0 = time.time()
        df = exact_extract(str(stack), polys, ["mean", "sum"], include_cols=["adm3_pcode"], output="pandas")
        log.info("exactextract over %d bands in %.0f s", 3 * n, time.time() - t0)
    rows = []
    for k, (y, _) in enumerate(layers):
        b_rad, b_lit, b_val = k + 1, n + k + 1, 2 * n + k + 1
        rows.append(pd.DataFrame({
            "adm3_pcode": df.adm3_pcode, "year": y,
            "bm_mean": df[f"band_{b_rad}_mean"], "bm_sum": df[f"band_{b_rad}_sum"],
            "bm_lit_frac": df[f"band_{b_lit}_mean"], "bm_valid_frac": df[f"band_{b_val}_mean"]}))
    res = pd.concat(rows[:len(years)], ignore_index=True)
    if derive:
        snpp, vj = (r.set_index("adm3_pcode").bm_lit_frac for r in rows[len(years):])
        rec = {"overlap_year": BM_OVERLAP_YEAR, "ratio": scale, "computed": time.strftime("%Y-%m-%d"),
               "granules": dict(sorted(granules.items())),
               "lit": {"VNP46A4": {k: float(v) for k, v in snpp.dropna().items()},
                       "VJ146A4": {k: float(v) for k, v in vj.dropna().items()}}}
        (out.parent / "bm_ratio.json").parent.mkdir(parents=True, exist_ok=True)
        (out.parent / "bm_ratio.json").write_text(json.dumps(rec, indent=1) + "\n")
        print(f"::warning title=Black Marble calibration derived::ratio {scale:.4f} from overlap year {BM_OVERLAP_YEAR}; "
              "review bm_ratio.json (features release) and commit it as pipeline/inputs/bm_ratio.json")
    elif committed is not None:
        snpp, vj = (pd.Series(committed["lit"][p], dtype=float) for p in ("VNP46A4", "VJ146A4"))
    if noaa20:
        res = calibrate_lit(res, snpp, vj)
    out.parent.mkdir(parents=True, exist_ok=True)
    res.to_parquet(out, index=False)
    return out


def zonal_vj113a1(adm3_path: Path, years: list[int], out: Path) -> Path:
    """Per-LGU yearly mean NDVI from NOAA-20 VJ113A1 -> Parquet (adm3_pcode, year, vj_ndvi_mean)."""
    import geopandas as gpd
    import pandas as pd
    from exactextract import exact_extract
    from rasterio.transform import from_origin

    polys = gpd.read_parquet(adm3_path)[["adm3_pcode", "geometry"]].to_crs(SIN_CRS)
    with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as td, _client() as client:
        work = Path(td)
        bands, origin = [], (0.0, 0.0)
        for y in years:
            t0 = time.time()
            m, origin = vj113_year_mean(client, y, work)
            bands.append(m)
            log.info("VJ113A1 %d averaged in %.0f s", y, time.time() - t0)
        px = SIN_TILE / SIN_PX
        stack = work / "vj.tif"
        _write_stack(stack, bands, from_origin(origin[0], origin[1], px, px), SIN_CRS)
        del bands
        df = exact_extract(str(stack), polys, ["mean"], include_cols=["adm3_pcode"], output="pandas")
    res = pd.concat([pd.DataFrame({"adm3_pcode": df.adm3_pcode, "year": y,
                                   "vj_ndvi_mean": df[f"band_{k + 1}_mean"] if len(years) > 1 else df["mean"]})
                     for k, y in enumerate(years)], ignore_index=True)
    out.parent.mkdir(parents=True, exist_ok=True)
    res.to_parquet(out, index=False)
    return out


def disk_free_gb(path: str = ".") -> float:
    return shutil.disk_usage(path).free / 1e9
