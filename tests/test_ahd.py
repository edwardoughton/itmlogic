import pytest
from itmlogic.ahd import ahd

def test_ahd():

    td = 5643.8

    actual_answer = ahd(td)

    expected_answer = 97.7575

    assert round(actual_answer, 4) == expected_answer
