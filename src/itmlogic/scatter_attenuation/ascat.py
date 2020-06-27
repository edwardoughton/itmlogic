import math
import numpy as np
from itmlogic.h0f import h0f
from itmlogic.ahd import ahd

def ascat(d, prop):
    """
    Finds the scatter attenuation at the distance d using an approximation to the methods of
    NBS TN101 with checks for inadmissable situations. A call with d = 0 set up initial
    constants.

    Parameters
    ----------
    d : float
        Distance in meters.
    prop : dict
        Contains all input propagation parameters

    Returns
    -------
    prop : dict
        Contains all input and output propagation parameters.

    """
    if prop['h0s'] > 15:
        h0 = prop['h0s']

    else:
        th = prop['the'][0] + prop['the'][1] + d * prop['gme']
        r2 = 2 * prop['wn'] * th

        r1 = r2 * prop['he'][0]
        r2 = r2 * prop['he'][1]

        if r1 < 0.2 and r2 < 0.2:
            prop['ascat1'] = 1001

        ss = (d - prop['ad']) / (d + prop['ad'])

        q = prop['rr'] / ss
        ss = max(0.1, ss)
        q = min(max(0.1, q), 10)
        z0 = (d - prop['ad']) * (d + prop['ad']) * th * 0.25 / d

        et = (prop['etq'] * math.exp(-min(1.7, z0 / 8.0e3)**6) + 1) * z0 / 1.7556e3

        ett = max(et, 1)

        h0 = (h0f(r1, ett) + h0f(r2, ett)) * 0.5

        h0 = h0 + min(h0, (1.38 - np.log(ett)) * np.log(ss) * np.log(q) * 0.49)

        h0 = max(h0, 0)

        if et < 1:
            h0 = (
                et * h0 + (1 - et) * 4.343 * np.log(((1 + 1.4142 / r1) *
                (1 + 1.4142 / r2))**2 * (r1 + r2) / (r1 + r2 + 2.8284))
            )

        if h0 > 15 and prop['h0s'] >= 0:
            h0 = prop['h0s']

        if prop['ascat1'] != 1001:

            prop['h0s'] = h0

    th = prop['tha'] + d * prop['gme']

    prop['ascat1'] = (
        ahd(th*d) + 4.343 * np.log(47.7 * prop['wn'] * th**4) -
        0.1 * (prop['ens'] - 301) * math.exp(-th * d / 40e3) + h0
        )

    return prop
