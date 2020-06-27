import pytest
from itmlogic.curv import curv

def test_curv():
    """
    Tests the empirical curve fitting used in the computation of the Vmd, sigma_T-, and
    sigma_T+ for estimating time variability effects as a function of the climatic region,
    as described in equations (5.5) through (5.7) of of "The ITS Irregular Terrain Model,
    version 1.2.2: The Algorithm" and as captured in Figure 10.13 of NBS Technical Note 101.

    """
    actual_answer = curv(
        -0.62, 9.19,
        228900.0, 205200.0,
        143600.0, 59097.60805391026
        )

    expected_answer = 0.24344472623622865

    assert actual_answer == expected_answer
