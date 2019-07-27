import math
import numpy as np

def aknfe(v2):
    """
    Returns knife edge diffraction loss

    Parameters
    ----------
    v2 : ??
        ???

    Returns
    -------
    aknfe1 : ???
        ???

    """
    if v2 < 5.76:
        if v2 <= 0: ### addition to avoid logging v2 <= 0
            v2 = 0.00001 ### addition to avoid logging v2 <= 0
        aknfe1 = 6.02 + 9.11 * math.sqrt(v2) - 1.27 * v2

    else:

        aknfe1 = 12.953 + 4.343 * np.log(v2)

    return aknfe1
