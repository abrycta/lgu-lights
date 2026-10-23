"""LAADS DAAC (NASA) client + exactextract zonal statistics, run in GitHub Actions.

Products (sources.yaml):
  * black-marble-vnp46a4: yearly nighttime lights, 15 arc-second linear lat/lon tiles. One 4,800 x 7,200
    float32 mosaic per year (lon 110-130 E, lat 0-30 N) from tiles h29-h30 x v06-v08, layer
    AllAngle_Composite_Snow_Free (fill -999.9). All years are stacked as bands of one GeoTIFF so that
    exactextract computes each polygon's pixel coverage once for every year.
    S-NPP deliveries end 2026-11-02, so from 2026 the same product from NOAA-20 (VJ146A4: same grid, layer
    and units) is used, scaled onto the S-NPP series by one ratio estimated in the overlap year 2025 (bm_ratio).
  * viirs-vj113a1: NOAA-20 16-day NDVI on the 500 m MODIS sinusoidal grid. Per year, the per-pixel mean
    of valid composites (pixel reliability 0-1) is mosaicked and reduced the same way (continuity for MODIS).

Links are tried in registry order: the LAADS archive listing, then CMR granule search for the same
files. Downloads use a bearer token from lgu.earthdata.token() and are deleted after each year.
"""
from __future__ import annotations

import concurrent.futures as cf
import logging
import os
import shutil
import tempfile
import time
from pathlib import Path

import httpx
import numpy as np

from .earthdata import token

log = logging.getLogger("lgu.laads")
LAADS = "https://ladsweb.modaps.eosdis.nasa.gov"
CMR = "https://cmr.earthdata.nasa.gov/search/granules.json"
PH_TILES = ("h29v07", "h29v08", "h30v06", "h30v07", "h30v08")

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


# VJ113A1: MODIS sinusoidal grid, 500 m (2,400 px per tile)
SIN_CRS = "+proj=sinu +lon_0=0 +x_0=0 +y_0=0 +R=6371007.181 +units=m +no_defs"
SIN_TILE = 1111950.5197665
SIN_X0, SIN_Y0 = -20015109.354, 10007554.677
SIN_PX = 2400


def _listing(client: httpx.Client, product: str, year: int, doy: str) -> list[str]:
    """File names of the PH tiles for one product/year/day: LAADS listing, then CMR."""
    try:
        r = client.get(f"{LAADS}/api/v2/content/details/allData/5200/{product}/{year}/{doy}",
                       headers={"Accept": "application/json"})
        r.raise_for_status()
        names = [c["name"] for c in r.json()["content"]]
    except (httpx.HTTPError, KeyError, ValueError) as e:
        log.warning("%s %s/%s: LAADS listing failed (%s); trying CMR", product, year, doy, type(e).__name__)
        start = f"{year}-01-01T00:00:00Z" if doy == "001" else _doy_date(year, doy)
        r = client.get(CMR, params={"short_name": product, "temporal": f"{start},{start}", "page_size": 200,
                                    "bounding_box": "116,4,127,21"})
        r.raise_for_status()
        names = [e["producer_granule_id"] for e in r.json()["feed"]["entry"]]
    return sorted(n for n in names if n.endswith(".h5") and any(f".{t}." in n for t in PH_TILES))


def _doy_date(year: int, doy: str) -> str:
    return time.strftime("%Y-%m-%dT00:00:00Z", time.strptime(f"{year} {doy}", "%Y %j"))


def _days(client: httpx.Client, product: str, year: int) -> list[str]:
    r = client.get(f"{LAADS}/api/v2/content/details/allData/5200/{product}/{year}",
                   headers={"Accept": "application/json"})
    r.raise_for_status()
    return sorted(c["name"] for c in r.json()["content"])


def _download(client: httpx.Client, product: str, year: int, doy: str, name: str, dest: Path) -> Path:
    url = f"{LAADS}/archive/allData/5200/{product}/{year}/{doy}/{name}"
    out = dest / name
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
            log.warning("%s: attempt %d failed: %s", name, attempt + 1, e)
            time.sleep(5 * 2**attempt)
    raise RuntimeError(f"could not download {url}")


def _client() -> httpx.Client:
    return httpx.Client(headers={"Authorization": f"Bearer {token()}",
                                 "User-Agent": "lgu-lights-pipeline/0.1 (+https://github.com/abrycta/lgu-lights)"},
                        follow_redirects=True, timeout=httpx.Timeout(120, connect=30))


def _tile_hv(name: str) -> tuple[int, int]:
    t = next(p for p in name.split(".") if p.startswith("h") and "v" in p and len(p) == 6)
    return int(t[1:3]), int(t[4:6])


