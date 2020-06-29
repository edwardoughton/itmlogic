import pytest
from itmlogic.lrprop import lrprop

def test_lrprop(
    setup_prop_to_test_lrprop,
    setup_expected_prop_to_test_lrprop,
    setup_prop_to_test_lrprop_2,
    setup_prop_to_test_lrprop_uarea,
    setup_expected_prop_to_test_lrprop_uarea
    ):
    """
    Test the basic Longley-Rice propagation program which returns the reference
    attenuation (aref) as in Eqn 4.1 of "The ITS Irregular Terrain Model,
    version 1.2.2: The Algorithm".

    The test variants are derived from the original test for Longley-Rice between
    for Crystal Palace (South London) to Mursley, England (See Stark, 1967).

    """
    actual_prop = lrprop(0, setup_prop_to_test_lrprop)

    expected_prop = setup_expected_prop_to_test_lrprop

    assert actual_prop['hg'] == pytest.approx(expected_prop['hg'])
    assert actual_prop['kwx'] == pytest.approx(expected_prop['kwx'])
    assert actual_prop['ael'] == pytest.approx(expected_prop['ael'])
    assert actual_prop['aref'] == pytest.approx(expected_prop['aref'])

    actual_prop = lrprop(0, setup_prop_to_test_lrprop_2)

    assert round(actual_prop['aref'], 2) == 35.42
    assert round(actual_prop['etq'], 2) == -0.14
    assert round(actual_prop['dx'], 2) ==162911.96
    assert round(actual_prop['aes'], 2) == 44.14

    actual_prop = lrprop(10000, setup_prop_to_test_lrprop_uarea)

    expected_prop = setup_expected_prop_to_test_lrprop_uarea

    assert actual_prop['hg'] == pytest.approx(expected_prop['hg'])
    assert actual_prop['kwx'] == pytest.approx(expected_prop['kwx'])
    assert actual_prop['ael'] == pytest.approx(expected_prop['ael'])
    assert actual_prop['aref'] == pytest.approx(expected_prop['aref'])
