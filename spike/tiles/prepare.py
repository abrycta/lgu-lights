"""Spike: harmonise geoBoundaries PHL ADM3 (pinned 9469f09) to PSGC via HDX COD-AB v03, and attach
synthetic per-year property slots for the PMTiles size test.

Run from spike/python:  uv run --group geo python -I ../tiles/prepare.py
Inputs (gitignored):  ../tiles/data/gb/geoBoundaries-PHL-ADM3.geojson, ../tiles/data/hdx/phl_admin_boundaries.gdb.zip
Outputs (gitignored): ../tiles/data/{gb,hdx}_full.geojsonl and {gb,hdx}_full_minimal.geojsonl (geometry + ids only);  ../tiles/harmonise_report.json (committed)
"""

import json
import pathlib
import sys
import time

import numpy as np
import geopandas as gpd
import pyogrio

D = pathlib.Path(__file__).resolve().parent / "data"
YEARS = list(range(2012, 2026))  # 14 years
t0 = time.time()

gb = pyogrio.read_dataframe(D / "gb" / "geoBoundaries-PHL-ADM3.geojson")
hdx = pyogrio.read_dataframe(D / "hdx" / "phl_admin_boundaries.gdb.zip", layer="phl_admin3")
print(f"read gb={len(gb)} hdx={len(hdx)} in {time.time() - t0:.1f}s", file=sys.stderr)

# HDX v03 pcodes are 'PH' + 7 digits (region 2, province 3, municipality 2); the 10-digit PSGC appends barangay '000'.
assert hdx.adm3_pcode.str.fullmatch(r"PH\d{7}").all()
hdx["psgc"] = hdx.adm3_pcode.str[2:] + "000"

# Spatial join: a guaranteed-interior point of each geoBoundaries polygon -> the HDX polygon containing it.
pts = gb.copy()
pts["geometry"] = gb.geometry.representative_point()
j = gpd.sjoin(pts, hdx[["psgc", "adm3_name", "adm2_name", "geometry"]], how="left", predicate="within")
dup_gb = j.index[j.index.duplicated()].unique()
j = j[~j.index.duplicated()]
gb = gb.join(j[["psgc", "adm3_name", "adm2_name"]])

# Area agreement (equal-area CRS) between matched pairs; name agreement.
ea = "EPSG:6933"
gb_area = gb.to_crs(ea).area / 1e6
hdx_area = hdx.set_index("psgc").to_crs(ea).area / 1e6
ratio = gb_area / gb.psgc.map(hdx_area)
name_eq = (gb.shapeName.str.casefold().str.strip() == gb.adm3_name.str.casefold().str.strip())
psgc_counts = gb.psgc.value_counts()
report = {
    "date": time.strftime("%Y-%m-%d"),
    "geoboundaries": {"commit": "9469f09", "features": int(len(gb)), "boundaryYearRepresented": "2020"},
    "hdx_cod_ab": {"version": "v03", "valid_on": str(hdx.valid_on.iloc[0])[:10], "adm3_features": int(len(hdx))},
    "gb_unmatched": gb[gb.psgc.isna()].shapeName.tolist(),
    "gb_points_in_two_hdx_polygons": int(len(dup_gb)),
    "psgc_hit_by_more_than_one_gb_feature": {k: gb[gb.psgc == k].shapeName.tolist() for k in psgc_counts[psgc_counts > 1].index},
    "hdx_psgc_without_gb_feature": hdx[~hdx.psgc.isin(gb.psgc)][["psgc", "adm3_name", "adm2_name"]].values.tolist(),
    "name_exact_match_share": round(float(name_eq.mean()), 4),
    "area_ratio_gb_over_hdx": {
        "median": round(float(ratio.median()), 4),
        "p05": round(float(ratio.quantile(0.05)), 4),
        "p95": round(float(ratio.quantile(0.95)), 4),
        "n_outside_0.9_1.1": int(((ratio < 0.9) | (ratio > 1.1)).sum()),
    },
    "vertices": {
        "gb": int(gb.geometry.count_coordinates().sum()),
        "hdx": int(hdx.geometry.count_coordinates().sum()),
    },
}
(D.parent / "harmonise_report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False))
print(json.dumps({k: v for k, v in report.items() if k != "psgc_hit_by_more_than_one_gb_feature"}, indent=1, ensure_ascii=False)[:3000], file=sys.stderr)

# Synthetic per-year slots: what the map needs per year.
#   p<YY>  poverty incidence %, 0.1 precision          (choropleth + extrusion height)
#   l<YY>, h<YY> interval bounds %, 0.1 precision     (tooltip / hatch threshold)
#   t<YY>  reliability tier 0/1/2                      (fill-pattern hatching)
#   s<YY>  source 0 = PSA official, 1 = model estimate (dashed outline)
#   r<YY>  mean radiance nW, 0.01 precision            (lights layer)
def write(df, names, provs, psgcs, stem):
    rng = np.random.default_rng(7)
    n = len(df)
    base = rng.uniform(2, 60, n)
    props = {}
    for k, y in enumerate(YEARS):
        yy = f"{y % 100:02d}"
        p = np.clip(base * (1 - 0.02 * k) + rng.normal(0, 2, n), 0.1, 90).round(1)
        w = rng.uniform(1, 12, n).round(1)
        props[f"p{yy}"] = p
        props[f"l{yy}"] = np.clip(p - w, 0, 100).round(1)
        props[f"h{yy}"] = np.clip(p + w, 0, 100).round(1)
        props[f"t{yy}"] = rng.integers(0, 3, n)
        props[f"s{yy}"] = (0 if y in (2012, 2015, 2018, 2021, 2023) else 1) * np.ones(n, int)
        props[f"r{yy}"] = rng.lognormal(0, 1.2, n).round(2)
    geo = json.loads(df[["geometry"]].to_json(drop_id=True))["features"]
    with open(D / f"{stem}.geojsonl", "w") as f, open(D / f"{stem}_minimal.geojsonl", "w") as fm:
        for i, feat in enumerate(geo):
            pid = psgcs.iloc[i]
            base_p = {"id": int(pid) if isinstance(pid, str) else int(9_000_000_000 + i),
                      "psgc": pid if isinstance(pid, str) else None, "name": names.iloc[i], "prov": provs.iloc[i]}
            fm.write(json.dumps({"type": "Feature", "properties": base_p, "geometry": feat["geometry"]}) + "\n")
            p = dict(base_p)
            for key, arr in props.items():
                v = arr[i]
                p[key] = int(v) if key[0] in "ts" else float(v)
            f.write(json.dumps({"type": "Feature", "properties": p, "geometry": feat["geometry"]}) + "\n")
    print(f"{stem}: wrote {n} features with {len(props)} per-year slots at {time.time() - t0:.1f}s", file=sys.stderr)


write(gb, gb.shapeName, gb.adm2_name, gb.psgc, "gb_full")
write(hdx, hdx.adm3_name, hdx.adm2_name, hdx.psgc, "hdx_full")
