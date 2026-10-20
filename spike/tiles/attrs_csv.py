"""Spike: dump the synthetic per-year properties of data/hdx_full.geojsonl to CSVs for tile-join.
   out/attrs_all.csv  : psgc + 84 slots (p,l,h,t,s,r × 14 years)
   out/attrs_pts.csv  : psgc + 42 slots (p,t,s × 14 years)  -- what the choropleth/extrusion/hatching needs
   out/attrs_all.json : {id: [84 numbers]} for the feature-state variant (tiles carry ids only)
"""
import csv, json, pathlib, sys
D = pathlib.Path(__file__).resolve().parent
rows = []
with open(D / "data" / "hdx_full.geojsonl") as f:
    for line in f:
        rows.append(json.loads(line)["properties"])
keys = [k for k in rows[0] if k[0] in "plhtsr" and k[1:].isdigit()]
pts = [k for k in keys if k[0] in "pts"]
(D / "out").mkdir(exist_ok=True)
for name, ks in (("attrs_all", keys), ("attrs_pts", pts)):
    with open(D / "out" / f"{name}.csv", "w", newline="") as f:
        w = csv.writer(f); w.writerow(["psgc"] + ks)
        for r in rows: w.writerow([r["psgc"]] + [r[k] for k in ks])
json.dump({"keys": keys, "rows": {r["psgc"]: [r[k] for k in keys] for r in rows}}, open(D / "out" / "attrs_all.json", "w"), separators=(",", ":"))
print(len(rows), len(keys), len(pts), file=sys.stderr)
