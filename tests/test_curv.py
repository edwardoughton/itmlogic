import pytest
from itmlogic.curv import curv

def test_curv():

    actual_answer = curv(
        -0.62, 9.19, 
        228900.0, 205200.0, 
        143600.0, 59097.60805391026
        )

    expected_answer = 0.24344472623622865

    assert actual_answer == expected_answer


    