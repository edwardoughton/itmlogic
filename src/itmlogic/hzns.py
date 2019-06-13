def hzns(pfl, dist, hg, gme):
    """
    Find horizons

    Parameters
    ----------
    pfl : ??
        ???
    dist : float
        Distance
    hg : ???
        ???
    gme : ???
        ???

    Returns
    -------
    the : ???
        ???
    dl : ???
        ???

    """
    the = {}
    dl = {}

    #TODO: check the indexing differences between Matlab/Python!
    np = pfl[0]
    xi = pfl[1]
    za = pfl[2] + hg[0]  
    zb = pfl[np + 2] + hg[1] 
    qc = 0.5 * gme
    q = qc * dist
    the[1] = (zb - za) / dist
    the[0] = the[1] - q
    the[1] = -the[1] - q 
    dl[0]  = dist
    dl[1]  = dist

    if np >= 2:
        sa = 0
        sb = dist
        wq = 1

        for i in range(2, np):
            sa = sa + xi
            sb = sb - xi

            q = pfl[i+1] - (qc * sa + the[1]) * sa - za
            
            if q > 0:
                the[1] = (the[1] + q / sa)
                dl[1] = sa
                wq = 0

            if wq == 0:
                q = pfl[i + 2] - (qc * sb + the[2]) * sb - zb
                if q > 0:
                    the[2] = the[2] + q / sb
                    dl[2] = sb
    
    return the, dl