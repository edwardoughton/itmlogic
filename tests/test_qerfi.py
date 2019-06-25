import pytest
from itmlogic.qerfi import qerfi

def test_qerfi():

    assert qerfi([50, 90, 10]) == [0, -1.2817, 1.2817]
