import pytest
from itmlogic.zlsq1 import zlsq1

def test_zlsq1(setup_z):

    xa, xb = zlsq1(setup_z, 0, 144)

    xa = round(xa, 4)
    xb = round(xb, 4)

    assert xa == 57.3924
    assert xb == 408.1239
