# itmlogic – Longley-Rice Irregular Terrain Model

[![Build Status](https://travis-ci.org/edwardoughton/itmlogic.svg?branch=master)](https://travis-ci.org/edwardoughton/itmlogic)
[![Documentation Status](https://readthedocs.org/projects/itmlogic/badge/?version=latest)](https://itmlogic.readthedocs.io/en/latest/?badge=latest)
[![Coverage Status](https://coveralls.io/repos/github/edwardoughton/itmlogic/badge.svg?branch=master)](https://coveralls.io/github/edwardoughton/itmlogic?branch=master)

Longley-Rice Irregular Terrain Model

**itmlogic** is a Python implementation of the classic Longley-Rice propagation model (v1.2.2)
and capable of estimating the signal propagation effects resulting from irregular terrain.

This Python repo implements the model properties and algorithm defining it from:

* Hufford, G. A., A. G. Longley, and W. A. Kissick (1982), A guide    to the use of the ITS
  Irregular Terrain Model in the area prediction mode, NTIA Report 82-100. (NTIS Order No.
  PB82-217977)
* Hufford, G. A. (1995) The ITS Irregular Terrain Model, version 1.2.2, the Algorithm.

**itmlogic** enables you to account for the radio propagation impacts arising from irregular
terrain. For example, the image below shows the terrain implications arising between the
Crystal Palace (South London) transmitter and Mursley, Buckinghamshire, England.

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

    conda install numpy fiona shapely rtree rasterio pyproj tqdm pytest

For development purposes, clone this repository and run:

    python setup.py develop

Run the tests:

    python -m pytest


Quick start
-----------

If you want to quickly generate results run using point-to-point mode:

    python scripts/qkpfl.py

Or using area prediction mode:

    python scripts/uarea.py


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
Oxford](http://www.eci.ox.ac.uk) within the EPSRC-sponsored MISTRAL programme (	EP/N017064/1),
as part of the [Infrastructure Transition Research Consortium](http://www.itrc.org.uk/)

## Contributors
- Edward J. Oughton (University of Oxford)
- Tom Russell (University of Oxford)
- Joel Johnson (The Ohio State University)
- Caglar Yardim (The Ohio State University)
- Julius Kusuma (Facebook Research)

If you find an error or have a question, please submit an issue.
