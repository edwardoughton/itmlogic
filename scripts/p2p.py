"""
Point to Point prediction mode runner.

Referred to as qkpfl in the original Fortran codebase.

Written by Ed Oughton

June 2019

"""

import configparser
import os
import csv
import math
import numpy as np
from functools import partial
from collections import OrderedDict

import fiona
from fiona.crs import from_epsg
from pyproj import Transformer
from shapely.geometry import LineString, mapping
from shapely.ops import transform

from itmlogic.misc.qerfi import qerfi
from itmlogic.preparatory_subroutines.qlrpfl import qlrpfl
from itmlogic.statistics.avar import avar
from terrain_module import terrain_p2p

# #set up file paths
CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), "script_config.ini"))
BASE_PATH = CONFIG["file_locations"]["base_path"]

DATA_PROCESSED = os.path.join(BASE_PATH, "processed")
RESULTS = os.path.join(BASE_PATH, "..", "results")


def itmlogic_p2p(main_user_defined_parameters, surface_profile_m):
    """
    Run itmlogic in point to point (p2p) prediction mode.

    Parameters
    ----------
    main_user_defined_parameters : dict
        User defined parameters.
    surface_profile_m : list
        Contains surface profile measurements in meters.

    Returns
    -------
    output : list of dicts
        Contains model output results.

    """
    prop = main_user_defined_parameters

    # DEFINE ENVIRONMENTAL PARAMETERS
    # Terrain relative permittivity
    prop["eps"] = 15

    # Terrain conductivity (S/m)
    prop["sgm"] = 0.005

    # Climate selection (1=equatorial,
    # 2=continental subtropical, 3=maritime subtropical,
    # 4=desert, 5=continental temperate,
    # 6=maritime temperate overland,
    # 7=maritime temperate, oversea (5 is the default)
    prop["klim"] = 5

    # Surface refractivity (N-units): also controls effective Earth radius
    prop["ens0"] = 314

    # DEFINE STATISTICAL PARAMETERS
    # Confidence  levels for predictions
    qc = [50, 90, 10]

    # Reliability levels for predictions
    qr = [1, 10, 50, 90, 99]

    # Number of points describing profile -1
    pfl = []
    pfl.append(len(surface_profile_m) - 1)
    pfl.append(0)

    for profile in surface_profile_m:
        pfl.append(profile)

    # Refractivity scaling ens=ens0*exp(-zsys/9460.)
    # (Average system elev above sea level)
    zsys = 0

    # Note also defaults to a continental temperate climate

    # Setup some intermediate quantities
    # Initial values for AVAR control parameter: LVAR=0 for quantile change,
    # 1 for dist change, 2 for HE change, 3 for WN change, 4 for MDVAR change,
    # 5 for KLIM change
    prop["lvar"] = 5

    # Inverse Earth radius
    prop["gma"] = 157e-9

    # Conversion factor to db
    db = 8.685890

    # Number of confidence intervals requested
    nc = len(qc)

    # Number of reliability intervals requested
    nr = len(qr)

    # Length of profile in km
    dkm = prop["d"]

    # Profile range step, select option here to define range step from profile
    # length and # of points
    xkm = 0

    # If DKM set <=0, find DKM by mutiplying the profile step by number of
    # points (not used here)
    if dkm <= 0:
        dkm = xkm * pfl[0]

    # If XKM is <=0, define range step by taking the profile length/number
    # of points in profile
    if xkm <= 0:

        xkm = dkm // pfl[0]

        # Range step in meters stored in PFL(2)
        pfl[1] = dkm * 1000 / pfl[0]

        # Store profile in prop variable
        prop["pfl"] = pfl
        # Zero out error flag
        prop["kwx"] = 0
        # Initialize omega_n quantity
        prop["wn"] = prop["fmhz"] / 47.7
        # Initialize refractive index properties
        prop["ens"] = prop["ens0"]

    # Scale this appropriately if zsys set by user
    if zsys != 0:
        prop["ens"] = prop["ens"] * math.exp(-zsys / 9460)

    # Include refraction in the effective Earth curvature parameter
    prop["gme"] = prop["gma"] * (1 - 0.04665 * math.exp(prop["ens"] / 179.3))

    # Set surface impedance Zq parameter
    zq = complex(prop["eps"], 376.62 * prop["sgm"] / prop["wn"])

    # Set Z parameter (h pol)
    prop["zgnd"] = np.sqrt(zq - 1)

    # Set Z parameter (v pol)
    if prop["ipol"] != 0:
        prop["zgnd"] = prop["zgnd"] / zq

    # Flag to tell qlrpfl to set prop.klim=prop.klimx and set lvar to initialize avar routine
    prop["klimx"] = 0

    # Flag to tell qlrpfl to use prop.mdvar=prop.mdvarx and set lvar to initialize avar routine
    prop["mdvarx"] = 11

    # Convert requested reliability levels into arguments of standard normal distribution
    zr = qerfi([x / 100 for x in qr])
    # Convert requested confidence levels into arguments of standard normal distribution
    zc = qerfi([x / 100 for x in qc])

    # Initialization routine for point-to-point mode that sets additional parameters
    # of prop structure
    prop = qlrpfl(prop)

    # Here HE = effective antenna heights, DL = horizon distances,
    # THE = horizon elevation angles
    # MDVAR = mode of variability calculation: 0=single message mode,
    # 1=accidental mode, 2=mobile mode, 3 =broadcast mode, +10 =point-to-point,
    # +20=interference

    # Free space loss in db
    fs = db * np.log(2 * prop["wn"] * prop["dist"])

    # Used to classify path based on comparison of current distance to computed
    # line-of-site distance
    q = prop["dist"] - prop["dlsa"]

    # Scaling used for this classification
    q = max(q - 0.5 * pfl[1], 0) - max(-q - 0.5 * pfl[1], 0)

    # Report dominant propagation type predicted by model according to parameters
    # obtained from qlrpfl
    if q < 0:
        print("Line of sight path")
    elif q == 0:
        print("Single horizon path")
    else:
        print("Double-horizon path")
    if prop["dist"] <= prop["dlsa"]:
        print("Diffraction is the dominant mode")
    elif prop["dist"] > prop["dx"]:
        print("Tropospheric scatter is the dominant mode")

    print("Estimated quantiles of basic transmission loss (db)")
    print("Free space value {} db".format(str(fs)))

    print("Confidence levels {}, {}, {}".format(str(qc[0]), str(qc[1]), str(qc[2])))

    # Confidence  levels for predictions
    qc = [50, 90, 10]

    # Reliability levels for predictions
    qr = [1, 10, 50, 90, 99]

    output = []
    for jr in range(0, (nr)):
        for jc in range(0, nc):
            # Compute corrections to free space loss based on requested confidence
            # and reliability quantities
            avar1, prop = avar(zr[jr], 0, zc[jc], prop)
            output.append(
                {
                    "distance_km": prop["d"],
                    "reliability_level_%": qr[jr],
                    "confidence_level_%": qc[jc],
                    "propagation_loss_dB": fs
                    + avar1,  # Add free space loss and correction
                }
            )

    return output


