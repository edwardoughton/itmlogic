import pytest
from itmlogic.qerfi import qerfi

def test_qerfi():

    # assert qerfi([50]) == 1.314300890342679e-09
    assert qerfi([50, 90, 10]) == [0, -1.2817, 1.2817]

    