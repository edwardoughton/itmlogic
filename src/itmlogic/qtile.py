import numpy as np

def qtile(a, ir):
    """
    This routine returns the ith entry of vector after sorting in
    descending order.

    Parameters
    ----------
    a : list
        Input data distribution
    ir : int
        Quartile value

    Returns
    -------
    qtile : ???
        ???

    """
    as_sorted = sorted(a, reverse=True)
    qtile1 = as_sorted[ir]

    return qtile1
