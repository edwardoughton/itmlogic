"""
Visualize results.

Written by Ed Oughton

June 2020

"""
import os
import sys
import configparser
import pandas as pd
import matplotlib.pyplot as plt

CONFIG = configparser.ConfigParser()
CONFIG.read(os.path.join(os.path.dirname(__file__), '..', 'scripts', 'script_config.ini'))
BASE_PATH = CONFIG['file_locations']['base_path']

RESULTS = os.path.join(BASE_PATH, '..', 'results')

def plot_area_results(path):
    """
    Plot the results from scripts/area.py

    Parameters
    ----------
    path : string
        The path to the results generated.

    """
    data = pd.read_csv(path)

    data = data.set_index(['distance_km','confidence_level_%']).unstack().swaplevel(0,1,1).sort_index(1)
    ax =  data.plot.line()
    ax.set_xlabel("Distance (km)")
    ax.set_ylabel("Propagation Loss (dB)")
    ax.legend(["10% Confidence", "50% Confidence", "90% Confidence"])
    plt.title('Estimated Propagation Loss')
    path_output = os.path.join(BASE_PATH, '..', 'vis', 'figures', 'area_results.png')
    plt.savefig(path_output)


def plot_p2p_results(path):
    """
    Plot the results from scripts/p2p.py

    Parameters
    ----------
    path : string
        The path to the results generated.

    """
    data = pd.read_csv(path)

    data = data[['reliability_level_%', 'confidence_level_%', 'propagation_loss_dB']]

    max_value = max(data['propagation_loss_dB']) + 50

    data = data.set_index(
        ['reliability_level_%', 'confidence_level_%']
        ).unstack().swaplevel(0,1,1).sort_index(1)

    ax =  data.plot.bar(rot=0)
    ax.set_xlabel("Reliability (%)")
    ax.set_ylabel("Propagation Loss (dB)")
    ax.set_ylim(0, max_value)
    ax.legend(["10% Confidence", "50% Confidence", "90% Confidence"])
    plt.title('Estimated Point-to-Point Propagation Loss')
    path_output = os.path.join(BASE_PATH, '..', 'vis', 'figures', 'p2p_results.png')
    plt.savefig(path_output)


if __name__ == '__main__':

    path = os.path.join(RESULTS, 'area_results.csv')

    if os.path.exists(path):
        plot_area_results(path)

    path = os.path.join(RESULTS, 'p2p_results.csv')

    if os.path.exists(path):
        plot_p2p_results(path)
