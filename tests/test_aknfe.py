import pytest
from itmlogic.diffraction_attenuation.aknfe import aknfe

def test_aknfe():
    """
    Returns the attenuation due to a single knife edge - the Fresnel integral (in decibels,
    Eqn 4.21 of "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm" – see also
    Eqn 6.1) evaluated for nu equal to the square root of the input argument.

    """
    assert round(aknfe(-1), 2) == 6.05
    assert round(aknfe(2), 2) == 16.36
    assert round(aknfe(3), 2) == 17.99
    assert round(aknfe(5), 2) == 20.04
    assert round(aknfe(6), 2) == 20.73
