import math
import numpy as np

from itmlogic.curv import curv

def avar(zzt, zzl, zzc, prop):
    """
    ???

    Parameters
    ----------
    zzt : ???
        ???
    zzl : ???
        ???
    zzc : ???
        ???
    prop : dict
        Propagation parameters and results.

    Returns
    -------
    avar1 : ???
        ???
    prop : dict
        Propagation parameters and results.

    """
    third = 1 / 3

    bv1 = [   -9.67,   -0.62,    1.26,   -9.21,   -0.62,   -0.39,    3.15]
    bv2 = [    12.7,    9.19,    15.5,    9.05,    9.19,    2.86,   857.9]
    xv1 = [ 144.9e3, 228.9e3, 262.6e3,  84.1e3, 228.9e3, 141.7e3, 2222.e3]
    xv2 = [ 190.3e3, 205.2e3, 185.2e3, 101.1e3, 205.2e3, 315.9e3, 164.8e3]
    xv3 = [ 133.8e3, 143.6e3,  99.8e3,  98.6e3, 143.6e3, 167.4e3, 116.3e3]
    bsm1 = [    2.13,    2.66,    6.11,    1.98,    2.68,    6.86,    8.51]
    bsm2 = [   159.5,    7.67,    6.65,   13.11,    7.16,   10.38,   169.8]
    xsm1 = [ 762.2e3, 100.4e3, 138.2e3, 139.1e3,  93.7e3, 187.8e3, 609.8e3]
    xsm2 = [ 123.6e3, 172.5e3, 242.2e3, 132.7e3, 186.8e3, 169.6e3, 119.9e3]
    xsm3 = [  94.5e3, 136.4e3, 178.6e3, 193.5e3, 133.5e3, 108.9e3, 106.6e3]
    bsp1 = [    2.11,    6.87,   10.08,    3.68,    4.75,    8.58,    8.43]
    bsp2 = [   102.3,   15.53,    9.60,   159.3,    8.12,   13.97,    8.19]
    xsp1 = [ 636.9e3, 138.7e3, 165.3e3, 464.4e3,  93.2e3, 216.0e3, 136.2e3]
    xsp2 = [ 134.8e3, 143.7e3, 225.7e3,  93.1e3, 135.9e3, 152.0e3, 188.5e3]
    xsp3 = [  95.6e3,  98.6e3, 129.7e3,  94.2e3, 113.4e3, 122.7e3, 122.9e3]
    bsd1 = [   1.224,   0.801,   1.380,   1.000,   1.224,   1.518,   1.518]
    bzd1 = [   1.282,   2.161,   1.282,     20.,   1.282,   1.282,   1.282]
    bfm1 = [      1.,      1.,      1.,      1.,    0.92,      1.,      1.]
    bfm2 = [      0.,      0.,      0.,      0.,    0.25,      0.,      0.]
    bfm3 = [      0.,      0.,      0.,      0.,    1.77,      0.,      0.]
    bfp1 = [      1.,    0.93,      1.,    0.93,    0.93,      1.,      1.]
    bfp2 = [      0.,    0.31,      0.,    0.19,    0.31,      0.,      0.]
    bfp3 = [      0.,    2.00,      0.,    1.79,    2.00,      0.,      0.]

    rt = 7.8
    rl = 24

    if prop['lvar'] > 0:
        if prop['lvar'] > 4:
            if prop['klim'] <= 0 or prop['klim'] > 7:
                prop['klim'] = 5
                prop['kwx'] = max(prop['kwx'], 2)

            prop['cv1'] = bv1[prop['klim'] - 1]
            prop['cv2'] = bv2[prop['klim'] - 1]
            prop['yv1'] = xv1[prop['klim'] - 1]
            prop['yv2'] = xv2[prop['klim'] - 1]
            prop['yv3'] = xv3[prop['klim'] - 1]
            prop['csm1'] = bsm1[prop['klim']- 1]
            prop['csm2'] = bsm2[prop['klim']- 1]
            prop['ysm1'] = xsm1[prop['klim']- 1]
            prop['ysm2'] = xsm2[prop['klim']- 1]
            prop['ysm3'] = xsm3[prop['klim']- 1]
            prop['csp1'] = bsp1[prop['klim']- 1]
            prop['csp2'] = bsp2[prop['klim']- 1]
            prop['ysp1'] = xsp1[prop['klim']- 1]
            prop['ysp2'] = xsp2[prop['klim']- 1]
            prop['ysp3'] = xsp3[prop['klim']- 1]
            prop['csd1'] = bsd1[prop['klim']- 1]
            prop['zd'] = bzd1[prop['klim'] - 1]
            prop['cfm1'] = bfm1[prop['klim'] - 1]
            prop['cfm2'] = bfm2[prop['klim'] - 1]
            prop['cfm3'] = bfm3[prop['klim'] - 1]
            prop['cfp1'] = bfp1[prop['klim'] - 1]
            prop['cfp2'] = bfp2[prop['klim'] - 1]
            prop['cfp3'] = bfp3[prop['klim'] - 1]

        if prop['lvar'] > 3:

            prop['kdv'] = prop['mdvar']
            prop['ws'] = (prop['kdv'] >= 20)

            if prop['ws']:
                prop['kdv'] = prop['kdv'] - 20

            prop['wl'] = prop['kdv'] >= 10

            if prop['wl']:
                prop['kdv'] = prop['kdv'] - 10

            if prop['kdv'] < 0 or prop['kdv'] > 3:
                prop['kdv'] = 0
                prop['kwx'] = max(prop['kwx'], 2)

        if prop['lvar'] > 2:

            q = np.log(0.133 * prop['wn'])

            prop['gm'] = (
                prop['cfm1'] + prop['cfm2'] /
                ((prop['cfm3'] * q)**2 + 1)
                )

            prop['gp'] = (
                prop['cfp1'] + prop['cfp2'] /
                ((prop['cfp3'] * q)**2 + 1)
                )

        if prop['lvar'] > 1:

            prop['dexa'] = (
                math.sqrt(18e6 * prop['he'][0]) +
                math.sqrt(18e6 * prop['he'][1]) +
                (575.7e12 / prop['wn']) ** third
                )

        if prop['dist'] < prop['dexa']:
            de = 130e3 * prop['dist'] / prop['dexa']

        else:
            de = 130e3 + prop['dist'] - prop['dexa']

        prop['vmd'] = curv(
            prop['cv1'], prop['cv2'], prop['yv1'],
            prop['yv2'], prop['yv3'], de
            )

        prop['sgtm'] = curv(
            prop['csm1'], prop['csm2'], prop['ysm1'],
            prop['ysm2'], prop['ysm3'], de) * prop['gm']

        prop['sgtp'] = curv(
            prop['csp1'], prop['csp2'], prop['ysp1'],
            prop['ysp2'], prop['ysp3'], de) * prop['gp']

        prop['sgtd'] = prop['sgtp'] * prop['csd1']

        prop['tgtd'] = (prop['sgtp'] - prop['sgtd']) * prop['zd']

        if prop['wl']:
            prop['sgl'] = 0
        else:
            q = (
                (1 - 0.8 * math.exp(-prop['dist'] / 50e3)) *
                prop['dh'] * prop['wn']
                )
            prop['sgl'] = 10 * q / (q + 13)

        if prop['ws']:
            prop['vs0'] = 0
        else:
            prop['vs0'] = (5 + 3 * math.exp(-de / 100e3))**2

        prop['lvar'] = 0

    zt = zzt
    zl = zzl
    zc = zzc

    if prop['kdv'] == 0:
        zt = zc
        zl = zc
    elif prop['kdv'] == 1:
        zl = zc
    elif prop['kdv'] == 2:
        zl = zt

    if abs(zt) > 3.10 or abs(zl) > 3.10 or abs(zc) > 3.10:
        prop['kwx'] = max(prop['kwx'], 1)

    if zt < 0:
        sgt = prop['sgtm']
    elif zt <= prop['zd']:
        sgt = prop['sgtp']
    else:
        sgt = prop['sgtd'] + prop['tgtd'] / zt

    vs = (
        prop['vs0'] + (sgt * zt)**2 / (rt + zc**2) +
        (prop['sgl'] * zl)**2 / (rl + zc**2)
        )

    if prop['kdv'] == 0:
        yr = 0
        sgc = math.sqrt(sgt**2 + prop['sgl']**2 + vs)
    elif prop['kdv'] == 1:
        yr = sgt * zt
        sgc = math.sqrt(prop['sgl']**2 + vs)
    elif prop['kdv'] == 2:
        yr = math.sqrt(sgt**2 + prop['sgl']**2) * zt
        sgc = math.sqrt(vs)
    else:
        yr = sgt * zt + prop['sgl'] * zl
        sgc = math.sqrt(vs)

    # print('AVAR YR, KDV, SGT, ZT ' + str(yr) + ' ' +
    #     str(['kdv']) + ' ' + str(sgt) + ' ' +  str(zt))

    avar1 = prop['aref'] - prop['vmd'] - yr - sgc * zc

    # print('AVAR: ' + str(prop['aref']) + ' ' + str(prop['vmd']) +
    #     ' ' + str(yr) + ' ' + str(sgc) + ' ' + str(zc))

    if avar1 < 0:
        avar1 = avar1 * (29 - avar1) / (29 - 10 * avar1)

    return avar1, prop
