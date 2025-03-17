def curv(c1, c2, x1, x2, x3, de):
    """
    Evaluates empirical curve fits used in the computation of the Vmd, sigma_T-, and sigma_T+
    for estimating time variability effects as a function of the climatic region, as described
    in equations (5.5) through (5.7) of of "The ITS Irregular Terrain Model, version 1.2.2:
    The Algorithm" and as captured in Figure 10.13 of NBS Technical Note 101.

    """
    cout = (
        (c1 + c2 / (1 + ((de - x2) / x3) ** 2))
        * ((de / x1) ** 2)
        / (1 + ((de / x1) ** 2))
    )

    return cout
