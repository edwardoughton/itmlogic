import math
import numpy as np

from itmlogic.diffraction_attenuation.aknfe import aknfe
from itmlogic.diffraction_attenuation.fht import fht

def adiff(d, prop):
    """
    Returns adiff1 given input parameters. All parameters may not be needed.

    The diffraction region is beyond the smooth-earth horizon and short of where troposhpheric
    scatter takes over. It is an essential region and associated coefficients must be computed.

    The function adiff finds the 'diffraction attenuation' at the distance d, using a convex
    combination of smooth earth diffraction and double knife-edge diffraction (Eqn 4.11 of
    "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm"). A call with d = 0 sets
    up initial constants.

    Parameters
    ----------
    d : float
        Distance in meters.
    prop : dict
        Contains all input propagation parameters

    Returns
    -------
    adiff1 : float
        Returns the estimated diffraction attenuation.
    prop : dict
        Contains all input and output propagation parameters.

    """
    third = 1 / 3

    if d == 0:
        q = prop['hg'][0] * prop['hg'][1]

        prop['qk'] = prop['he'][0] * prop['he'][1] - q

        if prop['mdp'] < 0:
            q = q + 10

        prop['wd1'] = math.sqrt(1 + prop['qk'] / q)
        prop['xd1'] = prop['dla'] + prop['tha'] / prop['gme']

        q = (1 - 0.8 * math.exp(-prop['dlsa'] / 50e3)) * prop['dh']
        q = 0.78 * q * math.exp(-(q / 16) ** 0.25)

        prop['afo'] = (
            min(15, 2.171 * np.log(1 + 4.77e-4 * prop['hg'][0]
            * prop['hg'][1] * prop['wn'] * q))
            )

        prop['qk'] = 1 / abs(prop['zgnd'])
        prop['aht'] = 20
        prop['xht'] = 0

        for j in range(0, 2):
            a = 0.5 * prop['dl'][j] ** 2 / prop['he'][j]
            wa = (a * prop['wn']) ** third
            pk = prop['qk'] / wa

            q = (1.607 - pk) * 151.0 * wa * prop['dl'][j] / a

            prop['xht'] = prop['xht'] + q
            prop['aht'] = prop['aht'] + fht(q, pk)

        adiff1 = 0

    else:

        th = prop['tha'] + d * prop['gme']

        ds = d - prop['dla']

        q = 0.0795775 * prop['wn'] * ds * th**2

        adiff1 = aknfe(q * prop['dl'][0] /
            (ds + prop['dl'][0])) + aknfe(q * prop['dl'][1] /
            (ds + prop['dl'][1]))

        a = ds / th
        wa = (a * prop['wn']) ** third

        pk = prop['qk'] / wa

        q = (1.607 - pk) * 151.0 * wa * th + prop['xht']

        ar = 0.05751 * q - 4.343 * np.log(q) - prop['aht']

        q = (
            (prop['wd1'] + prop['xd1'] / d) *
            min(((1 - 0.8 * math.exp(-d / 50e3)) *
            prop['dh'] * prop['wn']), 6283.2)
            )

        wd = 25.1 / (25.1 + math.sqrt(q))

        adiff1 = ar * wd + (1 - wd) * adiff1 + prop['afo']

    return adiff1, prop
