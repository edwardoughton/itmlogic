"""
Terrain profile module

Written by Ed Oughton

June 2019

"""
import configparser
import os
from osgeo import gdal
import fiona
from shapely.ops import transform
from shapely.geometry import LineString, mapping
from functools import partial
import pyproj

# #set up file paths
CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), 'script_config.ini'))
BASE_PATH = CONFIG['file_locations']['base_path']

DATA_RAW = os.path.join(BASE_PATH, 'raw')
DATA_INTERMEDIATE = os.path.join(BASE_PATH, 'intermediate')
DATA_PROCESSED = os.path.join(BASE_PATH, 'processed')


def convert_shape_to_projected_crs(line, original_crs, new_crs):
    """
    Existing elevation path needs to be converted from WGS84 to projected
    coordinates.

    """
    # Geometry transform function based on pyproj.transform
    project = partial(
        pyproj.transform,
        pyproj.Proj(init = original_crs),
        pyproj.Proj(init = new_crs)
        )

    new_geom = transform(project, LineString(line['geometry']['coordinates']))

    output = {
        'type': 'Feature',
        'geometry': mapping(new_geom),
        'properties': line['properties']
        }

    return output


def convert_raster_to_projected_coordinates(input_file, output, desired_crs):
    """
    Existing raster digital elevation model tile needs to be converted from
    WGS84 to projected coordinates

    """
    if not os.path.exists(output):
        os.makedirs(os.path.dirname(output))
    input_raster = gdal.Open(input_file)
    gdal.Warp(output, input_raster, dstSRS=desired_crs)

    return print('completed raster conversation for {}'.format(input_file))


def load_in_projected_dem_tile(dem_filename):
    """
    Load in the projected digital elevation model tile.

    """
    dem_layer = gdal.Open(dem_filename)
    geotransformed_layer = dem_layer.GetGeoTransform()
    bands = dem_layer.RasterCount

    return dem_layer, geotransformed_layer, bands


def get_value_from_dem_tile(x, y, layer, bands, gt):
    """

    """
    col=[]

    px = int((x - gt[0]) / gt[1])
    py =int((y - gt[3]) / gt[5])

    for j in range(bands):
        band = layer.GetRasterBand(j + 1)
        data = band.ReadAsArray(px, py, 1, 1)
        col.append(data[0][0])

    return col


def determine_length_increment(length):
    """
    Longley-Rice Irregular Terrain Model is limited to only 600 elevation
    points, so this function maximises ensures this number is not passed
    (while maintaining computational speed)

    """
    if length >= 60000:
        increment = length / 600
    else:
        increment = (length / (length / 100))

    return int(round(increment,0))


def terrain_module(line, old_crs, new_crs):
    """
    This module takes a set of point coordinates and returns the elevation
    profile.

    """
    # line = convert_shape_to_projected_crs(unprojected_line, old_crs, new_crs)

    input_folder = os.path.join(DATA_RAW, 'dem_london')
    output_folder = os.path.join(input_folder, 'projected')

    input_file = (os.path.join(input_folder, 'ASTGTM2_N51W001_dem.tif'))
    output_file = (os.path.join(output_folder, 'ASTGTM2_N51W001_dem_proj.tif'))

    if not os.path.exists(output_file):
        convert_raster_to_projected_coordinates(input_file, output_file, new_crs)

    dem_file = (os.path.join(output_folder, 'ASTGTM2_N51W001_dem_proj.tif'))

    dem_layer, geotransformed_layer, bands = load_in_projected_dem_tile(dem_file)

    line_geometry = LineString(line['geometry']['coordinates'])

    length = line_geometry.length

    increment = determine_length_increment(length)

    if length < 100:
        length = 101
        increment = 100

    x = []
    y = []
    elevation_profile = []
    # full_output = []

    for currentdistance  in range(0, int(length), int(increment)):
        # print(currentdistance, increment)
        point = line_geometry.interpolate(currentdistance)
        xp, yp = point.x, point.y
        x.append(xp)
        y.append(yp)

        z = get_value_from_dem_tile(xp, yp, dem_layer, bands, geotransformed_layer)[0]

        elevation_profile.append(z)
        # full_output.append({
        #         'x': xp,
        #         'y': yp,
        #         'z': z
        #         })

    # if len(elevation_profile) == 0:
    #     print(elevation_profile)

    return elevation_profile


if __name__ == '__main__':

    with fiona.open(
        os.path.join(DATA_RAW, 'crystal_palace_to_mursley.shp'), 'r') as source:
            line = next(iter(source))
            print(line)

    # line = {
    #     'type': 'Feature',
    #     'geometry': {
    #         'type': 'LineString',
    #         'coordinates': [
    #             (31.742076203022005, -0.33438483055855517),
    #             (31.515083698402652, -0.2659505169747957),
    #             ]
    #         },
    #     'properties': {
    #         'id': 'line1'
    #         }
    #     }

    terrain_profile = terrain_module(line, 'EPSG:4326', 'EPSG:27700')

    # print(terrain_profile)
