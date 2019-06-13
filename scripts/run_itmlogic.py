import configparser
import os
import csv
import math

from itmlogic.qlrpfl import qlrpfl 

# #set up file paths
CONFIG = configparser.ConfigParser()
CONFIG.read(
    os.path.join(os.path.dirname(__file__), 'script_config.ini')
    )
BASE_PATH = CONFIG['file_locations']['base_path']

DATA_RAW = os.path.join(BASE_PATH, 'raw')
DATA_INTERMEDIATE = os.path.join(BASE_PATH, 'intermediate')
DATA_PROCESSED = os.path.join(BASE_PATH, 'processed')
DATA_PIMTER = os.path.join(BASE_PATH, 'pimter_campaign')


def run_itmlogic():

    frequencies = [
        0.4491, 0.4541, 0.4561, 0.4601, 0.4651, 0.4691, 
        2.02, 2.3941, 2.3991, 2.4131, 2.4231, 2.4341,
        2.5781, 2.69, 3.01, 3.52, 3.7891, 3.9561,
        3.9991, 4.0121, 4.1231, 4.52, 5.15, 5.51,
        5.7230, 5.7891, 5.8230, 5.8900, 5.9231, 6.425,
        6.876, 7.125, 7.87, 8.45
        ]

    prop = {}
    # Polarization selection (0=horizontal, 1=vertical)
    prop['ipol'] = 1  
    # Receiver heights (m)        -> need to confirm
    rxht = [1.5, 2, 2.5] 
    # Transmit Antenna height (m) -> need to confirm
    prop['hg'] = [1.5]   

    # Terrain relative permittivity  -> unknown
    prop['eps'] = 15 
    # Terrain conductivity (S/m)     -> unknown
    prop['sgm'] = 0.005
    # Surface refractivity (N-units): also controls effective Earth radius -> unknown 
    prop['ens0'] = 314

    # Climate selection (1 = equatorial, 2 = continental, subtropical, 
    #   3 = maritime subtropical, 4 = desert, 5 = continental temperate, 
    #   6 = maritime temperate overland, 7 = maritime temperate, 
    #   oversea (5 is the default)

    prop['klim'] = 5   
    # Refractivity scaling ens['ens0']*exp(-zsys/9460.);  (Average system elev above sea level)
    zsys = 0
    # Confidence levels for predictions
    qc = [50]
    # Reliability levels for predictions   
    qr = [50]

    ### A few preliminary calcs
    # Conversion factor to dB
    DB = 8.68589
    NC = len(qc)
    NR = len(qr)
    # ZR = qerfi(qr/100)
    # ZC = qerfi(qc/100)

    #Inverse Earth radius
    prop['gma'] = 157E-9
    prop['ens'] = prop['ens0']

    if zsys != 0:
      prop['ens'] = prop['ens'] * math.exp(-zsys / 9460) 

    prop['gme'] = (
        prop['gma'] * 
        (1 - 0.04665 * math.exp(prop['ens'] / 179.3))
        )

    for iteration in range(1, 2):#6):
        if iteration == 1:
            terrain_height_no_trees, terrain_length = load_data(1)
        elif iteration == 2:
            terrain_height_no_trees, terrain_length = load_data(2)
        elif iteration == 3:
            terrain_height_no_trees, terrain_length = load_data(3)
        elif iteration == 5:
            terrain_height_no_trees, terrain_length = load_data(5)
        elif iteration == 6:
            terrain_height_no_trees, terrain_length = load_data(6)

    pfl = []
    pfl.append(len(terrain_length) - 1)
    pfl.append(terrain_length[1] - terrain_length[0])
    for datum in terrain_height_no_trees:
        pfl.append(datum)
    prop['d'] = terrain_length[-1]
    prop['pfl'] = pfl

    for frequency in frequencies:

        prop['fmhz'] = frequency * 1000
        prop['wn'] = prop['fmhz'] / 47.7

        zq = complex(prop['eps'], 376.62 * prop['sgm'] / prop['wn']) 

        prop['zgnd'] = math.sqrt(prop['eps'] - 1)

        if prop['ipol'] != 0:
            prop['zgnd'] = prop['zgnd'] / zq
        
        #TODO: where does iht come from?
        for iht in range(0, 3):

            prop['hg'].append(rxht[iht])

            prop['lvar'] = 5
            prop['kwx'] = 0
            prop['klimx'] = 0
            prop['mdvarx'] = 11

            prop = qlrpfl(prop)
            print(prop)

            #Here HE = effective antenna heights, DL = horizon distances, THE = horizon elevation angles
            #MDVAR = mode of variability calculation: 0=single message mode,
            #1=accidental mode, 2=mobile mode, 3 =broadcast mode, +10 =point-to-point, +20=interference

            # #Free space loss in dB
            # fs = db * np.log(2 * prop['wn'] * prop['dist'])

            # q = prop['dist'] - prop['dlsa']

            # q = max(q - 0.5 * PFL[2], 0) - max(-q - 0.5 * PFL[2], 0)

            # if q < 0:
            #     print('Line of sight path')
            # elif q == 0:
            #     print('Single horizon path')
            # else
            #     print('Double-horizon path')
            
            # if prop['dist'] <= prop['dlsa']:
            #     print('Diffraction is the dominant mode')
            # elif prop['dist'] > prop['dx']:
            #     print('Tropospheric scatter is the dominant mode')
            
            # print(['Estimated quantiles of basic transmission loss (dB),\
            #     free space value ' num2str(fs) ' dB'])
            # print(['Confidence levels ' num2str(qc(1)) ' ' num2str(qc(2)) ' ' num2str(qc(3))])



def load_csv(path):

    with open(path, 'r') as source:
        reader = csv.reader(source)
        for row in reader:
            yield row[0]


def load_data(num):

    filename_height = 'PIMTER_Tx_Rx{}_dem_height.csv'.format(num)
    filename_length = 'PIMTER_Tx_Rx{}_dem_length.csv'.format(num)

    height = []
    length = []

    directory_height = os.path.join(DATA_PIMTER, filename_height)
    directory_length = os.path.join(DATA_PIMTER, filename_length)

    for row in load_csv(directory_height):
        height.append(float(row))
    
    for row in load_csv(directory_length):
        length.append(float(row))

    # output = []

    # for row_height, row_length in zip(height, length):
    #     output.append({
    #         'height': row_height,
    #         'length': row_length
    #     })
    
    return height, length


if __name__ == '__main__':

    run_itmlogic()

