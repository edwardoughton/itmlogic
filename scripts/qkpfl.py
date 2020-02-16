"""
Point to Point prediction mode runner.

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
from shapely.geometry import LineString, mapping
from shapely.ops import transform

from itmlogic.qerfi import qerfi
from itmlogic.qlrpfl import qlrpfl
from itmlogic.avar import avar
from terrain_module import terrain_module
from pyproj import Transformer

# #set up file paths
CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), 'script_config.ini'))
BASE_PATH = CONFIG['file_locations']['base_path']

DATA_PROCESSED = os.path.join(BASE_PATH, 'processed')


def run_itmlogic(surface_profile_m, distance_km):
    """
    Run itmlogic in point to point (p2p) prediction mode.

    """
    prop = {}

    # Terrain relative permittivity
    prop['eps'] = 15

    # Terrain conductivity (S/m)
    prop['sgm']   = 0.005

    # Polarization selection (0=horizontal, 1=vertical)
    prop['ipol'] = 0

    # Operating frequency (MHz) % Second qkpfl.for test case
    prop['fmhz'] = 573.3

    # Antenna 1 height (m) # Antenna 2 height (m)
    prop['hg'] = [143.9, 8.5]

    # Operating frequency (MHz) % First qkpfl.for test case
    prop['fmhz']  =  41.5

    # Climate selection (1=equatorial,
    # 2=continental subtropical, 3=maritime subtropical,
    # 4=desert, 5=continental temperate,
    # 6=maritime temperate overland,
    # 7=maritime temperate, oversea (5 is the default)
    prop['klim']  =   5

    # Surface refractivity (N-units): also controls effective Earth radius
    prop['ens0']  =   314

    # Confidence  levels for predictions
    qc = [50, 90, 10]

    # Reliability levels for predictions
    qr = [1, 10, 50, 90, 99]

    # Length of profile
    prop['d'] = distance_km

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
    prop['lvar'] = 5

    # Inverse Earth radius
    prop['gma']  = 157E-9

    # Conversion factor to db
    db = 8.685890

    nc = len(qc)
    nr = len(qr)

    dkm = prop['d']
    xkm = 0

    if dkm <= 0:
        dkm = xkm * pfl[0]

    if xkm <= 0:

        xkm = dkm // pfl[0]

        pfl[1] = dkm * 1000 / pfl[0]

        prop['pfl'] = pfl
        # Zero out error flag
        prop['kwx'] = 0
        prop['wn'] = prop['fmhz'] / 47.7
        prop['ens'] = prop['ens0']

    if zsys != 0:
        prop['ens'] = prop['ens'] * math.exp(-zsys / 9460)

    prop['gme'] = prop['gma'] * (1 - 0.04665 * math.exp(prop['ens'] / 179.3))

    zq = complex(prop['eps'], 376.62 * prop['sgm'] / prop['wn'])
    prop['zgnd'] = np.sqrt(zq - 1)

    if prop['ipol'] != 0:
        prop['zgnd'] = prop['zgnd'] / zq

    prop['klimx'] = 0
    prop['mdvarx'] = 11

    zr = qerfi(qr)
    zc = qerfi(qc)

    prop = qlrpfl(prop)

    ## Here HE = effective antenna heights, DL = horizon distances, THE = horizon elevation angles
    ## MDVAR = mode of variability calculation: 0=single message mode,
    ## 1=accidental mode, 2=mobile mode, 3 =broadcast mode, +10 =point-to-point, +20=interference

    fs = db * np.log(2 * prop['wn'] * prop['dist']) # Free space loss in db
    q = prop['dist'] - prop['dlsa']
    q = max(q - 0.5 * pfl[1], 0) - max(-q - 0.5 * pfl[1], 0)

    if q < 0:
        print('Line of sight path')
    elif q == 0:
        print('Single horizon path')
    else:
        print('Double-horizon path')

    if prop['dist'] <= prop['dlsa']:
        print('Diffraction is the dominant mode')
    elif prop['dist'] > prop['dx']:
        print('Tropospheric scatter is the dominant mode')

    print('Estimated quantiles of basic transmission loss (db)')
    print('Free space value {} db'.format(str(fs)))

    print('Confidence levels {}, {}, {}'.format(
        str(qc[0]), str(qc[1]), str(qc[2])))

    output = []
    for jr in range(0, (nr)):
        xlb = []
        for jc in range(0, nc):
            avar1, prop = avar(zr[jr], 0, zc[jc], prop)
            xlb.append(fs + avar1)
        output.append((qr[jr], xlb[0], xlb[1], xlb[2]))

    if prop['kwx'] == 1:
        print('WARNING- SOME PARAMETERS ARE NEARLY OUT OF RANGE.')
        print('RESULTS SHOULD BE USED WITH CAUTION.')
    elif prop['kwx'] == 2:
        print('NOTE-')
        print('DEFAULT PARAMETERS HAVE BEEN SUBSTITUTED FOR IMPOSSIBLE ONES.')
    elif prop['kwx'] == 3:
        print('WARNING- A COMBINATION OF PARAMETERS IS OUT OF RANGE.')
        print('RESULTS ARE PROBABLY INVALID.')
    elif prop['kwx'] == 4:
        print('WARNING- SOME PARAMETERS ARE OUT OF RANGE.')
        print('RESULTS ARE PROBABLY INVALID.')

    return output, fs


def convert_shape_to_projected_crs(line, old_crs, new_crs):
    """
    Existing elevation path needs to be converted from WGS84 to projected
    coordinates.

    """
    # Geometry transform function based on pyproj.transform
    # project = partial(
    #     pyproj.transform,
    #     pyproj.Proj(init = old_crs),
    #     pyproj.Proj(init = new_crs)
    #     )

    transformer = Transformer.from_crs(old_crs, new_crs, always_xy=True)
    # print(line['geometry']['coordinates'])
    #transform(project, LineString(line['geometry']['coordinates']))
    new_geom = LineString(transformer.transform(line['geometry']['coordinates'][1], line['geometry']['coordinates'][0]))

    output = {
        'type': 'Feature',
        'geometry': mapping(new_geom),
        'properties': line['properties']
        }

    return output


def csv_writer(data, fs, directory, filename, transmitter_x,
    transmitter_y, receiver_x, receiver_y):
    """
    Write data to a CSV file path.

    """
    if not os.path.exists(directory):
        os.makedirs(directory)

    full_path = os.path.join(directory, filename)

    if not os.path.exists(full_path):
        results_file = open(full_path, 'w', newline='')
        results_writer = csv.writer(results_file)
        results_writer.writerow(
            ('transmitter_x', 'transmitter_y', 'receiver_x',
            'receiver_y', 'free_space', 'reliability_level',
            'confidence_50', 'confidence_90', 'confidence_10'))
    else:
        results_file = open(full_path, 'a', newline='')
        results_writer = csv.writer(results_file)

    for row in data:
        results_writer.writerow((
            transmitter_x, transmitter_y,
            receiver_x, receiver_y,
            fs, row[0], row[1], row[2], row[3]
            ))


def write_shapefile(data, directory, filename, crs):
    """
    Write geojson data to shapefile.

    """
    prop_schema = []
    for name, value in data[0]['properties'].items():
        fiona_prop_type = next((
            fiona_type for fiona_type, python_type in \
                fiona.FIELD_TYPES_MAP.items() if \
                python_type == type(value)), None
            )

        prop_schema.append((name, fiona_prop_type))

    sink_driver = 'ESRI Shapefile'
    sink_crs = {'init': crs}
    sink_schema = {
        'geometry': data[0]['geometry']['type'],
        'properties': OrderedDict(prop_schema)
    }

    if not os.path.exists(directory):
        os.makedirs(directory)

    with fiona.open(
        os.path.join(directory, filename), 'w',
        driver=sink_driver, crs=sink_crs, schema=sink_schema) as sink:
        for datum in data:
            sink.write(datum)


if __name__ == '__main__':

    dem_folder = os.path.join(BASE_PATH)
    directory_shapes = os.path.join(DATA_PROCESSED, 'shapes')

    old_crs = 'EPSG:4326'
    new_crs = 'EPSG:3857'

    #original surface profile from Longley Rice docs
    original_surface_profile_m = [
        96,  84,  65,  46,  46,  46,  61,  41,  33,  27,  23,  19,  15,  15,  15,
        15,  15,  15,  15,  15,  15,  15,  15,  15,  17,  19,  21,  23,  25,  27,
        29,  35,  46,  41,  35,  30,  33,  35,  37,  40,  35,  30,  51,  62,  76,
        46,  46,  46,  46,  46,  46,  50,  56,  67, 106,  83,  95, 112, 137, 137,
        76, 103, 122, 122,  83,  71,  61,  64,  67,  71,  74,  77,  79,  86,  91,
        83,  76,  68,  63,  76, 107, 107, 107, 119, 127, 133, 135, 137, 142, 148,
        152, 152, 107, 137, 104,  91,  99, 120, 152, 152, 137, 168, 168, 122, 137,
        137, 170, 183, 183, 187, 194, 201, 192, 152, 152, 166, 177, 198, 156, 127,
        116, 107, 104, 101,  98,  95, 103,  91,  97, 102, 107, 107, 107, 103,  98,
        94,  91, 105, 122, 122, 122, 122, 122, 137, 137, 137, 137, 137, 137, 137,
        137, 140, 144, 147, 150, 152, 159
        ]

    #create new geojson for Crystal Palace radio transmitter
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

    #create new geojson for Mursley
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

    #create new geojson for terrain path
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

    # initial_line_write = []
    # initial_line_write.append(line)
    # write_shapefile(initial_line_write, directory_shapes, 'initial_line.shp', old_crs)

    # #convert from unprojected WGS94 ('EPSG:4326') to projected WGS94/pseudo
    # #web mercator ('EPSG:3857')
    # line_projected = convert_shape_to_projected_crs(line, old_crs, new_crs)


    # #creat shapely geometry object out of line
    # geom = LineString(line_projected['geometry']['coordinates'])

    # #convert to km
    # distance_km = geom.length #/ 1e3
    # print(distance_km)
    print(line)
    current_crs = 'EPSG:4326'
    #run terrain module
    measured_terrain_profile, distance_km, points = terrain_module(
        dem_folder, line, current_crs
        )

    #check (out of interest) how many measurements are in each profile
    print('len(measured_terrain_profile) {}'.format(len(measured_terrain_profile)))
    print('len(original_surface_profile_m) {}'.format(len(original_surface_profile_m)))
    # print('distance_km {}'.format(distance_km))

    #run model and get output
    output, fs = run_itmlogic(
        original_surface_profile_m, distance_km
        )

    #grab coordinates for transmitter and receiver for writing to .csv
    transmitter_x = transmitter['geometry']['coordinates'][0]
    transmitter_y = transmitter['geometry']['coordinates'][1]
    receiver_x = receiver['geometry']['coordinates'][0]
    receiver_y = receiver['geometry']['coordinates'][1]

    #write results to .csv
    csv_writer(output, fs, DATA_PROCESSED, 'qkpfl_results.csv',
        transmitter_x, transmitter_y, receiver_x, receiver_y)

    transmitter_shape = []
    transmitter_shape.append(transmitter)
    write_shapefile(transmitter_shape, directory_shapes, 'transmitter.shp', old_crs)

    receiver_shape = []
    receiver_shape.append(receiver)
    write_shapefile(receiver_shape, directory_shapes, 'receiver.shp', old_crs)

    write_shapefile(points, directory_shapes, 'points.shp', new_crs)

    print('Completed run')