def csv_writer(data, directory, filename):
    """
    Write data to a CSV file path.

    Parameters
    ----------
    data : list of dicts
        Data to be written.
    directory : string
        Folder to write the results to.
    filename : string
        Name of the file to write.

    """
    # Create path
    if not os.path.exists(directory):
        os.makedirs(directory)

    fieldnames = []
    for name, value in data[0].items():
        fieldnames.append(name)

    with open(os.path.join(directory, filename), "w") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames, lineterminator="\n")
        writer.writeheader()
        writer.writerows(data)


def write_shapefile(data, directory, filename, crs):
    """
    Write geojson data to shapefile.

    Parameters
    ----------
    data : list of dicts
        Data to be written.
    directory : string
        Folder to write the results to.
    filename : string
        Name of the file to write.
    crs : string
        Defines the coordinate reference system.

    """
    prop_schema = []
    for name, value in data[0]["properties"].items():
        fiona_prop_type = next(
            (
                fiona_type
                for fiona_type, python_type in fiona.FIELD_TYPES_MAP.items()
                if python_type == type(value)
            ),
            None,
        )

        prop_schema.append((name, fiona_prop_type))

    sink_driver = "ESRI Shapefile"
    sink_crs = {"init": crs}
    sink_schema = {
        "geometry": data[0]["geometry"]["type"],
        "properties": OrderedDict(prop_schema),
    }

    if not os.path.exists(directory):
        os.makedirs(directory)

    with fiona.open(
        os.path.join(directory, filename),
        "w",
        driver=sink_driver,
        crs=sink_crs,
        schema=sink_schema,
    ) as sink:
        for datum in data:
            sink.write(datum)


def straight_line_from_points(a, b):
    """
    Generate a geojson LineString object from two geojson points.

    Parameters
    ----------
    a : geojson
        Point A
    b : geojson
        Point B

    Returns
    -------
    line : geojson
        A geojson LineString object.

    """
    line = {
        "type": "Feature",
        "geometry": {
            "type": "LineString",
            "coordinates": [
                (a["geometry"]["coordinates"][0], a["geometry"]["coordinates"][1]),
                (b["geometry"]["coordinates"][0], b["geometry"]["coordinates"][1]),
            ],
        },
        "properties": {"id": "terrain path"},
    }

    return line


