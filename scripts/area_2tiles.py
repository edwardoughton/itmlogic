"""
Testing a area prediction mode over two DEM tiles.

Written by Tom Russell and Ed Oughton

November 2019

Original Matlab code implemented by Johnson and Yardim at OSU.

"""
import configparser
import os
import csv
import math
import numpy as np
from functools import partial

from itmlogic.misc.qerfi import qerfi
from itmlogic.preparatory_subroutines.qlra import qlra
from itmlogic.lrprop import lrprop
from itmlogic.statistics.avar import avar
from terrain_module import terrain_area

# #set up file paths
CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), 'script_config.ini'))
BASE_PATH = CONFIG['file_locations']['base_path']

DATA_PROCESSED = os.path.join(BASE_PATH, 'processed')
RESULTS = os.path.join(BASE_PATH, '..', 'results')


def itmlogic_area(main_user_defined_parameters):
    """
    Run itmlogic in area prediction mode.

    Parameters
    ----------
    main_user_defined_parameters : dict
        User defined parameters.

    Returns
    -------
    output : list of dicts
        Contains model output results.

    """
    prop = main_user_defined_parameters

    #DEFINE ENVIRONMENTAL PARAMETERS
    #Surface refractivity (N-units)
    prop['ens0'] = 301

    #Relative permittivity of ground
    prop['eps'] = 15

    #Conductivity (S/m) of ground
    prop['sgm'] = 0.001

    # Climate selection (1=equatorial, 2=continental subtropical, 3=maritime subtropical,
    # 4=desert, 5=continental temperate, 6=maritime temperate overland,
    # 7=maritime temperate, oversea (5 is the default)
    prop['klimx'] = 5

    #Mode of variability: Single Message=0, Accidental=1, Mobile=2, Broadcast=3
    prop['mdvarx'] = 3

    #DEFINE STATISTICAL PARAMETERS
    #Percent of time requested for computation
    QT = [50]

    #Percent of locations requested for computation
    QL = [50]

    #Confidence levels of computation
    QC = [50, 90, 10]

    #Initial distance (km) for loop over range
    D0 = 10

    #Max distance 1 (km) for loop over range
    D1 = 150

    #Increment 1 (km) for loop over range
    DS1 = 10

    #Max distance 2 (km) for coarser loop over range (starts beyond D1)
    D2 = 500

    #Increment 2 (km) for coarser loop over range
    DS2 = 50

    #Siting criterion for antenna 1, 0=random, 1= careful, 2= very careful
    KST = [2, 2]

    #Refractivity scaling ens=ens0*exp(-zsys/9460.);
    #(Average system elev above sea level)
    zsys = 0

    #Rescale requested percentages into their corresponding normal distribution arguments
    ZT = qerfi([x / 100 for x in QT])[0]
    ZL = qerfi([x / 100 for x in QL])[0]
    ZC = qerfi([x / 100 for x in QC])

    #The number of confidence intervals requested
    NC = len(QC)

    #Don't allow negative distances
    if (D0 <= 0):
        D0 = DS1

    #Set initial distance to 2 km if D0<=0
    if (D0 <= 0):
        D0= 2

    #If final distance less than initial, only do one distance
    if (D1 <= D0) or (DS1 <= 0):
        ND = 1
        D1 = D0
    #Otherwise compute the number of distance points in the loop
    #and recompute the final distance using this grid
    else:
        DS = DS1
        ND = math.floor((D1 - D0) / DS + 1.75)
        D1 = D0 + (ND - 1) * DS

    #Repeat these corrections for the "coarse" grid in range that follows the fine grid
    if (D2 <= D1 ) or ( DS2 <= 0):
        NDC = 0 #If input parameters are wrong, don't do a coarse grid
    #Otherwise set up appropriate coarse grid
    else:
        NDC = ND
        ND = math.floor((D2 - D1) / DS2 + 0.75)
        D2 = D1 + ND * DS2
        ND = NDC + ND

    #Standard Earth curvature parameter
    prop['gma'] = 157E-9
    #Scale factor for converting Np/km to dB/km
    DB = 8.685890
    #Scale factor to convert km to m
    AKM = 1000

    #Initialize error flag to 0
    prop['kwx'] = 0
    #Initialize the omega_n parameter
    prop['wn'] = prop['fmhz'] / 47.7
    #Initialize the surface refractivity
    prop['ens']  = prop['ens0']

    #Adjust surface refractivity parameter if zsys set by user
    if (zsys != 0):
        prop['ens'] = prop['ens'] * math.exp(-zsys / 9460)

    #Implement refractive effects on Earth curvature
    prop['gme']  = prop['gma'] * (1 - 0.04665 * math.exp(prop['ens'] / 179.3))

    #Initialize lvar parameter (this is used when updating AVAR with new input parameters)
    prop['lvar'] = 0

    #Compute ground effective impedance zq parameter
    zq = complex(prop['eps'], 376.62 * prop['sgm'] / prop['wn'])

    #Compute ground effective impedance z parameter (horizontal pol)
    prop['zgnd'] = math.sqrt(zq.real - 1)

    #Compute ground effective impedance z parameter (vertical pol)
    if (prop['ipol'] != 0):
        prop['zgnd'] = prop['zgnd'] / zq

    #Qlra initializes all the required parameters for area-prediction mode given
    #siting type and other params already set in "prop"
    prop = qlra(KST, prop)

    #Starting distances for loop over range
    D = D0
    #First range step is that of the fine grid
    DT = DS

    FS = []
    DD = []

    output = []

    for JD in range(0, ND): #0-22

        #Ensure that AVAR routines adjust only for distance (not quantiles which are set)
        prop['lvar'] = max(1, prop['lvar'])

        #Compute baseline propagation loss at current range
        prop = lrprop(D * AKM, prop)

        #Compute and store baseline loss
        FS.append(DB * np.log(2 * prop['wn'] * prop['dist']))

        #Store distance at this increment
        DD.append(D)

        #Loop over confidence intervals requested by user
        for JC in range(0, NC): #0-3

            #Get confidence interval
            confidence_level = QC[JC]

            #Compute adjustment for specified confidence levels
            avar1, prop = avar(ZT, ZL, ZC[JC], prop)

            #Store results
            output.append({
                'distance_km': D,
                'confidence_level_%': confidence_level,
                'propagation_loss_dB': FS[JD] + avar1 #Add in the adjustment for this level
                })

        #Switch to the coarse grid increment in range when we get there
        if JD + 1 == NDC:
            DT = DS2

        #Increment range
        D = D + DT

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

    with open(os.path.join(directory, filename), 'w') as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames, lineterminator = '\n')
        writer.writeheader()
        writer.writerows(data)


