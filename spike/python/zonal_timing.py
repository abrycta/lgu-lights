"""Spike: time exactextract over the 1,642 HDX ADM3 polygons on the exact NASA Black Marble VNP46A4 grid
(15 arc-second, tiles h29-h30 x v06-v08 = lon 110-130, lat 0-30, 4800 x 7200 float32).

Values are synthetic (lognormal radiance): real VNP46A4 tiles need an Earthdata login (LAADS answers 303 to the
licence/login page), and EOG VIIRS annual needs a paid/registered account for programmatic access. Compute cost of
zonal statistics depends on the grid and the polygons, not on the pixel values, so the timing transfers.
Run: uv run --group geo python -I zonal_timing.py
"""
import json, pathlib, time
import numpy as np, rasterio, pyogrio
from rasterio.transform import from_origin
from exactextract import exact_extract

root = pathlib.Path(__file__).resolve().parent.parent
tif = root / "tiles" / "out" / "synthetic_vnp46a4_grid.tif"
res = 1 / 240
w, h = int(20 / res), int(30 / res)
if not tif.exists():
    rng = np.random.default_rng(1)
    with rasterio.open(tif, "w", driver="GTiff", width=w, height=h, count=1, dtype="float32", crs="EPSG:4326",
                       transform=from_origin(110, 30, res, res), tiled=True, blockxsize=512, blockysize=512, compress="deflate", nodata=-999) as d:
        for y0 in range(0, h, 1200):
            d.write(rng.lognormal(0, 1.5, (1200, w)).astype("float32"), 1, window=rasterio.windows.Window(0, y0, w, 1200))
t0 = time.time()
polys = pyogrio.read_dataframe(root / "tiles/data/hdx/phl_admin_boundaries.gdb.zip", layer="phl_admin3", columns=["adm3_pcode"])
t_read = time.time() - t0
out = {"date": time.strftime("%Y-%m-%d"), "grid": f"{w}x{h} float32 @ 15 arc-sec", "polygons": len(polys),
       "vertices_full": int(polys.geometry.count_coordinates().sum()), "read_polygons_s": round(t_read, 1)}
ops = ["mean", "sum", "count", "max", "stdev"]
for label, g in (("full", polys), ("simplified_0.001deg", polys.assign(geometry=polys.geometry.simplify(0.001)))):
    t = time.time()
    df = exact_extract(str(tif), g, ops, include_cols=["adm3_pcode"], output="pandas")
    out[f"exactextract_{label}_s"] = round(time.time() - t, 2)
    out[f"vertices_{label}"] = int(g.geometry.count_coordinates().sum())
    out[f"rows_{label}"] = len(df)
    if label == "full": full = df.set_index("adm3_pcode")
    else: out["max_rel_diff_mean_simplified_vs_full"] = float((df.set_index("adm3_pcode")["mean"] / full["mean"] - 1).abs().max())
print(json.dumps(out, indent=1))
(root / "python" / "zonal_timing_result.json").write_text(json.dumps(out, indent=1))
