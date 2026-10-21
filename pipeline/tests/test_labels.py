"""Crosswalk rules that decide which PSA row becomes which LGU's label."""
import pandas as pd

from lgu import labels


def test_norm_and_same_name_tolerate_psa_spellings():
    assert labels.norm("City of Ozamiz") == labels.norm("Ozamiz City")
    assert labels._ratio("Possorubio", "Pozorrubio") >= 0.75  # rule matches accept typos at 0.75
    assert labels.same_name("Santa Cruz", "Sta. Cruz")
    assert not labels.same_name("Sampaloc", "San Pablo")


def test_rematch_prefers_province_then_region_and_refuses_ambiguity():
    adm3 = pd.DataFrame({"adm3_pcode": ["PH1606701", "PH1608505", "PH1600305"],
                         "adm3_name": ["Alegria", "Loreto", "Loreto"]})
    # code points at Surigao del Norte (PH16067); the name exists twice elsewhere in the region -> no match
    assert labels._rematch("Loreto", "PH1606718", adm3) is None
    assert labels._rematch("Loreto", "PH1608501", adm3) == "PH1608505"  # same province wins


def test_region_guard_allows_armm_to_barmm_only():
    assert labels._region_ok("153811", "PH1908711")
    assert not labels._region_ok("133906", "PH0405639")
