import pytest
from itmlogic.qtile import qtile

def test_qtile(setup_a):

    assert qtile('unknown_parameter', setup_a, 50) == 100
    assert qtile('unknown_parameter', setup_a, 80) == 160
    assert qtile('unknown_parameter', setup_a, 30) == 60
    