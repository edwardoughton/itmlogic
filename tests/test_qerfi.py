import pytest
from itmlogic.qerfi import qerfi

def test_qerfi():

    qc = [50]

    actual_answer = qerfi(qc)

    expected_answer = 1.314300890342679e-09

    assert actual_answer == expected_answer

    