.. itmlogic documentation master file, created by
   sphinx-quickstart on Mon Feb 17 18:32:00 2020.
   You can adapt this file completely to your liking, but it should at least
   contain the root `toctree` directive.

itmlogic - Longley-Rice Irregular Terrain Model
===================================================

.. image:: https://readthedocs.org/projects/itmlogic/badge/?version=latest
    :target: https://itmlogic.readthedocs.io/en/latest/?badge=latest
    :alt: Documentation Status

Welcome to the documentation for itmlogic!

These docs will focus on the python implementation of the Longley Rice model. For in-depth
detail on the engineering model you should refer to the original Longley Rice documents.

Description
===========

The Longley-Rice Irregular Terrain Model is one of the classic radio propagation models. The
model is still widely used, particularly in industry. In comparison with other radio models,
Longley-Rice accounts for various physical effects that result from irregular terrain.

The itmlogic repo provides a Python version of this classic model and enables users to easily
incorporate terrain effects into their analysis.

Statement of Need
=================

Many engineering models for wireless networks completely ignore terrain effects. While
software packages are available to address this, they usually need to be commerically licensed.
Those that are open-source are usually in less commonly used languages such as Fortran.
This open-source python package overcomes these limitations by providing an easy-to-use Python
version.

Setup and configuration
=======================

All code for ``itmlogic`` is written in Python (Python>=3.7).

See requirements.txt for a full list of dependencies.

Conda
=====

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
===========

If you want to quickly generate results run using area prediction mode:

    python scripts/uarea.py

or using point-to-point mode:

    python scripts/qkpfl.py

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
