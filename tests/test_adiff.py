import pytest
from itmlogic.adiff import adiff

def test_adiff(
    setup_prop_to_test_adiff,
    setup_expected_answer_for_adiff):
    """
    The function adiff finds the 'diffraction attenuation' at the distance d, using a convex
    combination of smooth earth diffraction and double knife-edge diffraction. A call with
    d = 0 sets up initial constants.

    Both the imported setup parameters and the expected parameter answers are imported from
    tests/conftest.py via the fixtures setup_prop_to_test_adiff and
    setup_expected_answer_for_adiff respectively.

    Both the imported setup parameters and the expected parameter answers have been taken
    from the original test for Longley-Rice between for Crystal Palace (South London) to
    Mursley, England.

    """
    q, actual_answer = adiff(0, setup_prop_to_test_adiff)

    expected_answer = setup_expected_answer_for_adiff

    assert actual_answer['wd1'] == expected_answer['wd1']
    assert actual_answer['xd1'] == expected_answer['xd1']
    assert actual_answer['afo'] == expected_answer['afo']
    assert actual_answer['qk'] == expected_answer['qk']
    assert actual_answer['aht'] == expected_answer['aht']
    assert actual_answer['xht'] == expected_answer['xht']
