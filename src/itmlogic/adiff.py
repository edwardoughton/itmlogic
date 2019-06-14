import math 
import numpy as np

from itmlogic.aknfe import aknfe

def adiff(d, prop):
    """
    Returns adiff1 given input parameters. All parameters may not be needed.

    Parameters
    ----------
    d : float
        distance in meters.
    prop : TODO
        TODO

    Output
    ------
    adiff1 : TODO
        Returns the estimated diffraction attenuation.

    """   
    third = 1 / 3

    if d == 0:
        q = prop['hg'][0] * prop['hg'][1]
        prop['qk'] = prop['he'][0] * prop['he'][1] - q

        if prop['mdp'] < 0:
            q = q + 10

        prop['wd1'] = math.sqrt(1 + prop['qk'] / q)
        prop['xd1'] = prop['dla'] + prop['tha'] / prop['gme']

        q = (1 - 0.8 * exp(-prop['dlsa'] / 50e3)) * prop['dh']
        q = 0.78 * q * exp(-(q / 16) ** 0.25)

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

        a=ds/th;
        wa=(a*prop.wn)^third;

        pk=prop.qk/wa;

        q=(1.607-pk)*151.0*wa*th+prop.xht;

        ar=0.05751*q-4.343*log(q)-prop.aht;

        q=(prop.wd1+prop.xd1/d)*min(((1.-0.8*exp(-d/50e3))*prop.dh*prop.wn),6283.2);
        wd=25.1/(25.1+sqrt(q));

        adiff1=ar*wd+(1.-wd)*adiff1+prop.afo;
        end

    returns adiff1, prop