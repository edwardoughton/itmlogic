===============
Getting Started
===============

This brief tutorial can help you get ``itmlogic`` working really quickly.

Area Prediction Mode
--------------------

A reproducible example for the Crystal Palace radio transmitter (South London) is provided:

.. code-block:: python

    python scripts/uarea.py

The repo includes a Digital Elevation Model tile for London (see the .tif in the data folder).

Firstly, the coordinates of the transmitter are provided using the geojson format (WGS84
reference system - epsg: 4326), along with an estimated range (in meters) as a maximum
cell radius.

The ``terrain_area`` function is imported from the ``terrain_module`` and we can get the
necessary Terrain Irregularity Parameter (``tip``) as follows:

.. code-block:: python

    tip = terrain_area(dem_path, transmitter, 20000, old_crs)

The ``tip`` is the inter-decile range for all elevation values (the range between the top
10% and bottom 10% of values) and then be passed to the ``itmlogic`` function:

.. code-block:: python

    output = run_itmlogic(tip)

The propagation loss across this terrain is then estimated for a certain distance, at a
specific confidence level, and returned as a list of dicts named ``output``:

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











Create a NetworkManager
-----------------------

The :class:`cdcam.model.NetworkManager` object represents the whole system under simulation.

It requires the following inputs:

- local authority districts (LADS)
- postcode sectors
- assets
- capacity_lookup_table
- clutter_lookup
- simulation_parameters

A local authority district (upper level statistical unit) needs to contain
name and id fields, and be part of a list of dictionaries:

.. code-block:: python

    lads = [
            {
                "id": "E07000008",
                "name": "Cambridge",
            },
            ...
        ]

Equally, each postcode sector (lower level statistical unit) must contain the
upper level lad id (lad_id), the area in kilometers square (area_km2),
postcode sector id (id), average user data consumption (user_throughput), and
population for the timestep being modelled, as follows:

.. code-block:: python

    pcd_sectors = [
            {
                "id": "CB11",
                "lad_id": "E07000008",
                "population": 5000,
                "area_km2": 2,
                "user_throughput": 2,
            },
            {
                "id": "CB12",
                "lad_id": "E07000008",
                "population": 20000,
                "area_km2": 2,
                "user_throughput": 2,
            },
            ...
        ]

Existing cell site data is required, which is referred to here as the initial
system. Each cell site needs to contain the current cellular generation present
(technology) such as 4G, the type of cell site (type), the date the site was
built (build_date), the site id (site_ngr), the frequencies deployed (frequency)
and the postcode sector id which the site is within (pcd_sector):

.. code-block:: python

    initial_system =  [
            {
                "pcd_sector": "CB11",
                "site_ngr": "site_100",
                "technology": "",
                "type": "macrocell_site",
                "frequency": [],
                "bandwidth": "",
                "build_date": 2012,
                "sectors": 3,
                'opex': 10000,
            },
            {
                "pcd_sector": "CB12",
                "site_ngr": "site_200",
                "technology": "",
                "type": "macrocell_site",
                "frequency": [],
                "bandwidth": "",
                "build_date": 2012,
                "sectors": 3,
                'opex': 10000,
            },
            ...
        ]

The capacity lookup table needs to be loaded as follows:

.. code-block:: python

    capacity_lookup_table = {
            ('urban', 'macro', '3700', '40', '5G'): [
                (0.11276372445109878, 5.101430894167686),
                (0.20046884346862007, 21.097341086638664),
                (0.4510548978043951, 79.9233194517426),
                (1.8042195912175805, 319.6932778071853)
            ],
            ...
        }

The clutter lookup table details the population densities which represent
different urban, suburban or rural environments:

.. code-block:: python

    clutter_lookup = [
            (0.0, 'rural'),
            (782.0, 'suburban'),
            (7959.0, 'urban')
        ]

A dictionary of simulation parameters is required containing annual budget, market share,
any frequency bandwidths etc.:

.. code-block:: python

    simulation_parameters = {
            'annual_budget': 1e6,
            'market_share': 0.3,
            'channel_bandwidth_700': '10'
        }

And then create a :class:`~cdcam.model.NetworkManager` called system:

.. code-block:: python

    system = NetworkManager(lads, pcd_sectors, assets, capacity_lookup_table,
                            clutter_lookup, simulation_parameters)

Now you can begin testing interventions!

Decide interventions
--------------------

Once the :class:`~cdcam.model.NetworkManager` has been created, the
:func:`~cdcam.interventions.decide_interventions` function can then be imported and used from
:py:mod:`cdcam.interventions`

