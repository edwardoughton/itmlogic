import pytest
from itmlogic.fht import fht

def test_fht():

    x = 372.8075813962142
    pk = 0.0015012964882592428

    actual_answer = fht(x, pk)

    expected_answer = -11.915375775262177

    assert actual_answer == expected_answer


    