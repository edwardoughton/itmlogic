import pytest
from itmlogic.qerf import qerf

def test_qerf():

    assert round(qerf(-1),4) == 0.8413
    assert round(qerf(1),4) == 0.1587
    assert round(qerf(10),4) == 0
