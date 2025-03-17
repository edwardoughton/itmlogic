from itmlogic.misc.qerfi import qerfi


def test_qerfi():
    """
    Test the qerfi function which is the inverse of qerf - the solution for x to q = Q(x).
    The approximation is due to Hastings, Jr. (1995). Both the area prediction and
    point to point prediction modes are tested.
    """
    # test p2p
    q = [
        0.0100000000000000, 0.100000000000000,
        0.500000000000000, 0.900000000000000,
        0.990000000000000
    ]

    actual_answer = qerfi(q)

    expected_answer = [2.3268, 1.2817, 0.0000, -1.2817, -2.3268]

    assert actual_answer == expected_answer

    # test area prediction mode
    q = [0.5000]

    actual_answer = qerfi(q)

    expected_answer = [0]

    assert actual_answer == expected_answer

    q = [0.5, 0.9, 0.1]

    actual_answer = qerfi(q)

    expected_answer = [0.0, -1.2817, 1.2817]

    assert actual_answer == expected_answer
