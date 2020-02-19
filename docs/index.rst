.. itmlogic documentation master file, created by
   sphinx-quickstart on Mon Feb 17 18:32:00 2020.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

itmlogic - Longley-Rice Irregular Terrain Model
=======================================================================

.. image:: https://readthedocs.org/projects/itmlogic/badge/?version=latest
    :target: https://itmlogic.readthedocs.io/en/latest/?badge=latest
    :alt: Documentation Status

.. image:: https://travis-ci.com/edwardoughton/itmlogic.svg?branch=master
    :target: https://travis-ci.org/edwardoughton/itmlogic
    :alt: Build Status

.. image:: https://coveralls.io/repos/github/edwardoughton/itmlogic/badge.svg?branch=master
    :target: https://coveralls.io/github/edwardoughton/itmlogic?branch=master
    :alt: Coverage Status

.. image:: https://img.shields.io/badge/github-itmlogic-brightgreen
    :target: https://github.com/edwardoughton/itmlogic
    :alt: Source Code


Welcome to the documentation for itmlogic!

These docs provide an overview of the python implementation of the classic Longley Rice
propagation model. For in-depth detail on the engineering model we advise you to refer to the
original Longley Rice documents provided in the repo folder named `References`.

Description
===========

The Longley-Rice Irregular Terrain Model is one of the classic radio propagation models. The
model is still widely used, particularly in industry. In comparison with other radio models,
Longley-Rice accounts for various physical effects that result from irregular terrain.

Statement of Need
=================

Many engineering models for wireless networks completely ignore terrain effects. While
software packages are available to address this, they usually need to be commerically licensed.
Those that are open-source are usually in less commonly used languages such as Fortran.
This open-source python package overcomes these limitations by providing an easy-to-use Python
version. Given the popularity of Python, there is a need for an easy-to-use Python version of
this model.

Setup and configuration
=======================

All code for ``itmlogic`` is written in Python (Python>=3.7).

See requirements.txt for a full list of dependencies.

Conda
=====

The recommended installation method is to use conda, which handles packages and virtual
environments, along with the conda-forge channel which has a host of pre-built libraries
and packages.

Create a conda environment called ``itmlogic`` type:

    conda create --name itmlogic python=3.7 gdal

Activate it (run this each time you switch projects):

    conda activate itmlogic

Install any optional packages:

    conda install numpy fiona shapely rtree rasterio pyproj tqdm pytest

For development purposes, clone this repository and run:

    python setup.py develop

Run the tests:

    python -m pytest

Quick start
===========

If you want to quickly generate results run using area prediction mode type:

    python scripts/area.py

Or using point-to-point mode type:

    python scripts/p2p.py

Contents
========

.. toctree::
   :maxdepth: 3

   Getting Started <getting-started>
   Reference <api/modules>

.. toctree::
   :maxdepth: 1

   License <license>
   Authors <authors>

Make Contact
============

- Report bugs, suggest features or view the source code `on GitHub`_.
    .. _on GitHub: https://github.com/edwardoughton/itmlogic
