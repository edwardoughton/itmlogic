import pytest
from itmlogic.qerfi import qerfi

def test_qerfi():

    #test p2p
    q = [
        0.0100000000000000, 0.100000000000000,
        0.500000000000000, 0.900000000000000,
        0.990000000000000
    ]

    actual_answer = qerfi(q)

    expected_answer = [2.3268, 1.2817, 0.0000, -1.2817, -2.3268]

    assert actual_answer == expected_answer

    #test area prediction mode
    q = [0.5000]

    actual_answer = qerfi(q)

    expected_answer = [0]

    assert actual_answer == expected_answer

    q = [0.5, 0.9, 0.1]

    actual_answer = qerfi(q)

    expected_answer = [0.0, -1.2817, 1.2817]

    assert actual_answer == expected_answer
