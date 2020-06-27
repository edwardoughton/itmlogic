import pytest
from itmlogic.avar import avar

def test_avar(
    setup_prop_to_test_avar,
    setup_prop_to_test_avar_uarea,
    ):
    """
    Test the statistics generating function avar which finds the quantiles of attenuation.

    The imported setup parameters are imported from tests/conftest.py via the fixture
    setup_prop_to_test_avar.

    The first test is derived from the original test for Longley-Rice between for Crystal
    Palace (South London) to Mursley, England.

    The 'actual_answer' variable is the avar1 metric which corresponds to the additional
    attenuation from the median given user defined quantiles in time, location, and
    situation (Section 5 of "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm").

    """
    actual_answer, actual_prop = avar(
        1.2817, 0, 1.2817,
        setup_prop_to_test_avar
        )

    expected_answer = 20.877472366318642

    assert actual_answer == expected_answer

    actual_answer, actual_prop = avar(
        0, 0, 0,
        setup_prop_to_test_avar_uarea
        )

    expected_answer = 33.44778607772954

    assert actual_answer == expected_answer
