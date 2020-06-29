import pytest
from itmlogic.preparatory_subroutines.hzns import hzns

def test_hzns(setup_prop_test_hzns):
    """
    Tests the subroutine to finds horizon parameters.

    The imported setup parameters are imported from tests/conftest.py via the fixture
    setup_prop_test_hzns.

    """
    answer1, answer2 = hzns(
        setup_prop_test_hzns['pfl'], 77800,
        setup_prop_test_hzns['hg'],
        setup_prop_test_hzns['gme']
        )

    assert round(answer1[0], 4) == -0.0039
    assert round(answer1[1], 4) == 0.0005

    assert round(answer2[0], 4) == 55357.6923
    assert round(answer2[1], 4) == 19450.0000
