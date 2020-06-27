import pytest
from itmlogic.ahd import ahd

def test_ahd():
    """
    Returns the function F0(D) (Eqn 6.9 of "The ITS Irregular Terrain Model, version 1.2.2:
    The Algorithm") used in the computation of tropospheric scatter attenuation,
    with the input D in meters.

    """
    #td input in meters
    td = 5643.8

    #test function
    actual_answer = ahd(td)

    #expected answer in dB
    expected_answer = 97.7575

    assert round(actual_answer, 4) == expected_answer
