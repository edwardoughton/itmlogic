import pytest
from itmlogic.alos import alos

def test_alos(setup_prop_to_test_alos):
    """
    Test the 'line-of-sight attenuation' at the distance d using a combination of plane
    earth fields and directed fields.

    The setup parameters are imported from tests/conftest.py via the fixture
    setup_prop_to_test_alos.

    The inputs and expected answer are based on an original test for Longley-Rice between
    for Crystal Palace (South London) to Mursley, England (See Stark, 1967).

    """
    actual_answer = alos(
        7349.240030948456,
        setup_prop_to_test_alos
        )

    expected_answer = 1.5025512186783523

    assert actual_answer == expected_answer
