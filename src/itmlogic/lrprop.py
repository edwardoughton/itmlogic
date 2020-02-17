import math
import numpy as np

from itmlogic.adiff import adiff
from itmlogic.alos import alos
from itmlogic.ascat import ascat

def lrprop(d, prop):
    """
    Calls adiff, alos, and ascat.

    Parameters
    ----------
    d : float
        ???
    prop : dict
        ???

    Returns
    -------
    prop : dict
        ???mdp

    """
    third = 1 / 3

    if prop['mdp'] != 0:

        prop['dls'] = []

        for entry in prop['he']:
            prop['dls'].append(math.sqrt(2 * entry / prop['gme']))

        prop['dlsa']  = prop['dls'][0] + prop['dls'][1]

        prop['dla'] = prop['dl'][0] + prop['dl'][1]

        prop['tha'] = (
            max(prop['the'][0] + prop['the'][1],
            -prop['dla'] * prop['gme'])
            )

        prop['wlos'] = 0
        prop['wscat'] = 0

        if prop['wn'] < 0.838 or prop['wn'] > 210:
            prop['kwx'] = max(prop['kwx'], 1)

        if prop['hg'][0] < 1 or prop['hg'][0] > 1000:
            prop['kwx'] = max(prop['kwx'], 1)

        if prop['hg'][1] < 1 or prop['hg'][1] > 1000:
            prop['kwx'] = max(prop['kwx'], 1)

        if (abs(prop['the'][0]) > 0.2 or
            prop['dl'][0] < 0.1 * prop['dls'][0] or
            prop['dl'][1] > 3 * prop['dls'][0]):
            prop['kwx'] = max(prop['kwx'], 3)

        if (abs(prop['the'][1]) > 0.2 or
            prop['dl'][1] < 0.1 * prop['dls'][1] or
            prop['dl'][1] > 3 * prop['dls'][1]):
            prop['kwx'] = max(prop['kwx'], 3)

        if (prop['ens'] < 250 or prop['ens'] > 400 or prop['gme'] < 75e-9 or
            prop['gme'] > 250e-9 or prop['zgnd'].real < abs(prop['zgnd'].imag) or
            prop['wn'] < 0.419 or prop['wn'] > 420):
            prop['kwx'] = 4

        if prop['hg'][0] < 0.5 or prop['hg'][0] > 3000:
            prop['kwx'] = 4

        if prop['hg'][1] < 0.5 or prop['hg'][1] > 3000:
            prop['kwx'] = 4

        prop['dmin'] = abs(prop['he'][0] - prop['he'][1]) / 0.2

        q, prop = adiff(0, prop)

        prop['xae'] = (prop['wn'] * prop['gme']**2)**(-third)

        d3 = max(prop['dlsa'], 1.3787 * prop['xae'] + prop['dla'])
        d4 = d3 + 2.7574 * prop['xae']
        a3, prop = adiff(d3, prop)
        a4, prop = adiff(d4, prop)

        prop['emd'] = (a4 - a3) / (d4 - d3)

        prop['aed'] = a3 - prop['emd'] * d3
        prop['wis'] = (
            0.021 / (0.021 + prop['wn'] *
            prop['dh'] / max(10e3, prop['dlsa']))
            )
        prop['ascat1'] = 0

    if prop['mdp'] >= 0:
        prop['mdp'] = 0
        prop['dist'] = d

    if prop['dist'] > 0:
        if prop['dist'] > 1000e3:
            prop['kwx'] = max(prop['kwx'], 1)
        if prop['dist'] < prop['dmin']:
            prop['kwx'] = max(prop['kwx'], 3)
        if prop['dist'] < 1e3 or prop['dist'] > 2000e3:
            prop['kwx'] = 4

    if prop['dist'] < prop['dlsa']:
        if prop['wlos'] == 0:

            d2 = prop['dlsa']
            a2 = prop['aed'] + d2 * prop['emd']
            d0 = 1.908 * prop['wn'] * prop['he'][0] * prop['he'][1]

            if prop['aed'] >= 0:
                d0 = min(d0, 0.5 * prop['dla'])
                d1 = d0 + 0.25 * (prop['dla'] - d0)
            else:
                d1 = max(-prop['aed'] / prop['emd'], 0.25 * prop['dla'])

            a1 = alos(d1, prop)

            wq=0
            if d0 < d1:
                a0 = alos(d0, prop)
                q = np.log(d2 / d0)
                prop['ak2'] = (
                    max(0,((d2 - d0) * (a1 - a0) - (d1 - d0) *
                    (a2 - a0)) / ((d2 - d0) * np.log(d1 / d0) -
                    (d1 - d0) * q))
                    )

                wq = ((prop['aed'] > 0), (prop['ak2'] > 0))

                if wq:
                    prop['ak1'] = (a2 - a0 - prop['ak2'] * q) / (d2 - d0)
                    if prop['ak1'] < 0:
                        prop['ak1'] = 0
                        prop['ak2'] = max(a2 - a0, 0) / q
                        if prop['ak2'] == 0:
                            prop['ak1'] = prop['emd']

            if wq == 0:
                prop['ak1'] = max(a2 - a1, 0) / (d2 - d1)
                prop['ak2'] = 0
                if prop['ak1'] == 0:
                    prop['ak1'] = prop['emd']

            prop['ael'] = a2 - prop['ak1'] * d2 - prop['ak2'] * np.log(d2)
            prop['wlos'] = 1

            if prop['dist'] > 0:
                prop['aref'] = (
                    prop['ael'] + prop['ak1'] *
                    prop['dist'] + prop['ak2'] * np.log(prop['dist'])
                    )

    if prop['dist'] <= 0 or prop['dist'] >= prop['dlsa']:

        if prop['wscat'] == 0:
            prop['ad'] = prop['dl'][0] - prop['dl'][1]
            prop['rr'] = prop['he'][1] / prop['he'][0]
            if prop['ad'] < 0:
                prop['ad'] = -prop['ad']
                prop['rr'] = 1 / prop['rr']

            prop['etq'] = (
                (5.67e-6 * prop['ens'] - 2.32e-3) *
                prop['ens'] + 0.031
                )

            prop['h0s'] = -15

            d5 = prop['dla'] + 200e3
            d6 = d5 + 200e3

            prop = ascat(d6, prop)
            a6 = prop['ascat1']
            prop = ascat(d5, prop)
            a5 = prop['ascat1']

            if a5 < 1000:
                prop['ems'] = (a6 - a5) / 200e3
                prop['dx'] = (
                    max([prop['dlsa'], prop['dla'] + 0.3 * prop['xae'] *
                    np.log(47.7 * prop['wn']), (a5 - prop['aed'] -
                    prop['ems'] * d5) / (prop['emd'] - prop['ems'])])
                    )
                prop['aes'] = (
                    (prop['emd'] - prop['ems']) *
                    prop['dx'] + prop['aed']
                    )
                print(prop)
            else:
                prop['ems'] = prop['emd']
                prop['aes'] = prop['aed']
                prop['dx'] = 10e6

            prop['wscat'] = 1

        if prop['dist'] > prop['dx']:
            prop['aref'] = prop['aes'] + prop['ems'] * prop['dist']
        else:
            prop['aref'] = prop['aed'] + prop['emd'] * prop['dist']

    prop['aref'] = max(prop['aref'], 0)

    return prop
