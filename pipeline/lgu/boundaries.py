"""HDX COD-AB v03 geodatabase -> the analysis vintage (spike S2).

Outputs (data/interim/):
  * adm3.parquet: GeoParquet, full-resolution ADM3 polygons (EPSG:4326) with pcode, PSGC-10, names,
    province and region; the input for zonal statistics (exactextract, Earth Engine).
  * lgus.parquet: the same attributes without geometry, plus centroid and area (the LGU registry).
  * tiles/adm3.geojsonl, tiles/adm2.geojsonl: newline-delimited GeoJSON for tippecanoe (geometry once
    per boundary vintage; attributes are joined per data version, spike S1).
"""
from __future__ import annotations

import json
import zipfile
from pathlib import Path

GDB_LAYERS = {"adm3": "phl_admin3", "adm2": "phl_admin2", "adm1": "phl_admin1"}


def _gdb(zip_path: Path) -> str:
    with zipfile.ZipFile(zip_path) as z:
        name = next(n.split("/")[0] for n in z.namelist() if n.split("/")[0].endswith(".gdb"))
    return f"/vsizip/{zip_path}/{name}"


def lgu_class(name: str) -> str:
    n = name.lower()
    if "special geographic area" in n:
        return "sga"
    return "city" if (n.startswith("city of") or " city" in n) else "municipality"


def build(gdb_zip: Path, out_dir: Path) -> dict:
    import geopandas as gpd
    import pyogrio

    src = _gdb(gdb_zip)
    out_dir.mkdir(parents=True, exist_ok=True)
    a3 = pyogrio.read_dataframe(src, layer=GDB_LAYERS["adm3"],
                                columns=["adm3_name", "adm3_pcode", "adm2_name", "adm2_pcode", "adm1_name",
                                         "adm1_pcode", "valid_on", "version"])
    a3 = a3.to_crs("EPSG:4326")
    a3["geometry"] = a3.geometry.make_valid()
    a3["psgc10"] = a3.adm3_pcode.str[2:] + "000"
    a3["lgu_class"] = a3.adm3_name.map(lgu_class)
    eq = a3.to_crs("EPSG:6933")  # equal-area for km2
    a3["area_km2"] = (eq.geometry.area / 1e6).round(3)
    rp = a3.geometry.representative_point()
    a3["lon"], a3["lat"] = rp.x.round(5), rp.y.round(5)
    a3["valid_on"] = a3.valid_on.astype(str)
    a3 = a3.sort_values("adm3_pcode").reset_index(drop=True)
    a3.to_parquet(out_dir / "adm3.parquet", index=False)
    a3.drop(columns="geometry").to_parquet(out_dir / "lgus.parquet", index=False)

    tiles = out_dir / "tiles"
    tiles.mkdir(exist_ok=True)
    _geojsonl(a3[["adm3_pcode", "geometry"]].rename(columns={"adm3_pcode": "pcode"}), tiles / "adm3.geojsonl")
    a2 = pyogrio.read_dataframe(src, layer=GDB_LAYERS["adm2"], columns=["adm2_name", "adm2_pcode", "adm1_pcode"])
    a2 = a2.to_crs("EPSG:4326")
    a2["geometry"] = a2.geometry.make_valid()
    _geojsonl(a2[["adm2_pcode", "adm2_name", "geometry"]].rename(columns={"adm2_pcode": "pcode", "adm2_name": "name"}),
              tiles / "adm2.geojsonl")
    a2c = a2.copy()
    rp2 = a2c.geometry.representative_point()
    provinces = [{"pcode": r.adm2_pcode, "name": r.adm2_name, "region": r.adm1_pcode,
                  "bbox": [round(v, 4) for v in g.bounds], "lon": round(p.x, 4), "lat": round(p.y, 4)}
                 for r, g, p in zip(a2c.itertuples(), a2c.geometry, rp2)]
    (out_dir / "provinces.json").write_text(json.dumps(provinces, ensure_ascii=False))
    return {"adm3": len(a3), "adm2": len(a2), "vertices": int(a3.geometry.count_coordinates().sum()),
            "valid_on": sorted(set(a3.valid_on)), "version": sorted(set(a3.version))}


def _geojsonl(gdf, path: Path) -> None:  # type: ignore[no-untyped-def]
    from shapely.geometry import mapping

    with open(path, "w", encoding="utf-8") as f:
        for row in gdf.itertuples(index=False):
            props = {k: getattr(row, k) for k in gdf.columns if k != "geometry"}
            f.write(json.dumps({"type": "Feature", "id": int(props["pcode"][2:]),
                                "properties": props, "geometry": mapping(row.geometry)}, ensure_ascii=False) + "\n")
