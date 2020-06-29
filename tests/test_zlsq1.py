import pytest
from itmlogic.preparatory_subroutines.zlsq1 import zlsq1

def test_zlsq1(setup_z):
    """
    Test the point-ot-point preparatory function zlsq1 which is the linear least squares
    fit between x1 and x2, to the function described by the array z.

    """
    xa, xb = zlsq1(setup_z, 0, 144)

    xa = round(xa, 4)
    xb = round(xb, 4)

    assert xa == 57.3924
    assert xb == 408.1239
