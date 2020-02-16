"""
Program for evaluating Longley-Rice path loss prediction for conditions
of OSU's 2018 PIMTER propagation campaign.

Code written by Edward Oughton, based on original work by Johnson & Yardim

February 2020

"""
import configparser
import os
import csv
import math
import numpy as np
from functools import partial
from collections import OrderedDict

from itmlogic.qerfi import qerfi
from itmlogic.qlrpfl import qlrpfl
from itmlogic.avar import avar

CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), 'script_config.ini'))
BASE_PATH = CONFIG['file_locations']['base_path']

DATA_PIMTER = os.path.join(BASE_PATH, 'pimter')

def run_itmlogic(surface_profile_m, distance_km):
    """
    Run itmlogic in point to point (p2p) prediction mode.

    """
    prop = {}

    #Frequencies used in the campaign (GHz)
    frequencies = [2.488]

    #Polarization selection (0=horizontal, 1=vertical)
    prop['ipol']  = 1

    #Receiver heights (m)
    rxht = [2.56, 2.2]

    #Transmitter heights (m) (UAV)
    txht = list(range(10, (130+1), 1))

    #Terrain relative permittivity
    prop['eps'] = 15

    #Terrain conductivity (S/m)
    prop['sgm'] = 0.005

    #Surface refractivity (N-units): also controls effective Earth radius -> unknown
    prop['ens0'] = 314

    # # Climate selection (1=equatorial,
    # # 2=continental subtropical, 3=maritime subtropical,
    # # 4=desert, 5=continental temperate,
    # # 6=maritime temperate overland,
    # # 7=maritime temperate, oversea (5 is the default)
    prop['klim']  =   5

    #Refractivity scaling;  (Average system elev above sea level)
    zsys = 0

    #Confidence  levels for predictions
    qc = [50]

    #Reliability levels for predictions
    qr = [50]

    #Preliminary calcs
    #Conversion factor to dB
    DB = 8.685890
    NC = len(qc)
    NR = len(qr)
    ZR = qerfi(qr) #ZR = qerfi(qr / 100)
    ZC = qerfi(qc) #ZC = qerfi(qc / 100)

    # Inverse Earth radius
    prop['gma']  = 157E-9

    prop['ens'] = prop['ens0']

    if zsys != 0:
        prop['ens'] = prop['ens'] * math.exp(-zsys / 9460)

    prop['gme'] = prop['gma'] * (1 - 0.04665 * math.exp(prop['ens'] / 179.3))

    PFL = []

    PFL.append(len(distance_km)-1)
    PFL.append(distance_km[1] - distance_km[0])
    PFL = PFL + terrain_height_no_tree

    #Length of profile (km)
    prop['d'] = distance_km[-1]/1000
    prop['pfl'] = PFL

    output = []
    for frequency in range(0, len(frequencies)):

        prop['fmhz'] = frequencies[frequency] * 1000

        prop['wn'] = prop['fmhz'] / 47.7
        zq = complex(prop['eps'], (376.62 * prop['sgm'] / prop['wn']))
        prop['zgnd'] = np.sqrt(zq - 1)

        if prop['ipol'] != 0:
            prop['zgnd'] = prop['zgnd'] / zq

        if frequency == 0:
            #Rx height varies with frequency
            prop['hg'] = [0, 0]
            prop['hg'][0] = rxht[0]
        else:
            prop['hg'] = [0, 0]
            prop['hg'][0] = rxht[1]

        #Tx ht (UAV)
        for iht in range(0, len(txht)):

            hg = txht[iht]

            # Antenna 2 height (m)
            prop['hg'][1] = hg

            #Setup some intermediate quantities
            #Initial values for AVAR control parameter:
            #LVAR=0 for quantile change, 1 for dist change,
            #2 for HE change, 3 for WN change,
            # 4 for MDVAR change, 5 for KLIM change
            prop['lvar'] = 5
            #Zero out error flag
            prop['kwx'] = 0
            prop['klimx'] = 0
            prop['mdvarx'] = 11

            prop = qlrpfl(prop)

            #Here HE = effective antenna heights
            #DL = horizon distances
            #THE = horizon elevation angles
            #MDVAR = mode of variability calculation: 0=single message mode,
                #1=accidental mode, 2=mobile mode, 3=broadcast mode,
                #+10 =point-to-point, +20=interference

            # Free space loss in dB
            FS = DB * np.log(2 * prop['wn'] * prop['dist'])


            for jr in range(0, NR):
                xlb = []
                for jc in range(0, NC):
                    avar1, prop = avar(ZR[jr], 0, ZC[jc], prop)
                    xlb.append(FS + avar1)
                output.append((prop['fmhz'], hg, qr[jr], xlb[0]))

    return output

if __name__ == '__main__':

    # #terrain profile with no trees
    # terrain_height_no_tree = []
    # terrain_height_no_tree_path = os.path.join(DATA_PIMTER, 'PIMTER_Tx_Rx1_dem_height.csv')
    # with open(terrain_height_no_tree_path) as source:
    #     reader = csv.reader(source)
    #     for row in reader:
    #         terrain_height_no_tree.append(float(row[0]))

    # #terrain length
    # terrain_length = []
    # terrain_length_path = os.path.join(DATA_PIMTER, 'PIMTER_Tx_Rx1_dem_length.csv')
    # with open(terrain_length_path) as source:
    #     reader = csv.reader(source)
    #     for row in reader:
    #         terrain_length.append(float(row[0]))

    #terrain profile with no trees
    terrain_height_no_tree = []
    terrain_height_no_tree_path = os.path.join(DATA_PIMTER, 'PIMTER_2019_Rx_Tx0_dem_height.csv')

    with open(terrain_height_no_tree_path) as source:
        reader = csv.reader(source)
        for row in reader:
            terrain_height_no_tree.append(float(row[0]))

    #terrain length
    terrain_length = []

    terrain_length_path = os.path.join(DATA_PIMTER, 'PIMTER_2019_Rx_Tx0_dem_length.csv')

    with open(terrain_length_path) as source:
        reader = csv.reader(source)
        for row in reader:
            terrain_length.append(float(row[0]))

    results = run_itmlogic(terrain_height_no_tree, terrain_length)