if __name__ == "__main__":

    # Setup data folder paths
    dem_folder = os.path.join(BASE_PATH)
    directory_shapes = os.path.join(DATA_PROCESSED, "shapes")

    # Set coordinate reference systems
    old_crs = "EPSG:4326"
    # new_crs = 'EPSG:3857'

    # DEFINE MAIN USER PARAMETERS
    # Define an empty dict for user defined parameters
    main_user_defined_parameters = {}

    # Define radio operating frequency (MHz)
    # main_user_defined_parameters['fmhz'] = 573.3
    main_user_defined_parameters["fmhz"] = 41.5

    # Define distance between terminals in km (from Longley Rice docs)
    main_user_defined_parameters["d"] = 77.8

    # Define antenna heights - Antenna 1 height (m) # Antenna 2 height (m)
    main_user_defined_parameters["hg"] = [143.9, 8.5]

    # Polarization selection (0=horizontal, 1=vertical)
    main_user_defined_parameters["ipol"] = 0

    # Original surface profile from Longley Rice docs
    original_surface_profile_m = [
        96,
        84,
        65,
        46,
        46,
        46,
        61,
        41,
        33,
        27,
        23,
        19,
        15,
        15,
        15,
        15,
        15,
        15,
        15,
        15,
        15,
        15,
        15,
        15,
        17,
        19,
        21,
        23,
        25,
        27,
        29,
        35,
        46,
        41,
        35,
        30,
        33,
        35,
        37,
        40,
        35,
        30,
        51,
        62,
        76,
        46,
        46,
        46,
        46,
        46,
        46,
        50,
        56,
        67,
        106,
        83,
        95,
        112,
        137,
        137,
        76,
        103,
        122,
        122,
        83,
        71,
        61,
        64,
        67,
        71,
        74,
        77,
        79,
        86,
        91,
        83,
        76,
        68,
        63,
        76,
        107,
        107,
        107,
        119,
        127,
        133,
        135,
        137,
        142,
        148,
        152,
        152,
        107,
        137,
        104,
        91,
        99,
        120,
        152,
        152,
        137,
        168,
        168,
        122,
        137,
        137,
        170,
        183,
        183,
        187,
        194,
        201,
        192,
        152,
        152,
        166,
        177,
        198,
        156,
        127,
        116,
        107,
        104,
        101,
        98,
        95,
        103,
        91,
        97,
        102,
        107,
        107,
        107,
        103,
        98,
        94,
        91,
        105,
        122,
        122,
        122,
        122,
        122,
        137,
        137,
        137,
        137,
        137,
        137,
        137,
        137,
        140,
        144,
        147,
        150,
        152,
        159,
    ]

    # Create new geojson for Crystal Palace radio transmitter
    transmitter = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": (-0.07491679518573545, 51.42413477117786),
        },
        "properties": {"id": "Crystal Palace radio transmitter"},
    }

    # Create new geojson for Mursley
    receiver = {
        "type": "Feature",
        "geometry": {
            "type": "Point",
            "coordinates": (-0.8119433954872186, 51.94972494521946),
        },
        "properties": {"id": "Mursley"},
    }

    # Create new geojson for terrain path
    line = straight_line_from_points(transmitter, receiver)

    # Run terrain module
    measured_terrain_profile, distance_km, points = terrain_p2p(
        os.path.join(dem_folder, "ASTGTM2_N51W001_dem.tif"), line
    )
    print("Distance is {}km".format(distance_km))

    # Check (out of interest) how many measurements are in each profile
    print("len(measured_terrain_profile) {}".format(len(measured_terrain_profile)))
    print("len(original_surface_profile_m) {}".format(len(original_surface_profile_m)))

    # Run model and get output
    output = itmlogic_p2p(main_user_defined_parameters, original_surface_profile_m)

    # Grab coordinates for transmitter and receiver for writing to .csv
    transmitter_x = transmitter["geometry"]["coordinates"][0]
    transmitter_y = transmitter["geometry"]["coordinates"][1]
    receiver_x = receiver["geometry"]["coordinates"][0]
    receiver_y = receiver["geometry"]["coordinates"][1]

    transmitter_shape = []
    transmitter_shape.append(transmitter)
    write_shapefile(transmitter_shape, directory_shapes, "transmitter.shp", old_crs)

    receiver_shape = []
    receiver_shape.append(receiver)
    write_shapefile(receiver_shape, directory_shapes, "receiver.shp", old_crs)

    write_shapefile(points, directory_shapes, "points.shp", old_crs)

    # Write results to .csv
    csv_writer(output, RESULTS, "p2p_results.csv")

    print("Completed run")
