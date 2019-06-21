import pytest
from itmlogic.aknfe import aknfe

def test_aknfe():

    assert round(aknfe(5), 2) == 20.04
    assert round(aknfe(6), 2) == 20.73


    