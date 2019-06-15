import numpy as np

def fht(x,pk):
    """
    ???

    Parameters
    ----------
    x : ???
        ???
    pk : ???
        ???

    Returns
    -------
    fht1 : ???
        ???

    """
    if x < 200:
        w = -np.log(pk)

    if pk < 1e-5) or (x*w**3) > 5495:
        fht1 = -117
        if x > 1:
            fht1 = 17.372 * np.log(x) + fht1

    else:
        fht1 = 2.5e-5 * x**2 / pk - 8.686 * w - 15

    else:
    fht1 = 0.05751 * x - 4.343 * np.log(x)

    if x < 2000:
        w = 0.0134 * x * exp(-0.005 * x)
        fht1 = (1 - w) * fht1 + w * (17.372 * np.log(x) - 117)

    return fht1