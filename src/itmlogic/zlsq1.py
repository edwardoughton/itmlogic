

def zlsq1(z, x1, x2):
    """
    A linear least squares fit between x1 and x2, to the function described
    by the array z.

    Parameters
    ----------
    z : ???
        ???
    x1 : ???
        ???
    x2 : ???
        ???

    Returns
    -------
    z0 : ???
        ???
    zn : ???
        ???

    """
    xn  = z[0]

    xa  = int(max(x1 / z[1], 0))
    xb  = xn - int(max(xn - x2 / z[1], 0))

    if xb <= xa:
        xa = max(xa - 1, 0)
        xb = xn - max(xn - xb + 1, 0)

    ja = xa
    jb = xb
    n  = jb - ja
    xa = xb - xa
    x  = -0.5 * xa
    xb = xb + x

    a  = 0.5 * (z[(ja + 2)] + z[jb + 2])
    b  = 0.5 * (z[ja + 2] - z[jb + 2]) * x

    for i in range(1, n):
        ja = ja + 1
        x  = x + 1
        a  = a + z[ja + 2]
        b  = b + z[ja + 2] * x

    a = avoid_zero_division(a, xa)
    b = b * 12 / ((xa * xa + 2) * xa)

    z0 = a - b * xb
    zn = a + b * (xn - xb)

    return z0, zn

def avoid_zero_division(n, d):
    return n / d if d else 0
