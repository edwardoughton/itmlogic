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
                        add_stats={'interdecile_range': interdecile_range})

    return stats[0]['interdecile_range']


def interdecile_range(x):
    """
    Get range between bottom 10% and top 10% of values.

    Parameters
    ----------
    x : list
        Terrain profile values.

    Returns
    -------
    interdecile_range : int
        The terrain irregularity parameter.

    """
    q90, q10 = np.percentile(x, [90, 10])

    interdecile_range = int(round(q90 - q10, 0))

    return interdecile_range


def terrain_p2p(dem_folder, line, current_crs):
    """
    This module takes a set of point coordinates and returns
    the surface profile.

    Parameters
    ----------
    dem_folder : string
        Folder path to the available Digital Elevation Model tiles.
    line : dict
        Geojson linestring. Must be in WGS84 / EPSG: 4326
    current_crs : string
        The current coordinate reference system.

    Returns
    -------
    surface_profile :list
        Contains the surface profile measurements in meters.
    distance_km : float
        Distance in kilometers between the antenna and receiver.
    points : list of dicts
        Location of geojson sampling points.

    """
    extents = load_extents(dem_folder)

    line_geometry = LineString(line['geometry']['coordinates'])

    geod = pyproj.Geod(ellps="WGS84")
    distance = geod.line_length(
        [line_geometry.coords[0][0], line_geometry.coords[1][0]],
        [line_geometry.coords[0][1], line_geometry.coords[1][1]]
    )

    increment = int(determine_distance_increment(distance))

    distance_km = distance / 1e3

    surface_profile = []

    points = []

    for currentdistance  in range(0, int(distance), int(increment)):
        point = line_geometry.interpolate(currentdistance)
        xp, yp = point.x, point.y
        tile_path = get_tile_path_for_point(extents, xp, yp)
        z = get_value_from_dem_tile(tile_path, xp, yp)

        surface_profile.append(z)

        points.append({
            'type': 'Feature',
            'geometry': mapping(point),
            'properties': {
                'surface': float(z),
                }
            })

    return surface_profile, distance_km, points


def load_extents(dem_folder):
    """
    Check the extent of each DEM tile, save to dict for future reference.

    Parameters
    ----------
    dem_folder : string
        Folder path to the available Digital Elevation Model tiles.

    Returns
    -------
    extents : dict
        Contains tile boundary coordinates.

    """
    extents = {}
    for tile_path in glob.glob(os.path.join(dem_folder, "*.tif")):
        dataset = rasterio.open(tile_path)
        extents[tuple(dataset.bounds)] = tile_path

    return extents


def get_tile_path_for_point(extents, x, y):
    """
    Function to locate the correct tile path.

    Parameters
    ----------
    extents : dict
        Contains tile boundary coordinates.
    x : float
        Longitude coordinate.
    y : float
        Latitude coordinate.

    Returns
    -------
    path : string
        Correct tile path.

    """
    for (left, bottom, right, top), path in extents.items():
        if x >= left and x <= right and y <= top and y >= bottom:
            return path
    raise ValueError("No tile includes x {} y {}".format(x, y))


def get_value_from_dem_tile(tile_path, x, y):
    """
    Read all tile extents, load value from relevant tile.

    Parameters
    ----------
    tile_path : string
        Correct Digital Elevation Model tile path.
    x : float
        Longitude coordinate.
    y : float
        Latitude coordinate.

    Returns
    -------
    value : int
        Elevation value in meters.

    """
    dataset = rasterio.open(tile_path)
    row, col = dataset.index(x, y)
    band = dataset.read(1)
    dataset.close()
    value = band[row, col]

    return value


def determine_distance_increment(distance):
    """
    Longley-Rice Irregular Terrain Model is limited to only 600
    surface points, so this function ensures this number is not
    passed.

    Parameters
    ----------
    distance : int
        Distance between the transmitter and receiver.

    Returns
    -------
    increment : int
        Distance increment between each sampling point (in meters).

    """
    if distance >= 60000:
        return int(distance / 100)
    elif distance >= 30000:
        return int(distance / 50)
    elif distance >= 10000:
        return int(distance / 25)
    elif distance >= 1000:
        return int(distance / 10)
    else:
        return int(distance / 2)
