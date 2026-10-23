from lgu.ee_zonal import name_outputs


def test_one_year_population_band_named_after_the_band_not_the_reducer():
    # One WorldPop band: Earth Engine names the reduced column after the reducer ("sum").
    props = {"adm3_pcode": "PH0102801000", "sum": 1234.5}
    assert name_outputs(props, ["pop_2020"], "sum") == {"adm3_pcode": "PH0102801000", "pop_2020": 1234.5}


def test_many_years_keep_their_band_names():
    props = {"adm3_pcode": "X", "pop_2019": 1.0, "pop_2020": 2.0}
    assert name_outputs(props, ["pop_2019", "pop_2020"], "sum") == props


def test_single_band_already_named_is_left_alone():
    props = {"adm3_pcode": "X", "pop_2020": 3.0}
    assert name_outputs(props, ["pop_2020"], "sum") == props
