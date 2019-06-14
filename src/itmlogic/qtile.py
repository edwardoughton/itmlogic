import numpy as np

def qtile(nn, a, ir):
    """
    This routine returns the ith entry of vector after sorting in 
    descending order.

    Parameters
    ----------
    nn : ???
        ???
    a : list
        Input data distribution
    ir : int
        Quartile value 

    Returns
    -------
    qtile : ???
        ???

    """
    as_sorted = sorted(a)
    qtile1 = np.percentile(as_sorted, ir)

    return qtile1