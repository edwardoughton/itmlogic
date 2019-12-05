import pytest
from itmlogic.h0f import h0f

def test_h0f():

    #test via area prediction mode
    r = 0.4727387221558643
    et = 2.5221451983881447

    actual_answer = h0f(r, et)

    expected_answer = 34.28154717133048

    assert actual_answer == expected_answer
