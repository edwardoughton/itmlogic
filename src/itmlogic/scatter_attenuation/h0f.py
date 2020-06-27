import numpy as np

def h0f(r, et):
    """
    Routine for computing the H01 "frequency gain" function described in Eqn (6.13)
    of "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm" and used in
    computing troposcatter attenuation.

    Parameters
    ----------
    r : float
        Input r parameter for Eqn (6.13) of "The ITS Irregular Terrain Model, version 1.2.2:
        The Algorithm".
    et : float
        Scattering efficiency coefficient.

    Returns
    -------
    h0f1 : float
        Frequency gain value used for computing path loss.

    """
    a = [25, 80, 177, 395, 705]
    b = [24, 45, 68, 80, 105]

    it = int(np.floor(et))

    if it <= 0:
        it = 1
        q = 0

    elif it >= 5:
        it = 5
        q = 0

    else:
        q = et - it

    x = (1 / r)**2
    h0f1 = 4.343 * np.log((a[it-1] * x + b[it-1]) * x + 1)

    if q != 0:
        h0f1 = (
            (1 - q) * h0f1 + q * 4.343 *
            np.log((a[it] * x + b[it]) * x + 1)
        )

    return h0f1
