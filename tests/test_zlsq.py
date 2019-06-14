import pytest
from itmlogic.zlsq1 import zlsq1

def test_zlsq1(setup_z):
    
    xa, xb = zlsq1(setup_z, 0, 144)

    xa = round(xa, 2)
    xb = round(xb, 2)

    assert xa == 23.16
    assert xb == 162.52
    