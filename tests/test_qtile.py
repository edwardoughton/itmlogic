import pytest
from itmlogic.qtile import qtile

def test_qtile(setup_a):

    assert qtile(setup_a, 5) == 100
    assert qtile(setup_a, 8) == 40
    assert qtile(setup_a, 3) == 140
    