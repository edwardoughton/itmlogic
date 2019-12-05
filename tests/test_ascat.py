import pytest
from itmlogic.ascat import ascat

def test_ascat(setup_prop_to_test_ascat):

    actual_prop = ascat(418934.4081874959, setup_prop_to_test_ascat)

    assert round(actual_prop['ascat1'],3) == 99.023
