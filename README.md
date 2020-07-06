# itmlogic – Longley-Rice Irregular Terrain Model

[![Build Status](https://travis-ci.org/edwardoughton/itmlogic.svg?branch=master)](https://travis-ci.org/edwardoughton/itmlogic)
[![Documentation Status](https://readthedocs.org/projects/itmlogic/badge/?version=latest)](https://itmlogic.readthedocs.io/en/latest/?badge=latest)
[![Coverage Status](https://coveralls.io/repos/github/edwardoughton/itmlogic/badge.svg?branch=master)](https://coveralls.io/github/edwardoughton/itmlogic?branch=master)
[![DOI](https://joss.theoj.org/papers/10.21105/joss.02266/status.svg)](https://doi.org/10.21105/joss.02266)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.3931350.svg)](https://doi.org/10.5281/zenodo.3931350)

Longley-Rice Irregular Terrain Model

**itmlogic** is a Python implementation of the classic Longley-Rice propagation model (v1.2.2)
and capable of estimating the signal propagation effects resulting from irregular terrain.

Software citation
-----------------

- Oughton, E.J., Russell, T., Johnson, J., Yardim, C., Kusuma, J., 2020. itmlogic:
  The Irregular Terrain Model by Longley and Rice. Journal of Open Source Software 5, 2266.
  https://doi.org/10.21105/joss.02266

Software purpose
----------------

This Python repo implements the model properties and algorithm defining it from:

* Hufford, G. A., A. G. Longley, and W. A. Kissick (1982), A guide    to the use of the ITS
  Irregular Terrain Model in the area prediction mode, NTIA Report 82-100. (NTIS Order No.
  PB82-217977)
* Hufford, G. A. (1995) The ITS Irregular Terrain Model, version 1.2.2, the Algorithm.

**itmlogic** enables you to account for the radio propagation impacts occuring from irregular
terrain (hills, mountains etc.). For example, the image below shows the terrain undulation 
between the Crystal Palace (South London) transmitter and Mursley, Buckinghamshire, England.
Such estimates enable the engineering design of many types of wireless radio systems, including 
4G and 5G Radio Access Networks and wireless backhaul connections. 

Terrain profile slice: Crystal Palace (South London) to Mursley
---------------------------------------------------------------
![Example](/docs/_static/terrain_profile.png)


## Setup and configuration

All code for ``itmlogic`` is written in Python (Python>=3.7).

See requirements.txt for a full list of dependencies.


## Conda

The recommended installation method is to use conda, which handles packages and virtual
environments, along with the conda-forge channel which has a host of pre-built libraries
and packages.

Create a conda environment called ``itmlogic``:

    conda create --name itmlogic python=3.7 gdal

Activate it (run this each time you switch projects):

    conda activate itmlogic

First, install optional packages:

    conda install numpy fiona shapely rtree rasterio pyproj tqdm pytest rasterstats pandas matplotlib

Once in the new environment, to install ``itmlogic`` clone this repository and either run:

    python setup.py install

Or:

    python setup.py develop

You can first run the tests to make sure everything is working correctly:

    python -m pytest


Quick start
-----------

If you want to quickly generate results run using point-to-point mode run:

    python scripts/p2p.py

Or using area prediction mode run:

    python scripts/area.py

Results can then be visualized using:

    python vis/vis.py


Example results - Point-to-point mode
-------------------------------------
![Example](/docs/_static/p2p_results.png)


Example results - Area mode
---------------------------
![Example](/docs/_static/area_results.png)


Documentation
-------------

For more information, see the ``itmlogic`` [readthedocs documentation](https://itmlogic.readthedocs.io/en/latest/?badge=latest).


## Background

The model was developed by the Institute for Telecommunication Sciences (ITS) for frequencies
between 20 MHz and 20 GHz (named for Anita Longley & Phil Rice, 1968), and as a general
purpose model can be applied to a large variety of engineering problems. Based on
both electromagnetic theory and empirical statistical analyses of both terrain features and
radio measurements, the Longley-Rice Irregular Terrain Model predicts the median attenuation
of a radio signal as a function of distance and the variability of signal in time and in space.

The original NTIA disclaimer states:

> The ITM software was developed by NTIA. NTIA does not make any warranty of any kind, express,
implied or statutory, including, without limitation, the implied warranty of merchantability,
fitness for a particular purpose, non-infringement and data accuracy. NTIA does not warrant or
make any representations regarding the use of the software or the results thereof, including
but not limited to the correctness, accuracy, reliability or usefulness of the software or the
results. You can use, copy, modify, and redistribute the NTIA-developed software upon your
acceptance of these terms and conditions and upon your express agreement to provide appropriate
acknowledgments of NTIA's ownership of and development of the software by keeping this exact
text present in any copied or derivative works.


## Thanks for the support

**itmlogic** was written and developed at the [Environmental Change Institute, University of
Oxford](http://www.eci.ox.ac.uk) within the EPSRC-sponsored MISTRAL programme (EP/N017064/1),
as part of the [Infrastructure Transition Research Consortium](http://www.itrc.org.uk/)

## Contributors
- Edward J. Oughton (University of Oxford)
- Tom Russell (University of Oxford)
- Joel Johnson (The Ohio State University)
- Caglar Yardim (The Ohio State University)
- Julius Kusuma (Facebook Research)

If you find an error or have a question, please submit an issue.

## Folder structure

The folder structure for the ``itmlogic`` package is summarized as follows, and matches the
box diagram highlighted in both the JOSS paper and the documentation:

    +---src
    |   +---itmlogic
    |   |   |   lrprop.py
    |   |   |   __init__.py
    |   |   |
    |   |   +---diffraction_attenuation
    |   |   |       adiff.py
    |   |   |       aknfe.py
    |   |   |       fht.py
    |   |   |
    |   |   +---los_attenuation
    |   |   |       alos.py
    |   |   |
    |   |   +---misc
    |   |   |       qerf.py
    |   |   |       qerfi.py
    |   |   |       qtile.py
    |   |   |
    |   |   +---preparatory_subroutines
    |   |   |       dlthx.py
    |   |   |       hzns.py
    |   |   |       qlra.py
    |   |   |       qlrpfl.py
    |   |   |       qlrps.py
    |   |   |       zlsq1.py
    |   |   |
    |   |   +---scatter_attenuation
    |   |   |       ahd.py
    |   |   |       ascat.py
    |   |   |       h0f.py
    |   |   |
    |   |   +---statistics
    |   |   |       avar.py
    |   |   |       curv.py
