"""Province names in PSA's FIES tables -> HDX ADM2 pcodes (footnotes, aliases, split provinces)."""
import numpy as np
import pandas as pd

from lgu import fies

ADM2 = pd.DataFrame({"adm2_pcode": ["PH14001", "PH19087", "PH19088", "PH19066"],
                     "adm2_name": ["Abra", "Maguindanao del Norte", "Maguindanao del Sur", "Sulu"]})


def test_footnotes_and_split_provinces_map_to_adm2():
    df = pd.DataFrame({"name": ["Abra 2/, c/", "Sulu r1, 1/, 2/", "Maguindanao 1/", "Maguindanao del Norte",
                                "Maguindanao 1/", "Region I (Ilocos Region) 1/", "City of Cebu 1/, a/"],
                       "depth": [4, 4, 4, 4, 4, 2, 4], "year": [2023, 2023, 2023, 2023, 2021, 2023, 2023],
                       "pi": [13.7, 20.7, 41.0, 40.3, 38.0, 9.0, 5.0]})
    out = fies.to_provinces(df, ADM2).set_index(["adm2_pcode", "round_year"]).pi
    assert out[("PH14001", 2023)] == 13.7 and out[("PH19066", 2023)] == 20.7
    assert out[("PH19087", 2023)] == 40.3  # the specific half wins over the combined province
    assert out[("PH19088", 2023)] == 41.0 and out[("PH19088", 2021)] == 38.0
    assert len(out) == 6 and not np.isnan(out).any()  # regions and HUCs are not provinces


# ------------------------------------------------------------------ chaos: table shape (audit L-C8)
import json

import pytest


def jsonstat(tmp_path, order=("Geolocation", "Item", "Year"), pi=(13.7, 20.7)):
    """A two-province JSON-stat 1.0 table with its dimensions in `order`."""
    cats = {"Geolocation": ["..Region I", "....Abra 2/", "....Sulu"],
            "Item": ["Annual Per Capita Poverty Threshold (in PhP)", "Poverty Incidence among Population (%)"],
            "Year": ["2021", "2023"]}
    def val(g, i, y):
        return float(y) if i == 0 else [9.0, pi[0], pi[1]][g] + y
    dims = {k: {"label": k, "category": {"index": {str(j): j for j in range(len(v))},
                                         "label": {str(j): x for j, x in enumerate(v)}}} for k, v in cats.items()}
    size = [len(cats[k]) for k in order]
    idx = np.indices(size).reshape(len(order), -1).T
    values = [val(*(int(ix[order.index(k)]) for k in ("Geolocation", "Item", "Year"))) for ix in idx]
    d = {"dataset": {"dimension": {"id": list(order), "size": size, **dims}, "value": values}}
    p = tmp_path / "t.json"
    p.write_text(json.dumps(d))
    return p


def test_reordered_dimensions_read_the_same(tmp_path):
    a = fies.read_jsonstat(jsonstat(tmp_path)).sort_values(["name", "year"]).reset_index(drop=True)
    b = fies.read_jsonstat(jsonstat(tmp_path, order=("Year", "Geolocation", "Item"))).sort_values(["name", "year"])
    pd.testing.assert_frame_equal(a, b.reset_index(drop=True))
    assert a[(a.name == "Abra 2/") & (a.year == 2023)].pi.item() == 13.7 + 1


def test_out_of_range_incidence_is_a_schema_error(tmp_path):
    with pytest.raises(fies.SchemaError):
        fies.read_jsonstat(jsonstat(tmp_path, pi=(13.7, 250.0)))


def test_gate_flags_new_unmapped_names_and_thin_rounds():
    committed = {"per_round": {"2023": 87}, "unmapped_names": ["City of Cebu 1/, a/"]}
    assert fies.gate_report({"per_round": {"2023": 87}, "unmapped_names": ["City of Cebu 2/"]}, committed) == []
    problems = fies.gate_report({"per_round": {"2023": 79}, "unmapped_names": ["Maguindanao del Centro"]}, committed)
    assert any("79 provinces" in p for p in problems) and any("Maguindanao del Centro" in p for p in problems)
