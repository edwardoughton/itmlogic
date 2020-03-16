===============
Getting Started
===============

This tutorial provides explanation for the various modes available for ``itmlogic``.

Firstly a summary of the main primary parameters, secondary parameters and output values is
given.

Primary input parameters
------------------------

============= ============================
Parameters    Description
============= ============================
mdp           Controlling
dist          Distance
hg            Antenna structural heights
wn            Wave number
dh            Terrain irregularity
ens           Surface refractivity
gme           Earth's effective curvature
zgnd          Surface transfer impedance
ze            Effective antenna heights
dl            Horizon distances
the           Horizon elevation angles
============= ============================

Secondary parameters (computer in lrprop)
-----------------------------------------

=============== ============================
 Parameters     Description
=============== ============================
 dlsa           Line-of-sight distance
 dx             Scatter distance
 ael, ak1, ak2  Line-of-sight coefficients
 aed, emd       Diffraction coefficients
 aes, ems       Scatter coefficients
 dls            Smooth earth horizon distances
 dla            Total horizon distance
 tha            Total bending angle
=============== ============================

Output values
-------------

================ ============================
Output values    Description
================ ============================
 kwx             Error indicator
 aref            Reference attenuation
================ ============================


Figure 1 provides a macro personective on the program flow, subroutines, statistics etc.

Longley-Rice Irregular Terrain Model Scripts, Routines and Functions
--------------------------------------------------------------------

.. image:: _static/lritm_box_diagram.png
    :target: _static/lritm_box_diagram.png


The various prediction modes will now covered.


Area Prediction Mode
--------------------

A reproducible example for the Crystal Palace radio transmitter (South London) is provided.
Use the following to run the code:

.. code-block:: python

    python scripts/area.py

The repo already includes a Digital Elevation Model tile for London (see the .tif in the
data folder).

For simplicity, this example specifies the coordinates of the ``transmitter`` using the geojson
format (WGS84 reference system - epsg: 4326):

.. code-block:: python

    transmitter = {
        'type': 'Feature',
        'geometry': {
            'type': 'Point',
            'coordinates': (-0.07491679518573545, 51.42413477117786)
            },
        'properties': {
            'id': 'Crystal Palace radio transmitter'
            }
        }

An estimated range (``cell_range``) is also provided as a maximum cell radius (in meters).

To assess landscape elevation the ``terrain_area`` function is imported from the
``terrain_module``. The function enables the estimation of the Terrain Irregularity Parameter
(``tip``), for a cell radius of 20,000 meters (20 km):

.. code-block:: python

    tip = terrain_area(dem_path, transmitter, 20000, old_crs)

The ``tip`` is the inter-decile range for all elevation values (the range between the top
10% and bottom 10% of values). This parameter can then be passed to the ``itmlogic_area``
function:

.. code-block:: python

    output = itmlogic_area(tip)

As the ``itmlogic_area`` is used here to merely demonstrate the code functionality, a user will
need to adapt parameters to their specific scenario. For example, the user will want to
specify the specific antenna heights, frequency to be modeled and local atmospheric conditions.
In the given scenario, the propagation loss across this terrain is estimated for a certain
distance, at a specific confidence level, and returned as a list of dicts named ``output``:

.. code-block:: python

    output = [
        {
            'distance_km': 10,
            'confidence_level_%': 50,
            'propagation_loss_dB': 111.6920084
        },
        {
            'distance_km': 10,
            'confidence_level_%': 90,
            'propagation_loss_dB': 121.5943795
        },
        ...
    ]

The results are then written to a csv file in the processed data folder ('uarea_output.csv).

Point-to-Point Mode
-------------------

In contrast to the area prediction mode, the point-to-point mode focuses on a single path
across an area of irregular terrain between a transmitter and receiver. To use the
reproducible example for p2p

.. code-block:: python

    python scripts/p2p.py

The example given is based on the original radio propagation scenario used which is between
the Crystal Palace radio transmitter in South London and a receiver in the small village of
Mursley in Buckinghamshire, England. For consistency, ``itmlogic`` also uses this example,
particularly for providing tests for the codebase, to guarantee reliability.

The geojson transmitter is specified:

.. code-block:: python

    transmitter = {
        'type': 'Feature',
        'geometry': {
            'type': 'Point',
            'coordinates': (-0.07491679518573545, 51.42413477117786)
            },
        'properties': {
            'id': 'Crystal Palace radio transmitter'
            }
        }

Along with the geojson receiver:

.. code-block:: python

    receiver = {
        'type': 'Feature',
        'geometry': {
            'type': 'Point',
            'coordinates': (-0.8119433954872186, 51.94972494521946)
            },
        'properties': {
            'id': 'Mursley'
            }
        }

The terrain path is then specified as a geojson line:

.. code-block:: python

    line = {
        'type': 'Feature',
        'geometry': {
            'type': 'LineString',
            'coordinates': [
                    (
                        transmitter['geometry']['coordinates'][0],
                        transmitter['geometry']['coordinates'][1]
                    ),
                    (
                        receiver['geometry']['coordinates'][0],
                        receiver['geometry']['coordinates'][1]
                    ),
                ]
            },
        'properties': {
            'id': 'terrain path'
            }
        }

Using the ``terrain_p2p`` function from the ``terrain_module`` we can get the terrain
profile, over a set distance, with each point across the terrain profile being returned as a
geojson object.

.. code-block:: python

    measured_terrain_profile, distance_km, points = terrain_p2p(
        dem_folder, line, current_crs
        )

A list of terrain elevation values (``measured_terrain_profile``) (in meters) is returned:

.. code-block:: python

    measured_terrain_profile = [
        109, 66, 28, 48, 29, 32, 29, 20, 13, 9...
    ]

These data can then be passed to the ``itmlogic_p2p`` function along with the distance (km)
of the link:

.. code-block:: python

    output = itmlogic_p2p(original_surface_profile_m, distance_km)

The results are returned in a list of dicts called ``output`` containing the path loss over
the link distance given certain reliability and confidence levels.

.. code-block:: python

    output = [
        {
            'distance_km': 77.8,
            'reliability_level_%': 1,
            'confidence_level_%': 50,
            'propagation_loss_dB': 128.5969039310673
        },
        {
            'distance_km': 77.8,
            'reliability_level_%': 1,
            'confidence_level_%': 90,
            'propagation_loss_dB': 137.64279211442656
        },
        ...
    ]
