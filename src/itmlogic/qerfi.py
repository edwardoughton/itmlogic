import numpy as np
import math

def qerfi(q):
    """
    The inverse of qerf - the solution for x to q = Q(x). The approximation
    is due to Hastings, Jr. (1995) and the maximum error should be 4.5x10^-4.

    Parameters
    ----------
    q : list of floats(s)
        Confidence levels for predictions (e.g. [0.01, 0.1, 0.5, 0.9, 0.99])

    Output
    ------
    qerfi1 : float
        Inverse of the standard normal complementary probability

    """
    c0 = 2.515516698
    c1 = 0.802853
    c2 = 0.010328
    d1 = 1.432788
    d2 = 0.189269
    d3 = 0.001308

    x = [0.5 - x for x in q]

    t = []

    for i in range(len(x)):

        t.append(max(0.5 - abs(x[i]), 0.000001))

    output = []

    index = 0
    for entry in t:
        interim_result = math.sqrt(-2 * np.log(entry))

        qerfi1 = (interim_result - (
                (c2 * interim_result + c1) *
                interim_result + c0) /
                (((d3 * interim_result + d2) *
                interim_result + d1) *
                interim_result + 1 ))

        if x[index] < 0:
            qerfi1 = -qerfi1

        output.append(round(qerfi1, 4))

        index += 1

    return output
