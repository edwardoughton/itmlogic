from itmlogic.qtile import qtile
from itmlogic.zlsq1 import zlsq1

def dlthx(pfl1, x1, x2):
    """
    Find delta h

    Parameters
    ----------
    pfl1 : ???
        ???
    x1 : ???
        ???
    x2 : ???
        ???

    Returns
    -------
    dlthx1 : ???
        ???

    """
    #Calls qtile and zlsq1

    np = pfl[0]
    xa = x1 / pfl[1]
    xb = x2 / pfl[1]
    dlthx1 = 0

    s = []

    if (xb - xa) >= 2:
        ka  = int(0.1 * (xb - xa + 8))
        ka  = min(max(4, ka), 25)
        n   = 10 * ka - 5
        kb  = n - ka + 1
        sn  = n - 1
        s[0]= sn
        s[1]= 1
        xb  = (xb - xa) / sn
        k   = int(xa + 1)
        xa  = xa - k

    for j in range(0, n):

        while xa > 0 and k < np:
            xa = xa - 1
            k = k + 1

        s[j+1] = pfl[k+2] + pfl[k+2] - pfl[k + 1] * xa
        xa = xa + xb

    xa, xb = zlsq1(s, 0, sn)
    xb = (xb - xa) / sn
    for j range(0, n):
        s[j+1] = s[j + 1] - xa
        xa = xa + xb
    

    dlthx1 = qtile(n, s[2:-1], ka) - qtile(n, s[2:-1], kb)
    dlthx1 = dlthx1 / (1 - 0.8 * exp(-(x2 - x1) / 50e3))
    
    return dlthx1

