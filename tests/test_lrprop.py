import pytest
from itmlogic.lrprop import lrprop

def test_lrprop(
    setup_prop_to_test_lrprop,
    setup_expected_prop_to_test_lrprop,
    setup_prop_to_test_lrprop_2,
    setup_prop_to_test_lrprop_uarea,
    setup_expected_prop_to_test_lrprop_uarea
    ):

    actual_prop = lrprop(0, setup_prop_to_test_lrprop)

    expected_prop = setup_expected_prop_to_test_lrprop

    assert actual_prop['hg'] == pytest.approx(expected_prop['hg'])
    assert actual_prop['kwx'] == pytest.approx(expected_prop['kwx'])
    assert actual_prop['ael'] == pytest.approx(expected_prop['ael'])
    assert actual_prop['aref'] == pytest.approx(expected_prop['aref'])

    actual_prop = lrprop(0, setup_prop_to_test_lrprop_2)

    assert round(actual_prop['aref'], 2) == 35.42

    actual_prop = lrprop(10000, setup_prop_to_test_lrprop_uarea)

    expected_prop = setup_expected_prop_to_test_lrprop_uarea

    assert actual_prop['hg'] == pytest.approx(expected_prop['hg'])
    assert actual_prop['kwx'] == pytest.approx(expected_prop['kwx'])
    assert actual_prop['ael'] == pytest.approx(expected_prop['ael'])
    assert actual_prop['aref'] == pytest.approx(expected_prop['aref'])