if __name__ == '__main__':

    dem_path = BASE_PATH
    directory_shapes = os.path.join(DATA_PROCESSED, 'shapes')
    cell_range = 20000

    #Define example transmitter as geojson object
    transmitter = {
        'type': 'Feature',
        'geometry': {
            'type': 'Point',
            'coordinates': (26.9976, -3.5409)
            },
        'properties': {
            'id': 'Example radio transmitter'
        }
    }

    print('Getting Terrain Irregularity Parameter (delta h) (in meters)')
    #Terrain Irregularity Parameter delta h (in meters)
    tip = terrain_area(
        os.path.join(dem_path, 'S_AVE_DSM.vrt'),
        transmitter['geometry']['coordinates'][0],
        transmitter['geometry']['coordinates'][1],
        cell_range)
    print('TIP for AST DEM', tip)

    #DEFINE MAIN USER PARAMETERS
    #define an empty dict for user defined parameters
    main_user_defined_parameters = {}

    #Antenna height 1 (m), Antenna height 2 (m)
    main_user_defined_parameters['hg'] = [3.3, 1.3]

    #Frequency (MHz)
    main_user_defined_parameters['fmhz'] = 20

    #Terrain irregularity parameter dh (m)
    main_user_defined_parameters['dh'] = tip

    #polarization selection (0=horizontal, 1=vertical)
    main_user_defined_parameters['ipol'] = 0

    print('Running itmlogic')
    output = itmlogic_area(main_user_defined_parameters)

    print('Writing results to ', os.path.join(RESULTS, 'area_results_2tiles.csv'))
    csv_writer(output, RESULTS, 'area_results_2tiles.csv')
