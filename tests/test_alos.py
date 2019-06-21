import pytest
from itmlogic.alos import alos

def test_alos(setup_prop_to_test_alos):

    actual_answer = alos(
        7349.240030948456, 
        setup_prop_to_test_alos
        )

    expected_answer = 1.5025512186783523

    assert actual_answer == expected_answer




    