def bm_year_mosaic(client: httpx.Client, year: int, work: Path, product: str | None = None) -> np.ndarray:
    """Black Marble radiance mosaic (nW cm-2 sr-1, NaN = no data) for one year, unscaled (bm_product by default)."""
    import h5py

    product = product or bm_product(year)
    names = _listing(client, product, year, "001")
    if len(names) != len(PH_TILES):
        raise RuntimeError(f"{product} {year}: expected {len(PH_TILES)} PH tiles, found {names}")
    mosaic = np.full((BM_H, BM_W), np.nan, dtype=np.float32)
    with cf.ThreadPoolExecutor(4) as ex:
        files = list(ex.map(lambda n: _download(client, product, year, "001", n, work), names))
    for f in files:
        h, v = _tile_hv(f.name)
        with h5py.File(f) as h5:
            ds = h5["HDFEOS/GRIDS/VIIRS_Grid_DNB_2d/Data Fields/AllAngle_Composite_Snow_Free"]
            a = ds[:].astype(np.float32)
            fill = float(np.asarray(ds.attrs.get("_FillValue", [-999.9])).ravel()[0])
            a[np.isclose(a, fill) | (a < 0)] = np.nan
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
        names = _listing(client, "VJ113A1", year, doy)
        with cf.ThreadPoolExecutor(4) as ex:
            files = list(ex.map(lambda n, d=doy: _download(client, "VJ113A1", year, d, n, work), names))
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


def zonal_black_marble(adm3_path: Path, years: list[int], out: Path) -> Path:
    """Per-LGU yearly Black Marble stats -> Parquet (adm3_pcode, year, bm_mean, bm_sum, bm_lit_frac, bm_valid_frac)."""
    import geopandas as gpd
    import pandas as pd
    import rasterio
    from exactextract import exact_extract
    from rasterio.transform import from_origin

    polys = gpd.read_parquet(adm3_path)[["adm3_pcode", "geometry"]]
    n = len(years)
    with tempfile.TemporaryDirectory(dir=os.environ.get("RUNNER_TEMP")) as td, _client() as client:
        work = Path(td)
        stack = work / "bm.tif"
        # Bands 1..n radiance, n+1..2n lit (radiance > 0.5), 2n+1..3n valid; written one year at a time so
        # memory stays at one mosaic (138 MB) instead of all years.
        with rasterio.open(stack, "w", driver="GTiff", width=BM_W, height=BM_H, count=3 * n, dtype="float32",
                           crs="EPSG:4326", transform=from_origin(BM_WEST, BM_NORTH, BM_RES, BM_RES), nodata=np.nan,
                           tiled=True, blockxsize=512, blockysize=512, compress="deflate", predictor=3,
                           BIGTIFF="YES") as dst:
            scale = 1.0
            if any(bm_product(y) != "VNP46A4" for y in years):
                ref = bm_year_mosaic(client, BM_OVERLAP_YEAR, work, "VNP46A4")
                scale = bm_ratio(ref, bm_year_mosaic(client, BM_OVERLAP_YEAR, work, "VJ146A4"))
                del ref
                log.warning("Black Marble: NOAA-20 years scaled by %.4f (S-NPP/NOAA-20, overlap year %d)",
                            scale, BM_OVERLAP_YEAR)
            for k, y in enumerate(years):
                t0 = time.time()
                m = bm_year_mosaic(client, y, work)
                if bm_product(y) != "VNP46A4":
                    m *= np.float32(scale)
                dst.write(m, k + 1)
                dst.write(np.where(np.isnan(m), np.nan, (m > LIT).astype(np.float32)), n + k + 1)
                dst.write((~np.isnan(m)).astype(np.float32), 2 * n + k + 1)
                del m
                log.info("%s %d mosaicked in %.0f s (disk free %.1f GB)", bm_product(y), y, time.time() - t0,
                         disk_free_gb(td))
        t0 = time.time()
        df = exact_extract(str(stack), polys, ["mean", "sum"], include_cols=["adm3_pcode"], output="pandas")
        log.info("exactextract over %d bands in %.0f s", 3 * n, time.time() - t0)
    rows = []
    for k, y in enumerate(years):
        b_rad, b_lit, b_val = k + 1, n + k + 1, 2 * n + k + 1
        rows.append(pd.DataFrame({
            "adm3_pcode": df.adm3_pcode, "year": y,
            "bm_mean": df[f"band_{b_rad}_mean"], "bm_sum": df[f"band_{b_rad}_sum"],
            "bm_lit_frac": df[f"band_{b_lit}_mean"], "bm_valid_frac": df[f"band_{b_val}_mean"]}))
    res = pd.concat(rows, ignore_index=True)
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
