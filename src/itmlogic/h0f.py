def h0f(r, et):
    """
    ???

    Parameters
    ----------
    r : ???
        ???
    et : ???
        ???

    Returns
    -------
    h0f1 : ???
        ???

    """
    a = [25, 80, 177, 395, 705]
    b = [24, 45, 68, 80, 105]

    it = int(et)

    if it <= 0:
        it = 1
        q = 0

    elif it >= 5:
        it = 5
        q = 0

    else:
        q = et - it
    
    x = (1 / r)**2
    h0f1 = 4.343 * np.log((a(it) * x + b(it)) * x + 1)

    if q != 0:
        h0f1 = (
            (1 - q) * h0f1 + q * 4.343 * 
            np.log((a(it + 1) * x + b(it + 1)) * x + 1)
            )

    return h0f1