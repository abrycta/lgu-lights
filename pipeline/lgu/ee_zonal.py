"""Earth Engine zonal statistics per LGU and year (project `lgu-lights`, service account), run in Actions.

Nothing is downloaded: polygons are sent in chunks and `reduceRegions` returns one row per LGU.
  * modis-mod13q1: yearly mean NDVI and EVI of 16-day composites with SummaryQA 0-1 (good, marginal),
    250 m, area-weighted mean.
  * worldpop-phl-100m: population sum per LGU, 2012-2020 (WorldPop GP 100 m ends in 2020; later years are
    carried forward and flagged `pop_carried`).
  * srtm-dem: mean elevation and mean slope (static).

Credentials: EE_SERVICE_ACCOUNT_KEY (JSON) in CI; locally the hex-encoded Keychain item earth-engine-sa-key.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import logging
import os
import subprocess
import time
from pathlib import Path

log = logging.getLogger("lgu.ee")
PROJECT = "lgu-lights"
MODIS = "MODIS/061/MOD13Q1"
WORLDPOP = "WorldPop/GP/100m/pop"
DEM = "USGS/SRTMGL1_003"
SIMPLIFY_DEG = 0.0005      # about 55 m, a fifth of a MODIS pixel; requests stay well under the 10 MB limit
CHUNK_VERTICES = 120_000


def init() -> None:
    import ee

    key = os.environ.get("EE_SERVICE_ACCOUNT_KEY")
    if not key:
        hexkey = subprocess.run(["security", "find-generic-password", "-s", "earth-engine-sa-key", "-w"],
                                capture_output=True, text=True, check=True).stdout.strip()
        key = bytes.fromhex(hexkey).decode()
    email = json.loads(key)["client_email"]
    ee.Initialize(ee.ServiceAccountCredentials(email, key_data=key), project=PROJECT)


def _chunks(gdf):  # type: ignore[no-untyped-def]
    import shapely

    batch, n = [], 0
    for row in gdf.itertuples():
        v = int(shapely.get_num_coordinates(row.geometry))
        if batch and n + v > CHUNK_VERTICES:
            yield batch
            batch, n = [], 0
        batch.append(row)
        n += v
    if batch:
        yield batch


def _fc(rows):  # type: ignore[no-untyped-def]
    import ee
    from shapely.geometry import mapping

    return ee.FeatureCollection([ee.Feature(ee.Geometry(mapping(r.geometry), geodesic=False),
                                            {"adm3_pcode": r.adm3_pcode}) for r in rows])


def _reduce(image, rows, reducer, scale: float) -> list[dict]:  # type: ignore[no-untyped-def]
    for attempt in range(5):
        try:
            res = image.reduceRegions(collection=_fc(rows), reducer=reducer, scale=scale, tileScale=4).getInfo()
            return [f["properties"] for f in res["features"]]
        except Exception as e:  # noqa: BLE001 - EE raises EEException / HttpError / timeouts
            log.warning("reduceRegions attempt %d failed: %s", attempt + 1, str(e)[:200])
            time.sleep(10 * 2**attempt)
    raise RuntimeError("Earth Engine reduceRegions failed 5 times")


def images(years: list[int]):  # type: ignore[no-untyped-def]
    import ee

    def vi(y: int):  # type: ignore[no-untyped-def]
        col = ee.ImageCollection(MODIS).filterDate(f"{y}-01-01", f"{y + 1}-01-01")
        good = col.map(lambda im: im.select(["NDVI", "EVI"]).multiply(0.0001)
                       .updateMask(im.select("SummaryQA").lte(1)))
        return good.mean().rename([f"ndvi_{y}", f"evi_{y}"])

    veg = ee.Image.cat([vi(y) for y in years])
    pop_years = sorted({min(y, 2020) for y in years})  # WorldPop GP ends in 2020
    wp = ee.ImageCollection(WORLDPOP).filter(ee.Filter.eq("country", "PHL"))
    pop = ee.Image.cat([wp.filter(ee.Filter.eq("year", y)).first().rename(f"pop_{y}") for y in pop_years])
    dem = ee.Image(DEM).select("elevation")
    terrain = ee.Image.cat([dem.rename("elev"), ee.Terrain.slope(dem).rename("slope")])
    return veg, pop, terrain, pop_years


def zonal(adm3_path: Path, years: list[int], out: Path) -> Path:
    import ee
    import geopandas as gpd
    import pandas as pd

    init()
    gdf = gpd.read_parquet(adm3_path)[["adm3_pcode", "geometry"]]
    gdf["geometry"] = gdf.geometry.simplify(SIMPLIFY_DEG, preserve_topology=True)
    veg, pop, terrain, pop_years = images(years)
    recs: dict[str, dict] = {}
    t0 = time.time()
    jobs = []
    for rows in _chunks(gdf):
        jobs.append((veg.addBands(terrain), rows, ee.Reducer.mean(), 250))
        jobs.append((pop, rows, ee.Reducer.sum(), 100))
    with cf.ThreadPoolExecutor(len(jobs)) as ex:  # interactive requests run concurrently on EE's side
        for props_list in ex.map(lambda j: _reduce(*j), jobs):
            for props in props_list:
                recs.setdefault(props["adm3_pcode"], {}).update(props)
    log.info("Earth Engine: %d requests done in %.0f s", len(jobs), time.time() - t0)
    long = []
    for pcode, p in recs.items():
        for y in years:
            py = min(y, 2020)
            long.append({"adm3_pcode": pcode, "year": y, "ndvi_mean": p.get(f"ndvi_{y}"), "evi_mean": p.get(f"evi_{y}"),
                         "pop": p.get(f"pop_{py}"), "pop_carried": y not in pop_years,
                         "elev_mean": p.get("elev"), "slope_mean": p.get("slope")})
    df = pd.DataFrame(long)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out, index=False)
    log.info("Earth Engine zonal statistics: %d rows in %.0f s", len(df), time.time() - t0)
    return out
