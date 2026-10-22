"""lgu.outlines: the simplified coverage keeps neighbours' shared edges and provinces on place edges."""
from __future__ import annotations

import json

import pyarrow as pa
import pyarrow.parquet as pq
import shapely
from shapely.geometry import Polygon

from lgu import outlines


def _wiggly(x0: float, x1: float) -> Polygon:
    # A unit-high strip whose right edge wiggles (below the tolerance), shared with the next strip's left edge.
    right = [(x1 + (0.0001 if i % 2 else 0), i / 10) for i in range(11)]
    left = [(x0 + (0.0001 if i % 2 else 0), i / 10) for i in range(10, -1, -1)]
    return Polygon(right + left)


def test_shared_edges_and_provinces(tmp_path):
    pq.write_table(pa.table({
        "adm3_pcode": ["PH0100102", "PH0100101", "PH0200101"], "adm2_pcode": ["PH01001", "PH01001", "PH02001"],
        "geometry": [shapely.to_wkb(g) for g in (_wiggly(1, 2), _wiggly(0, 1), _wiggly(2, 3))],
    }), tmp_path / "adm3.parquet")
    rep = outlines.build(tmp_path / "adm3.parquet", tmp_path / "outlines.geojsonl", tolerance=0.01)
    assert (rep["adm3"], rep["adm2"]) == (3, 2)
    rows = [json.loads(line) for line in (tmp_path / "outlines.geojsonl").read_text().splitlines()]
    shapes = {(r["properties"]["level"], r["properties"]["pcode"]): shapely.geometry.shape(r["geometry"]) for r in rows}
    a, b, c = (shapes[(3, p)] for p in ("PH0100101", "PH0100102", "PH0200101"))
    # Simplified (the wiggles are gone), and still a coverage: no overlap, no gap between neighbours.
    assert len(a.exterior.coords) < 8
    assert a.intersection(b).area < 1e-12 and b.intersection(c).area < 1e-12
    assert abs(shapely.union_all([a, b, c]).area - (a.area + b.area + c.area)) < 1e-9
    assert a.boundary.intersection(b.boundary).length > 0.99
    # The province is the union of its places.
    assert shapes[(2, "PH01001")].symmetric_difference(shapely.union_all([a, b])).area < 1e-9
