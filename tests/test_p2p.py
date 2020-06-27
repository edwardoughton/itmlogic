"""
Test full area prediction mode runner.

"""
import pytest
import math
import numpy as np

from itmlogic.qerfi import qerfi
from itmlogic.qlrpfl import qlrpfl
from itmlogic.avar import avar


def test_itmlogic_p2p(setup_surface_profile_m, setup_distance_km):
    """
    Test itmlogic in point to point (p2p) prediction mode.

    The test is derived from the original test for Longley-Rice between for Crystal
    Palace (South London) to Mursley, England.

    """
    prop = {}

    # Terrain relative permittivity
    prop['eps'] = 15

    # Terrain conductivity (S/m)
    prop['sgm']   = 0.005

    # Polarization selection (0=horizontal, 1=vertical)
    prop['ipol'] = 0

    # Operating frequency (MHz) % Second qkpfl.for test case
    prop['fmhz'] = 573.3

    # Antenna 1 height (m) # Antenna 2 height (m)
    prop['hg'] = [143.9, 8.5]

    # Operating frequency (MHz) % First qkpfl.for test case
    prop['fmhz']  =  41.5

    # Climate selection (1=equatorial,
    # 2=continental subtropical, 3=maritime subtropical,
    # 4=desert, 5=continental temperate,
    # 6=maritime temperate overland,
    # 7=maritime temperate, oversea (5 is the default)
    prop['klim']  =   5

    # Surface refractivity (N-units): also controls effective Earth radius
    prop['ens0']  =   314

    # Confidence  levels for predictions
    qc = [50, 90, 10]

    # Reliability levels for predictions
    qr = [1, 10, 50, 90, 99]

    # Length of profile
    prop['d'] = setup_distance_km

    # Number of points describing profile -1
    pfl = []
    pfl.append(len(setup_surface_profile_m) - 1)
    pfl.append(0)

    for profile in setup_surface_profile_m:
        pfl.append(profile)

    # Refractivity scaling ens=ens0*exp(-zsys/9460.)
    # (Average system elev above sea level)
    zsys = 0

    # Note also defaults to a continental temperate climate

    # Setup some intermediate quantities
    # Initial values for AVAR control parameter: LVAR=0 for quantile change,
    # 1 for dist change, 2 for HE change, 3 for WN change, 4 for MDVAR change,
    # 5 for KLIM change
    prop['lvar'] = 5

    # Inverse Earth radius
    prop['gma']  = 157E-9

    # Conversion factor to db
    db = 8.685890

    nc = len(qc)
    nr = len(qr)

    dkm = prop['d']
    xkm = 0

    if dkm <= 0:
        dkm = xkm * pfl[0]

    if xkm <= 0:

        xkm = dkm // pfl[0]
        print(dkm, pfl[0])
        pfl[1] = dkm * 1000 / pfl[0]

        prop['pfl'] = pfl
        prop['kwx'] = 0
        prop['wn'] = prop['fmhz'] / 47.7
        prop['ens'] = prop['ens0']

    if zsys != 0:
        prop['ens'] = prop['ens'] * math.exp(-zsys / 9460)

    prop['gme'] = prop['gma'] * (1 - 0.04665 * math.exp(prop['ens'] / 179.3))

    zq = complex(prop['eps'], 376.62 * prop['sgm'] / prop['wn'])
    prop['zgnd'] = np.sqrt(zq - 1)

    if prop['ipol'] != 0:
        prop['zgnd'] = prop['zgnd'] / zq

    prop['klimx'] = 0
    prop['mdvarx'] = 11

    zr = qerfi([x / 100 for x in qr])
    zc = qerfi([x / 100 for x in qc])

    prop = qlrpfl(prop)

    ## Here HE = effective antenna heights, DL = horizon distances, THE = horizon elevation angles
    ## MDVAR = mode of variability calculation: 0=single message mode,
    ## 1=accidental mode, 2=mobile mode, 3 =broadcast mode, +10 =point-to-point, +20=interference

    fs = db * np.log(2 * prop['wn'] * prop['dist']) # Free space loss in db
    q = prop['dist'] - prop['dlsa']
    q = max(q - 0.5 * pfl[1], 0) - max(-q - 0.5 * pfl[1], 0)

    if q < 0:
        print('Line of sight path')
    elif q == 0:
        print('Single horizon path')
    else:
        print('Double-horizon path')

    if prop['dist'] <= prop['dlsa']:
        print('Diffraction is the dominant mode')
    elif prop['dist'] > prop['dx']:
        print('Tropospheric scatter is the dominant mode')

    print('Estimated quantiles of basic transmission loss (db)')
    print('Free space value {} db'.format(str(fs)))

    print('Confidence levels {}, {}, {}'.format(
        str(qc[0]), str(qc[1]), str(qc[2])))

    output = []
    for jr in range(0, (nr)):
        for jc in range(0, nc):
            avar1, prop = avar(zr[jr], 0, zc[jc], prop)
            output.append({
                'distance_km': prop['d'],
                'reliability_level_%': qr[jr],
                'confidence_level_%': qc[jc],
                'propagation_loss_dB': fs + avar1
                })

    for result in output:
        if result['confidence_level_%'] == 50 and result['reliability_level_%'] == 1:
            assert result['propagation_loss_dB'] == 128.5969039310673
        if result['confidence_level_%'] == 90 and result['reliability_level_%'] == 1:
            assert result['propagation_loss_dB'] == 137.64279211442656
        if result['confidence_level_%'] == 10 and result['reliability_level_%'] == 1:
            assert result['propagation_loss_dB'] == 119.55101574770802
        if result['confidence_level_%'] == 50 and result['reliability_level_%'] == 99:
            assert result['propagation_loss_dB'] == 139.74127375512774
        if result['confidence_level_%'] == 90 and result['reliability_level_%'] == 99:
            assert result['propagation_loss_dB'] == 148.4389165313392
        if result['confidence_level_%'] == 10 and result['reliability_level_%'] == 99:
            assert result['propagation_loss_dB'] == 131.04363097891627
