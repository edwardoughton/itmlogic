import pytest
from itmlogic.qerf import qerf

def test_qerf():
    """
    Test the standard normal complementary probability - see function in
    C. Hastings, Jr. (1955).

    The returned value (qerf1) is the assesses the probability of exceedance of a
    standardized normal random variable.

    """
    assert round(qerf(-1), 4) == 0.8413
    assert round(qerf(1), 4) == 0.1587
    assert round(qerf(10), 4) == 0
