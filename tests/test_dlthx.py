import pytest
from itmlogic.dlthx import dlthx

def test_dlthx(setup_pfl1):
    """
    Tests the delta h value, which is the interdecile range of elevations between point x1
    and point x2, generated from the terrain profile pfl1, as described in Section 48 by
    Hufford (see references/itm.pdf).

    The terrain profile (pfl1) is imported from tests/conftest.py via the fixture
    setup_pfl1.

    The test is derived from the original test for Longley-Rice between for Crystal
    Palace (South London) to Mursley, England (See Stark, 1967).

    """
    assert round(dlthx(setup_pfl1, 2158.5, 77672.5), 4) == 89.2126
