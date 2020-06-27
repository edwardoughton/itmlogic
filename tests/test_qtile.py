import pytest
from itmlogic.qtile import qtile

def test_qtile(setup_a):
    """
    Test the routine for returning the ith entry of a given vector after sorting in
    descending order, to obtain user-defined quantile values.

    """
    assert qtile(setup_a, 5) == 100
    assert qtile(setup_a, 8) == 40
    assert qtile(setup_a, 3) == 140
