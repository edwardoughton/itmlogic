def zlsq1(z, x1, x2):
    """
    A linear least squares fit between x1 and x2, to the function described
    by the array z.

    Evaluates a least squares fit to an input function z (in the form of a terrain profile
    having first element the number of profile samples, second element the spacing between
    them, and third through end elements the profile data) between horizontal locations
    x1 and x2.  Returns the interpolated heights at location 0 and the end of the
    profile.

    Parameters
    ----------
    z : list
        Terrain profile in meters.
    x1 : float
        Location 1.
    x2 : float
        Location 2.

    Returns
    -------
    z0 : float
        Interpolated height.
    zn : float
        Interpolated height.

    """
    xn = z[0]

    xa = int(max(x1 / z[1], 0))
    xb = xn - int(max(xn - x2 / z[1], 0))

    if xb <= xa:
        xa = max(xa - 1, 0)
        xb = xn - max(xn - xb + 1, 0)

    ja = xa
    jb = xb
    n = jb - ja
    xa = xb - xa
    x = -0.5 * xa
    xb = xb + x

    a = 0.5 * (z[(ja + 2)] + z[jb + 2])
    b = 0.5 * (z[ja + 2] - z[jb + 2]) * x

    for i in range(2, n + 1):
        ja = ja + 1
        x = x + 1
        a = a + z[ja + 2]
        b = b + z[ja + 2] * x

    a = avoid_zero_division(a, xa)
    b = b * 12 / ((xa * xa + 2) * xa)

    z0 = a - b * xb
    zn = a + (b * (xn - xb))

    return z0, zn


def avoid_zero_division(n, d):
    return n / d if d else 0
