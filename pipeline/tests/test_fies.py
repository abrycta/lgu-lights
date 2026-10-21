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
