import math
import numpy as np


def qlra(kst, prop):
    """
    Preparatory subroutine for area prediction mode, as described in equations (3.1)-(3.4)
    of "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm" and as a function of
    the siting criteria for the transmit and receive terminals described using 2 element
    array KST (0=random, 1= "with care", 2= "with great care").

    Parameters
    ----------
    kst : list
        Siting criteria for the transmitter and receiver.
    prop : dict
        Contains all input propagation parameters.

    Returns
    -------
    prop : dict
        Contains all input and output propagation parameters.

    """
    prop["he"] = [0, 0]
    prop["dl"] = [0, 0]
    prop["the"] = [0, 0]

    for j in range(0, 2):

        if kst[j] <= 0:

            prop["he"][j] = prop["hg"][j]
        else:
            q = 4

            if kst[j] != 1:
                q = 9

            if prop["hg"][j] < 5:
                q = q * math.sin(0.3141593 * prop["hg"][j])

            prop["he"][j] = prop["hg"][j] + (1 + q) * math.exp(
                -min(20, 2 * prop["hg"][j] / max(1e-3, prop["dh"]))
            )

        q = np.sqrt(2 * prop["he"][j] / prop["gme"])

        prop["dl"][j] = q * math.exp(
            -0.07 * np.sqrt(prop["dh"] / max(prop["he"][j], 5))
        )

        prop["the"][j] = (
            0.65 * prop["dh"] * (q / prop["dl"][j] - 1) - 2 * prop["he"][j]
        ) / q

    prop["mdp"] = 1
    prop["lvar"] = max(prop["lvar"], 3)

    if prop["mdvarx"] >= 0:
        prop["mdvar"] = prop["mdvarx"]
        prop["lvar"] = max(prop["lvar"], 4)

    if prop["klimx"] > 0:
        prop["klim"] = prop["klimx"]
        prop["lvar"] = 5

    return prop
