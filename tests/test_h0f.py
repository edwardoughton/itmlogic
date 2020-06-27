import pytest
from itmlogic.h0f import h0f

def test_h0f():
    """
    Tests the routine for computing the H01 "frequency gain" function described in
    Eqn (6.13) of "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm"
    and used in computing troposcatter attenuation.

    """
    #test via area prediction mode
    r = 0.4727387221558643
    et = 2.5221451983881447

    actual_answer = h0f(r, et)

    expected_answer = 34.28154717133048

    assert actual_answer == expected_answer

    actual_answer = h0f(2, -1)

    assert round(actual_answer, 2) == 9.33

    actual_answer = h0f(2, 6)

    assert round(actual_answer, 2) == 18.53
