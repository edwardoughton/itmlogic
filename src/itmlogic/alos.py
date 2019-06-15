import math

def alos(d, prop):
    """

    """
    q = (1 - 0.8 * exp(-d / 50e3)) * prop['dh']

    s = 0.78 * q * exp(-(q / 16)**0.25)

    q = prop['he'][0] + prop['he'][1]
    
    sps = q / math.sqrt(d**2 + q**2)

    r = (
        (sps - prop['zgnd']) / 
        (sps + prop['zgnd']) * 
        exp(-min(10, prop['wn'] * s * sps))
        )

    q = abs(r)**2
    
    if q < 0.25 or q < sps:
        r = r * math.sqrt(sps / q)

    alos1  = prop['emd'] * d + prop['aed']

    q = prop['wn'] * prop['he'][0] * prop['he'][1] * 2 / d

    if q > 1.57:
        q = 3.14 - 2.4649 / q

    #TODO Complex number
    alos1 = (
        -4.343 * 
        np.log(abs(complex(math.cos(q),-math.sin(q)) + r)**2)- alos1) * 
        prop['wis'] + alos1
        )

    return alos1