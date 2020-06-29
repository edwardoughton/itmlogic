import math
from itmlogic.hzns import hzns
from itmlogic.dlthx import dlthx
from itmlogic.zlsq1 import zlsq1
from itmlogic.lrprop import lrprop

def qlrpfl(prop):
    """
    Preparatory subroutine for point-to-point mode, as in Section 43 by Hufford
    (see references/itm.pdf).

    Parameters
    ----------
    prop : dict
        Contains all input propagation parameters.

    Returns
    -------
    prop : dict
        Contains all input and output propagation parameters.

    """
    prop['dist'] = prop['pfl'][0] * prop['pfl'][1]

    np = prop['pfl'][0]

    prop['the'], prop['dl'] = (
        hzns(prop['pfl'], prop['dist'], prop['hg'], prop['gme'])
        )

    xl = {}
    for j in range(0,2):
        xl[j] = min(15 * prop['hg'][j], 0.1 * prop['dl'][j])

    xl[1] = prop['dist'] - xl[1]

    prop['dh'] = dlthx(prop['pfl'], xl[0], xl[1])

    if prop['dl'][0] + prop['dl'][1] >= 1.5 * prop['dist']:
        prop['he'] = []
        za, zb = zlsq1(prop['pfl'], xl[0], xl[1])
        prop['he'].append(prop['hg'][0] + max(prop['pfl'][2] - za, 0))
        prop['he'].append(prop['hg'][1] + max(prop['pfl'][np+1] - zb, 0))

        for j in range(1, 2):
            prop['dl'][j] = (
                math.sqrt(2 *prop['he'][j] / prop['gme']) *
                math.exp(-0.07 * math.sqrt(prop['dh'] / max(prop['he'][j], 5)))
                )

        q = prop['dl'][0] + prop['dl'][1]

        if q <= prop['dist']:
            q = (prop['dist'] / q)**2
            for j in range(1, 2):
                prop['he'][j] = prop['he'][j] * q
                prop['dl'][j] = (
                    math.sqrt(2 * prop['he'][j] / prop['gme']) *
                    math.exp(-0.07 * math.sqrt(prop['dh'] / max(prop['he'][j], 5)))
                )

        for j in range(0,2):
            q = math.sqrt(2 * prop['he'][j] / prop['gme'])
            prop['the'][j] = (
                (0.65 * prop['dh'] * (q / prop['dl'][j] - 1) - 2 *
                prop['he'][j]) / q
                )
    else:
        za, q = zlsq1(prop['pfl'], xl[0], 0.9 * prop['dl'][0])

        q, zb = zlsq1(prop['pfl'], prop['dist'] - 0.9 * prop['dl'][1], xl[1])

        prop['he'] = []
        prop['he'].append(prop['hg'][0] + max(prop['pfl'][2] - za, 0))
        prop['he'].append(prop['hg'][1] + max(prop['pfl'][np+2] - zb, 0))

    prop['mdp'] = -1
    prop['lvar'] = max(prop['lvar'], 3)

    if prop['mdvarx'] >= 0:
        prop['mdvar'] = prop['mdvarx']
        prop['lvar'] = max(prop['lvar'], 4)

    if prop['klimx'] > 0:
        prop['klim'] = prop['klimx']
        prop['lvar'] = 5

    prop = lrprop(0, prop)

    return prop
