import math
import numpy as np

def aknfe(v2):
    """
    Returns knife edge diffraction loss 

    Parameters
    ----------
    v2 : ??
        ???

    Returns
    -------
    aknfe1 : ???
        ???

    """
    if v2 < 5.76:
        
        aknfe1 = 6.02 + 9.11 * math.sqrt(v2) - 1.27 * v2
    
    else:
    
        aknfe1 = 12.953 + 4.343 * np.log(v2)
    
    return aknfe1