The :func:`~cdcam.interventions.decide_interventions` function requires the following inputs:

- strategy
- budget
- service_obligation_capacity
- system
- timestep
- simulation_parameters

The strategy is a string such as:

.. code-block:: python

    'small-cell'

and the budget is an integer such as:

.. code-block:: python

    500000000

The service obligation is dependent on whether one is specified. If not just use zero:

.. code-block:: python

    0

The :class:`~cdcam.model.NetworkManager` object created earlier can be passed as the system.

The timestep can be passed as an integer as follows:

.. code-block:: python

    2020

And a dictionary of simulation parameters can also be passed:

.. code-block:: python

    simulation_parameters = {
            'annual_budget': 1e6,
            'market_share': 0.3,
            'channel_bandwidth_700': '10'
        }

For each time period, :func:`~cdcam.interventions.decide_interventions` will return three items
including:

- a list of built interventions
- the remaining budget
- the amount of capital spent

The list of built interventions for the small cell strategy will look as follows:

.. code-block:: python

    print(interventions_built)

    [
        {
            'site_ngr': 'small_cell_site',
            'frequency': ['3700', '26000'],
            'technology': '5G',
            'type': 'small_cell',
            'bandwidth': ['50', '200'],
            'build_date': 2022,
            'pcd_sector': 'CB12',
            'lad_id': 'E07000008',
            'population_density': 110000.0
        },
        ...
    ]


Results
-------

To obtain results, we can then add the newly built interventions to the existing assets:

.. code-block:: python

    assets += interventions_built

And then create an updated :class:`~cdcam.model.NetworkManager` which includes new assets:

.. code-block:: python

    system = NetworkManager(lads, pcd_sectors, assets, capacity_lookup_table,
                            clutter_lookup, simulation_parameters)

New results can then be obtained by calling methods belonging to each :class:`~cdcam.model.LAD`
or :class:`~cdcam.model.PostcodeSector` object:

.. code-block:: python

    for lad in system.lads.values():
        print('{}:'.format(lad.name))
        print(' ')
        print('-- Demand (Mbps km^2): {},'.format(round(lad.demand())))
        print('-- Capacity (Mbps km^2): {}'.format(round(lad.capacity())))

Which results in the new estimated data demand and capacity of the cellular Radio Access
Network in Megabits Per Second (Mbps) per squared kilometers (km^2):

.. code-block:: python

    Cambridge:

    -- Demand (Mbps km^2): 601,
    -- Capacity (Mbps km^2): 475

So Cambridge


Preprocessing
-------------

To reproduce data preparation, run ``scripts/preprocess.py``. This will take three or four
hours. The results of this step are provided in the ``intermediate`` folder.

Running the script should produce output as follows:


.. code-block:: bash

    $ python scripts/preprocess.py
    Output directory will be data\intermediate
    Loading local authority district shapes
    Loading lad lookup
    Loading postcode sector shapes
    Adding lad IDs to postcode sectors... might take a few minutes...
    100%|██████████████████████████████████████████| 9232/9232 [06:06<00:00, 25.16it/s]
    Subset Arc shapes
    complete
    Loading in population weights
    Adding weights to postcode sectors
    Calculating lad population weight for each postcode sector
    Generating scenario variants
    Checking total GB population
    Total GB population is 62436917.0
    loaded luts
    running arc_population__baseline.csv
    writing pcd_arc_population__baseline.csv
    running arc_population__0-unplanned.csv
    writing pcd_arc_population__0-unplanned.csv
    running arc_population__1-new-cities-from-dwellings.csv
    writing pcd_arc_population__1-new-cities-from-dwellings.csv
    running arc_population__2-expansion.csv
    writing pcd_arc_population__2-expansion.csv
    running arc_population__3-new-cities23-from-dwellings.csv
    writing pcd_arc_population__3-new-cities23-from-dwellings.csv
    running arc_population__4-expansion23.csv
    writing pcd_arc_population__4-expansion23.csv
    Disaggregate 4G coverage to postcode sectors
    Importing sitefinder data
    Preprocessing sitefinder data with 50m buffer
    100%|██████████████████████████████████████████| 139741/139741 [3:43:52<00:00, 10.40it/s]
    Allocate 4G coverage to sites from postcode sectors
    100%|██████████████████████████████████████████| 8964/8964 [00:21<00:00, 411.90it/s]
    Convert geojson postcode sectors to list of dicts
    Specifying clutter geotypes
    Writing postcode sectors to .csv
    Writing processed sites to .csv
    time taken: 232 minutes
