"""
Terrain profile module.

Written by Ed Oughton and Tom Russell

June 2019

"""

import glob
import math
import os
import sys
from collections import OrderedDict
from functools import partial, lru_cache

import fiona
import pyproj
import rasterio
import numpy as np
from fiona.crs import from_epsg
from rasterstats import gen_zonal_stats, point_query
from shapely.ops import transform
from shapely.geometry import Point, LineString, mapping


def terrain_area(dem, lon, lat, cell_range):
    """
    This module takes a single set of point coordinates for a site
    along with an estimate of the cell range. The irregular terrain
    parameter is returned.

    Parameters
    ----------
    dem : str
        Path to the available Digital Elevation Model as single raster file or vrt.
    lon : float
        Longitude of cell point
    lat : float
        Latitude of cell point
    cell_range : int
        Radius of cell area in meters.

    Returns
    -------
    Inter-decile range : int
        The terrain irregularity parameter.

    """
    # Buffer around cell point
    cell_area = geodesic_point_buffer(lon, lat, cell_range)

    # Calculate raster stats
    stats = next(
        gen_zonal_stats(
            [cell_area],
            dem,
            add_stats={"interdecile_range": interdecile_range},
            nodata=-9999,
        )
    )

    id_range = stats["interdecile_range"]

    return id_range


def geodesic_point_buffer(lon, lat, distance_m):
    """
    Calculate a buffer a specified number of metres around a lat/lon point.

    Parameters
    ----------
    lon : float
        Longitude.
    lat :  float
        Latitude.
    distance_m : int
        Distance in meters.

    Returns
    -------
    buffer : Shapely object
        Buffered point.

    """
    # Azimuthal equidistant projection around lat/lon point
    aeqd = "+proj=aeqd +lat_0={lat} +lon_0={lon} +x_0=0 +y_0=0"
    crs = aeqd.format(lat=lat, lon=lon)

    # To be transformed to WGS84 / EPSG:4326
    transformer = pyproj.Transformer.from_crs(crs, "epsg:4326", always_xy=True)

    # Buffer origin by distance in metres
    buf = Point(0, 0).buffer(distance_m)

    # Return transformed
    return transform(transformer.transform, buf)


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


def all_data(x):
    """
    Get all data points within mask, with values greater than zero.

    """
    data = x.compressed()
    return data[data > 0]


def terrain_p2p(dem, line):
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
    line_geom = LineString(line["geometry"]["coordinates"])

    # Geographic distance
    geod = pyproj.Geod(ellps="WGS84")
    distance_m = geod.geometry_length(line_geom)
    distance_km = distance_m / 1e3

    # Interpolate along line to get sampling points
    num_samples = determine_num_samples(distance_m)
    steps = np.interp(range(num_samples), [0, num_samples], [0, line_geom.length])
    point_geoms = [line_geom.interpolate(currentdistance) for currentdistance in steps]

    # Sample elevation profile
    surface_profile = point_query(point_geoms, dem)

    # Put together point features with raster values
    points = [
        {
            "type": "Feature",
            "geometry": mapping(point),
            "properties": {
                "elevation": float(z),
            },
        }
        for point, z in zip(point_geoms, surface_profile)
    ]
    return surface_profile, distance_km, points


def determine_num_samples(distance_m):
    """
    Guarantee a number of samples between 2 and 600.

    Longley-Rice Irregular Terrain Model is limited to only 600
    surface points, so this function ensures this number is not
    passed.

    Parameters
    ----------
    distance_m : int
        Distance between transmitter and receiver in meters.

    Returns
    -------
    num_samples : int
        Number of samples between 2 and 600.

    """
    # This is -1/x translated and rescaled:
    # - to hit 2 at x=0
    # - to approach 600 as x->inf

    # Online plot to get a feel for the function:
    # https://www.wolframalpha.com/input/?i=plot+%28-1%2F%280.0001x%2B%281%2F598%29%29%29+%2B+600+from+0+to+100

    # Limits:
    # https://www.wolframalpha.com/input/?i=limit+%28-1%2F%280.0001x%2B%281%2F598%29%29%29+%2B+600

    stretch = 1e-5
    lower_limit = 2
    upper_limit = 600

    return round(
        (-1 / ((stretch * distance_m) + (1 / (upper_limit - lower_limit))))
        + upper_limit
    )
