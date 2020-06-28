import pytest
from itmlogic.ascat import ascat

def test_ascat(setup_prop_to_test_ascat):
    """
    Test the scatter attenuation function ascat at the stated distance d.

    The imported setup parameters are imported from tests/conftest.py via the fixture
    setup_prop_to_test_ascat.

    The inputs and expected answer are based on an original test for Longley-Rice between
    for Crystal Palace (South London) to Mursley, England (See Stark, 1967).

    """
    actual_prop = ascat(418934.4081874959, setup_prop_to_test_ascat)

    assert round(actual_prop['ascat1'],3) == 99.023
