import os
import configparser
import math
import fiona
from shapely.ops import transform
from shapely.geometry import Point, mapping, shape, Polygon
from functools import partial
from rtree import index
import pyproj


from collections import OrderedDict

CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), 'script_config.ini'))
BASE_PATH = CONFIG['file_locations']['base_path']

DATA_RAW = os.path.join(BASE_PATH, 'raw')
DATA_INTERMEDIATE = os.path.join(BASE_PATH, 'intermediate')


def convert_point_to_projected_crs(point, original_crs, new_crs):
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

    new_geom = transform(project, Point(point))

    output = {
        'type': 'Feature',
        'geometry': mapping(new_geom),
        'properties': 'Crystal Palace Radio Tower'
        }

    return output


def calculate_polygons(startx, starty, endx, endy, radius):
    """
    Calculate a grid of hexagon coordinates of the given radius
    given lower-left and upper-right coordinates
    Returns a list of lists containing 6 tuples of x, y point coordinates
    These can be used to construct valid regular hexagonal polygons

    You will probably want to use projected coordinates for this
    """
    # calculate side length given radius
    sl = (2 * radius) * math.tan(math.pi / 6)

    # calculate radius for a given side-length
    # (a * (math.cos(math.pi / 6) / math.sin(math.pi / 6)) / 2)
    # see http://www.calculatorsoup.com/calculators/geometry-plane/polygon.php

    # calculate coordinates of the hexagon points
    # sin(30)
    p = sl * 0.5
    b = sl * math.cos(math.radians(30))
    w = b * 2
    h = 2 * sl

    # offset start and end coordinates by hex widths and heights to guarantee coverage
    startx = startx - w
    starty = starty - h
    endx = endx + w
    endy = endy + h

    origx = startx
    origy = starty


    # offsets for moving along and up rows
    xoffset = b
    yoffset = 3 * p

    polygons = []
    row = 1
    counter = 0

    while starty < endy:
        if row % 2 == 0:
            startx = origx + xoffset
        else:
            startx = origx
        while startx < endx:
            p1x = startx
            p1y = starty + p
            p2x = startx
            p2y = starty + (3 * p)
            p3x = startx + b
            p3y = starty + h
            p4x = startx + w
            p4y = starty + (3 * p)
            p5x = startx + w
            p5y = starty + p
            p6x = startx + b
            p6y = starty
            poly = [
                (p1x, p1y),
                (p2x, p2y),
                (p3x, p3y),
                (p4x, p4y),
                (p5x, p5y),
                (p6x, p6y),
                (p1x, p1y)]
            polygons.append(poly)
            counter += 1
            startx += w
        starty += yoffset
        row += 1
    return polygons


def find_closest_cell_areas(hexagons, geom_shape):

    idx = index.Index()

    for site in hexagons:
        coords = site['centroid']
        idx.insert(0, coords.bounds, site)

    transmitter = mapping(geom_shape.centroid)

    cell_area =  list(
        idx.nearest(
            (transmitter['coordinates'][0],
            transmitter['coordinates'][1],
            transmitter['coordinates'][0],
            transmitter['coordinates'][1]),
            1, objects='raw')
            )[0]

    closest_cell_area_centroid = Polygon(
        cell_area['geometry']['coordinates'][0]
        ).centroid

    all_closest_sites =  list(
        idx.nearest(
            closest_cell_area_centroid.bounds,
            7, objects='raw')
            )

    interfering_cell_areas = all_closest_sites[1:7]

    cell_area = []
    cell_area.append(all_closest_sites[0])

    return cell_area, interfering_cell_areas


def find_site_locations(cell_area, interfering_cell_areas):

    cell_area_site = Polygon(
        cell_area[0]['geometry']['coordinates'][0]
        ).centroid

    transmitter = []
    transmitter.append({
        'type': 'Feature',
        'geometry': mapping(cell_area_site),
        'properties': {
            'site_id': 'transmitter'
        }
    })

    interfering_transmitters = []
    for interfering_cell in interfering_cell_areas:
        interfering_transmitters.append({
            'type': 'Feature',
            'geometry': mapping(interfering_cell['centroid']),
            'properties': {
                'site_id': 'transmitter'
            }
        })

    return transmitter, interfering_transmitters


def generate_cell_areas(point, inter_site_distance):
    """
    Generate a cell area, as well as the interfering cell areas, for
    a specific inter-site distance

    """
    geom_shape = shape(point['geometry'])
    buffered = Polygon(geom_shape.buffer(inter_site_distance*2).exterior)

    polygon = calculate_polygons(
        buffered.bounds[0], buffered.bounds[1],
        buffered.bounds[2], buffered.bounds[3],
        inter_site_distance)

    hexagons = []
    id_num = 0
    for poly in polygon:
        hexagons.append({
            'type': 'Feature',
            'geometry': {
                'type': 'Polygon',
                'coordinates': [poly],
            },
            'centroid': (Polygon(poly).centroid),
            'properties': {
                'cell_area_id': id_num
                }
            })

        id_num += 1

    cell_area, interfering_cell_areas = find_closest_cell_areas(hexagons, geom_shape)

    return cell_area, interfering_cell_areas


def produce_sites_and_cell_areas(unprojected_point, inter_site_distance):

    point = convert_point_to_projected_crs(unprojected_point, 'EPSG:4326', 'EPSG:27700')

    cell_area, interfering_cell_areas = generate_cell_areas(point, inter_site_distance)

    transmitter, interfering_transmitters = find_site_locations(cell_area, interfering_cell_areas)

    return transmitter, interfering_transmitters, cell_area, interfering_cell_areas


def write_shapefile(data, filename):

    # Translate props to Fiona sink schema
    prop_schema = []
    for name, value in data[0]['properties'].items():
        fiona_prop_type = next((
            fiona_type for fiona_type, python_type in \
                fiona.FIELD_TYPES_MAP.items() if \
                python_type == type(value)), None
            )

        prop_schema.append((name, fiona_prop_type))

    sink_driver = 'ESRI Shapefile'
    sink_crs = {'init': 'epsg:27700'}
    sink_schema = {
        'geometry': data[0]['geometry']['type'],
        'properties': OrderedDict(prop_schema)
    }

    # Create path
    directory = os.path.join(DATA_INTERMEDIATE, 'test_simulation')
    if not os.path.exists(directory):
        os.makedirs(directory)

    print(os.path.join(directory, filename))
    # Write all elements to output file
    with fiona.open(
        os.path.join(directory, filename), 'w',
        driver=sink_driver, crs=sink_crs, schema=sink_schema) as sink:
        for feature in data:
            sink.write(feature)


if __name__ == '__main__':

    with fiona.open(
        os.path.join(DATA_RAW, 'crystal_palace_to_mursley.shp'), 'r') as source:
            unprojected_line = next(iter(source))
            unprojected_point = unprojected_line['geometry']['coordinates'][0]

    transmitter, interfering_transmitters, cell_area, interfering_cell_areas = \
        produce_sites_and_cell_areas(unprojected_point, 750)

    # write_shapefile(transmitter, 'transmitter.shp')
    # write_shapefile(cell_area, 'cell_area.shp')
    # write_shapefile(interfering_transmitters, 'interfering_transmitters.shp')
    # write_shapefile(interfering_cell_areas, 'interfering_cell_areas.shp')
