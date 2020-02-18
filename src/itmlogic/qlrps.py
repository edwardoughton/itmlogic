import cmath
import math

def qlrps(fmhz, zsys, en0, ipol, eps, sgm):
    """
    Preparatory subroutine.

    Parameters
    ----------
    fmhz : int
        Carrier frequency.
    en0 :
        Surface refractivity reduced to sea level.
    zsysz :
        General system elevation.
    eps :
        Polarization.
    sgm :
        Ground constants.
    wn :
        Wave number
    ens :
        Surface refractivity.
    gme :
        Effective earth curvature.
    zgnd :
        Surface impedance.

    """
    gma = 157e-9
    wn = fmhz / 47.7
    ens = en0
    print(fmhz, zsys, en0, ipol, eps, sgm)
    if zsys != 0:
        ens = ens * math.exp(-zsys / 9460)

    gme = gma * (1 - 0.04665 * math.exp(ens / 179.3))

    zq = complex(eps, 376.62 * sgm / wn)

    zgnd = cmath.sqrt(zq - 1)

    if ipol != 0:

        zgnd = zgnd / zq

    return wn, gme, ens, zgnd
