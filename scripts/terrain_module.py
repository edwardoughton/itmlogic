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
from shapely.ops import transform
from shapely.geometry import LineString, mapping


def terrain_module(dem_folder, line, current_crs):
    """
    This module takes a set of point coordinates and returns
    the elevation profile.

    Line : dict
        Geojson. Must be in WGS84 / EPSG: 4326

    """
    extents = load_extents(dem_folder)

    line_geometry = LineString(line['geometry']['coordinates'])

    ll_to_osgb = partial(
        pyproj.transform,
        pyproj.Proj(init=current_crs),
        pyproj.Proj(init='EPSG:3857'))

    #convert line geometry to projected
    line_geometry = transform(ll_to_osgb, line_geometry)

    distance = int(line_geometry.length)

    increment = determine_distance_increment(distance)
    print('increment is {}'.format(increment))

    x = []
    y = []
    elevation_profile = []
    osgb_to_ll = partial(
        pyproj.transform,
        pyproj.Proj(init='EPSG:3857'),
        pyproj.Proj(init=current_crs))

    points = []

    for currentdistance  in range(0, distance, increment):
        point_old_crs = line_geometry.interpolate(currentdistance)
        point_new_crs = transform(osgb_to_ll, point_old_crs)
        xp, yp = point_new_crs.x, point_new_crs.y
        x.append(xp)
        y.append(yp)
        tile_path = get_tile_path_for_point(extents, xp, yp)
        z = get_value_from_dem_tile(tile_path, xp, yp)
        # print(os.path.basename(tile_path), xp, yp, z)
        # print('increment is {}'.format(increment))
        elevation_profile.append(z)

        points.append({
            'type': 'Feature',
            'geometry': mapping(point_old_crs),
            'properties': {
                'elevation': float(z),
                }
            })

    return elevation_profile, distance, points


def load_extents(dem_folder):
    """
    Check the extent of each DEM tile, save to dict for future reference.

    """
    extents = {}
    for tile_path in glob.glob(os.path.join(dem_folder, "*.tif")):
        dataset = rasterio.open(tile_path)
        # print("Extent of", tile_path, tuple(dataset.bounds))
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


def determine_distance_increment(distance):
    """
    Longley-Rice Irregular Terrain Model is limited to only 600
    elevation points, so this function ensures this number is not
    passed.

    """
    print(distance)
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
