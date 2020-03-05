"""
Terrain profile module.

Written by Ed Oughton and Tom Russell

June 2019

"""
import configparser
import glob

import os
import math
from functools import partial, lru_cache

import fiona
import pyproj
import rasterio
import numpy as np
from shapely.ops import transform
from shapely.geometry import Point, LineString, mapping
from rasterstats import zonal_stats
import configparser
from collections import OrderedDict

CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), 'script_config.ini'))
BASE_PATH = CONFIG['file_locations']['base_path']


def terrain_area(dem_folder, transmitter, cell_range, current_crs):
    """
    This module takes a single set of point coordinates for a site
    along with an estimate of the cell range. The irregular terrain
    parameter is returned.

    Parameters
    ----------
    dem_folder : string
        Folder path to the available Digital Elevation Model tiles.
    transmitter : dict
        Geojson. Must be in WGS84 / EPSG: 4326
    cell_range : int
        Radius of cell area in meters.
    current_crs : string
        The coordinate reference system the transmitter coordinates
        are in (must be WGS84 / EPSG: 4326).

    Returns
    -------
    Inter-decile range : int
        The terrain irregularity parameter.

    """
    point_geometry = Point(transmitter['geometry']['coordinates'])

    to_projected = pyproj.Transformer.from_proj(
        pyproj.Proj('epsg:4326'), # source coordinate system
        pyproj.Proj('epsg:3857')) # destination coordinate system

    point_geometry = transform(to_projected.transform, point_geometry)

    cell_area_projected = point_geometry.buffer(cell_range)

    to_unprojected = pyproj.Transformer.from_proj(
        pyproj.Proj('epsg:3857'), # source coordinate system
        pyproj.Proj('epsg:4326')) # destination coordinate system

    cell_area_unprojected = transform(to_unprojected.transform, cell_area_projected)

    stats = zonal_stats([cell_area_unprojected],
                        os.path.join(BASE_PATH,'ASTGTM2_N51W001_dem.tif'),
                        add_stats={'interdecile_range':interdecile_range})

    return stats[0]['interdecile_range']


def interdecile_range(x):
    """
    Get range between bottom 10% and top 10% of values.

    """
    q90, q10 = np.percentile(x, [90, 10])

    return int(round(q90 - q10, 0))


def terrain_p2p(dem_folder, line, current_crs):
    """
    This module takes a set of point coordinates and returns
    the elevation profile.

    Line : dict
        Geojson. Must be in WGS84 / EPSG: 4326

    """
    extents = load_extents(dem_folder)
    line_geom = LineString(line['geometry']['coordinates'])

    # Geographic distance
    geod = pyproj.Geod(ellps="WGS84")
    distance_m = geod.geometry_length(line_geom)
    distance_km = distance_m / 1e3

    num_samples = determine_num_samples(distance_m)

    steps = np.interp(range(num_samples), [0,num_samples], [0, line_geom.length])

    elevation_profile = []
    points = []

    for currentdistance in steps:
        point = line_geom.interpolate(currentdistance)
        xp, yp = point.x, point.y
        tile_path = get_tile_path_for_point(extents, xp, yp)
        z = get_value_from_dem_tile(tile_path, xp, yp)

        elevation_profile.append(z)

        points.append({
            'type': 'Feature',
            'geometry': mapping(point),
            'properties': {
                'elevation': float(z),
            }
        })


    return elevation_profile, distance_km, points


def load_extents(dem_folder):
    """
    Check the extent of each DEM tile, save to dict for future reference.

    """
    extents = {}
    for tile_path in glob.glob(os.path.join(dem_folder, "*.tif")):
        dataset = rasterio.open(tile_path)
        extents[tuple(dataset.bounds)] = tile_path

    return extents


def get_tile_path_for_point(extents, x, y):
    for (left, bottom, right, top), path in extents.items():
        if x >= left and x <= right and y <= top and y >= bottom:
            return path
    raise ValueError("No tile includes x {} y {}".format(x, y))


def get_value_from_dem_tile(tile_path, x, y):
    """
    Read all tile extents, load value from relevant tile.

    """
    dataset = rasterio.open(tile_path)
    row, col = dataset.index(x, y)
    band = dataset.read(1)
    dataset.close()
    return band[row, col]


def determine_num_samples(distance_m):
    """Guarantee a number of samples between 2 and 600.

    Longley-Rice Irregular Terrain Model is limited to only 600
    elevation points, so this function ensures this number is not
    passed.

    """
    # Online plot to get a feel for the function:
    # https://www.wolframalpha.com/input/?i=plot+%28-1%2F%280.0001x%2B%281%2F598%29%29%29+%2B+600+from+0+to+100

    # Limits:
    # https://www.wolframalpha.com/input/?i=limit+%28-1%2F%280.0001x%2B%281%2F598%29%29%29+%2B+600

    stretch = 1e-5
    lower_limit = 2
    upper_limit = 600
    return round(
        (
            -1 /
            (
                (stretch * distance_m) +
                (1 / (upper_limit - lower_limit))
            )
        ) +
        upper_limit
    )
