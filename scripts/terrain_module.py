"""
Terrain profile module

Written by Ed Oughton and Tom Russell

June 2019

"""
import configparser
import glob
import os
from functools import partial

import fiona
import pyproj
import rasterio
from shapely.ops import transform
from shapely.geometry import LineString, mapping

# #set up file paths
CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), 'script_config.ini'))
BASE_PATH = CONFIG['file_locations']['base_path']

DATA_RAW = os.path.join(BASE_PATH, 'raw')
DATA_INTERMEDIATE = os.path.join(BASE_PATH, 'intermediate')
DATA_PROCESSED = os.path.join(BASE_PATH, 'processed')


def terrain_module(dem_folder, line, old_crs, new_crs):
    """This module takes a set of point coordinates and returns the elevation
    profile.
    """
    extents = load_extents(dem_folder)

    line_geometry = LineString(line['geometry']['coordinates'])    
    ll_to_osgb = partial(
        pyproj.transform,
        pyproj.Proj(init='epsg:4326'),
        pyproj.Proj(init='epsg:27700'))
        
    
    line_geometry = transform(ll_to_osgb, line_geometry)

    length = int(line_geometry.length)
    increment = determine_length_increment(length)

    x = []
    y = []
    elevation_profile = []
    osgb_to_ll = partial(
        pyproj.transform,
        pyproj.Proj(init='epsg:27700'),
        pyproj.Proj(init='epsg:4326'))

    for currentdistance  in range(0, length, increment):
        point = line_geometry.interpolate(currentdistance)
        point = transform(osgb_to_ll, point)
        xp, yp = point.x, point.y
        x.append(xp)
        y.append(yp)
        tile_path = get_tile_path_for_point(extents, xp, yp)
        z = get_value_from_dem_tile(tile_path, xp, yp)
        print(os.path.basename(tile_path), xp, yp, z)
        elevation_profile.append(z)

    return elevation_profile


def load_extents(dem_folder):
    """Check the extent of each DEM tile, save to dict for future reference
    """
    extents = {}
    for tile_path in glob.glob(os.path.join(dem_folder, "*.tif")):
        dataset = rasterio.open(tile_path)
        print("Extent of", tile_path, tuple(dataset.bounds))
        extents[tuple(dataset.bounds)] = tile_path
    return extents


def get_tile_path_for_point(extents, x, y):
    for (left, bottom, right, top), path in extents.items():
        if x >= left and x <= right and y <= top and y >= bottom:
            return path
    raise ValueError("No tile includes x {} y {}".format(x, y))


def get_value_from_dem_tile(tile_path, x, y):
    """Read all tile extents, load value from relevant tile
    """
    dataset = rasterio.open(tile_path)
    row, col = dataset.index(x, y)
    band = dataset.read(1)
    dataset.close()
    return band[row, col]


def determine_length_increment(length):
    """Longley-Rice Irregular Terrain Model is limited to only 600 elevation points, so this 
    function maximises ensures this number is not passed (while maintaining computational 
    speed)
    """
    if length >= 60000:
        increment = length / 600
    else:
        increment = max(length / 100, 1)
    return int(increment)

if __name__ == '__main__':
    dem_folder = os.path.join(DATA_RAW, 'dem_london')

    with fiona.open(os.path.join(DATA_RAW, 'crystal_palace_to_cambridge.shp'), 'r') as source:
        line = next(iter(source))
        terrain_profile = terrain_module(dem_folder, line, 'EPSG:4326', 'EPSG:27700')
