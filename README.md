itmlogic
====
[![Coverage Status](https://coveralls.io/repos/github/edwardoughton/itmlogic/badge.svg?branch=master)](https://coveralls.io/github/edwardoughton/itmlogic?branch=master)

Longley-Rice Irregular Terrain Model

**itmlogic** is a Python implementation of the Longley-Rice propagation model
(v1.2.2) and capable of estimating the propagation effects resulting from
irregular terrain.

Model properties and the algorithm defining it are available in:

* Hufford, G. A., A. G. Longley, and W. A. Kissick (1982), A guide    to the use of the ITS Irregular Terrain Model in the area
  prediction mode, NTIA Report 82-100. (NTIS Order No. PB82-217977)

* Hufford, G. A. (1995) The ITS Irregular Terrain Model, version
  1.2.2, the Algorithm.

Setup and configuration
-----------------------

All code for ``itmlogic`` is written in Python (Python>=3.7).

See requirements.txt for a full list of dependencies.

Conda
-----

The recommended installation method is to use conda, which handles packages and virtual environments, along with the conda-forge channel which has a host of pre-built libraries and packages.

Create a conda environment called ``itmlogic``:

    conda create --name itmlogic python=3.7

Activate it (run this each time you switch projects):

    conda activate itmlogic

First, install optional packages:

    conda install numpy fiona shapely rtree rasterio pyproj tqdm

Then install itmlogic:

    pip install itmlogic

Alternatively, for development purposes, clone this repository and run:

    python setup.py develop

Install test/dev requirements:

    conda install pytest pytest-cov

Run the tests:

    pytest --cov-report=term --cov=itmlogic tests/

Thanks for the support
======================

**itmlogic** was written and developed at the `Environmental Change Institute, University of Oxford <http://www.eci.ox.ac.uk>`_ within the EPSRC-sponsored MISTRAL programme, as part of the `Infrastructure Transition Research Consortium <http://www.itrc.org.uk/>`_.
