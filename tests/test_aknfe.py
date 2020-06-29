import pytest
from itmlogic.diffraction_attenuation.aknfe import aknfe

def test_aknfe():
    """
    Returns the attenuation due to a single knife edge - the Fresnal integral (in decibels).

    """
    assert round(aknfe(-1), 2) == 6.05
    assert round(aknfe(2), 2) == 16.36
    assert round(aknfe(3), 2) == 17.99
    assert round(aknfe(5), 2) == 20.04
    assert round(aknfe(6), 2) == 20.73
