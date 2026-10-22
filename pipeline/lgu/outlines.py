"""Simplified boundaries for the web's /embed (web/scripts/build-embed.mjs draws them as SVG).

One newline GeoJSON file, `outlines.geojsonl`: every ADM3 place (properties {"pcode", "level": 3}) and every
province (ADM2, {"pcode", "level": 2}), in EPSG:4326 with 5 decimals (about 1 m).

The places are simplified as one coverage (shapely.coverage_simplify), so neighbours keep exactly the same
shared edge (no slivers or gaps between them), and each province is the union of its simplified places, so
province lines lie exactly on place edges. coverage_simplify is Visvalingam–Whyatt: TOLERANCE (degrees, about
35 m) is the square root of the smallest triangle area it keeps, well under a CSS pixel in the embed's smallest
province view (a province about 40 km across in a 360 px wide phone frame). The web build simplifies further per view.
"""
from __future__ import annotations

import json
from pathlib import Path

TOLERANCE = 0.0003
DECIMALS = 5


def build(adm3_parquet: Path, out: Path, tolerance: float = TOLERANCE) -> dict:
    import pyarrow.parquet as pq
    import shapely

    t = pq.read_table(adm3_parquet, columns=["adm3_pcode", "adm2_pcode", "geometry"]).to_pydict()
    order = sorted(range(len(t["adm3_pcode"])), key=lambda i: t["adm3_pcode"][i])
    pcodes = [t["adm3_pcode"][i] for i in order]
    provinces = [t["adm2_pcode"][i] for i in order]
    # Polygons only (make_valid may leave stray lines or points), then one simplified coverage.
    geoms = [_polygonal(g) for g in shapely.make_valid(shapely.from_wkb([t["geometry"][i] for i in order]))]
    simple = shapely.set_precision(shapely.coverage_simplify(geoms, tolerance, simplify_boundary=True),
                                   10 ** -DECIMALS, mode="pointwise")
    groups: dict[str, list] = {}
    for pv, g in zip(provinces, simple):
        groups.setdefault(pv, []).append(g)
    a2 = {pv: shapely.set_precision(shapely.union_all(gs), 10 ** -DECIMALS, mode="pointwise")
          for pv, gs in sorted(groups.items())}
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        for level, items in ((3, zip(pcodes, simple)), (2, a2.items())):
            for pcode, g in items:
                if g is None or g.is_empty:
                    continue
                f.write(json.dumps({"type": "Feature", "properties": {"pcode": pcode, "level": level},
                                    "geometry": _rounded(shapely.geometry.mapping(g))}, separators=(",", ":")) + "\n")
    return {"adm3": len(pcodes), "adm2": len(a2), "tolerance": tolerance,
            "vertices": int(shapely.get_num_coordinates(simple).sum()), "bytes": out.stat().st_size}


def _polygonal(g):  # type: ignore[no-untyped-def]
    import shapely
    from shapely.geometry import MultiPolygon

    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    parts = [p for p in getattr(g, "geoms", []) if p.geom_type in ("Polygon", "MultiPolygon")]
    return shapely.union_all(parts) if parts else MultiPolygon()


def _rounded(geo: dict) -> dict:
    def r(c):  # type: ignore[no-untyped-def]
        return [round(c[0], DECIMALS), round(c[1], DECIMALS)] if isinstance(c[0], float) else [r(x) for x in c]

    return {"type": geo["type"], "coordinates": r(geo["coordinates"])}
