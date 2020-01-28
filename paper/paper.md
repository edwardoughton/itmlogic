---
title: 'itmlogic: Irregular Terrain Model Longley Rice'
tags:
  - python
  - mobile telecommunications
  - propagation
authors:
  - name: Edward J Oughton
    orcid: 0000-0002-2766-008X
    affiliation:  "1, 2"
  - name: Tom Russell
    orcid: 0000-0002-0081-400X
    affiliation: 1
  - name: Joel Johnson
    orcid: 
    affiliation: 3
  - name: Caglar Yardim
    orcid: 
    affiliation: 3
  - name: Julius Kusuma
    orcid: 
    affiliation: 4
affiliations:
  - name: Environmental Change Institute, University of Oxford
    index: 1
  - name: Computer Laboratory, University of Cambridge
    index: 2
  - name: ElectroScience Laboratory, The Ohio State University
    index: 3
  - name: Facebook Connectivity Lab, Facebook Research
    index: 4
date: 27 January 2020
bibliography: paper.bib
---

# Summary

Billions of people still do not have access to a basic, reliable internet connection. One of the most effective ways to provide wide area access to a disperate user base is via wireless radio technologies, such as cellular 4G or 5G. This is because the costs of deployment are considerably lower, which is beneficial in areas with low per capita income or adoption.

There is consensus that data science methods can help us to more accurately identify unconnected groups and help to design least-cost internet access strategies. However, many of the statistical tools in the field are written in Python and therefore there is a language conflict with classical models which many not have yet been deployed in this newer programing language.  

The Longley Rice Irregular Terrain Model is a classic propagation model developed by the Central Radio Propagation Laboratory during the 1960s in Colorado, USA, by A.G. Longley and P.L. Rice. The model is still pervasively used throughout the cellular industry by Mobile Network Operators (MNOs) as it can predict long-term median transmission loss over irregular terrain. The original open-source model is available in Fortran 88 or C. However, there is no current Python implementation. 

The Longley Rice Irregular Terrain Model (``itmlogic``) implements the classic Longley-Rice model enabling the quantification of propagation loss over irregular terrain in decibels (dB). ``itmlogic`` is capable of modeling the estimated propagation loss at different levels of user-defined confidence intervals.  

##INSERT SLIDE ON STRUCTURE OF ITMLOGIC MODULES
![Longley-Rice Irregular Terrain Model Scripts, Routines and Functions](lritm_box_diagram.png)

## Statement of Need

Smaller Mobile Network Operators may not have their own in-house engineering models. While other software packages are available, they need to be commerically licensed. Hence, this open-source package can help keep outgoings low for MNOs working to connect communities in rural and remote regions where costs are high and returns low. 

## Uniqueness

The software is unique because unlike the industry-standard Long-Run Incremental Cost modelling approach, which is predominantly spreadsheet-based, the ``cdcam`` explicitly models the spatio-temporal roll-out of a new generation of cellular technology (e.g. 5G roll-out).

Such a framework allows users to explore how different infrastructure strategies based on heterogeneous technologies perform in terms of the capacity provided, the degree of population coverage, and the necessary investment costs.

## Spatial Units

The estimation approach can be used with any digital elevation data, for any desired geographic area. 

## The Longley-Rice Model

The model purpose is to estimate the main characteristics of a radio link received signal level. Although this is a random phenomenon it can be represented by cumulative distributions. The model originally was created in the 1960s when television broadcasting and terrestrial radio were important systems that required better engineering [@Hufford:1982]. 

The model assumes a radio link which exists in three-dimensional space on earth, with the model inputs being a quantiative description of the link conditions. Two modes of prediction are available for use. Firstly, area prediction mode estimates the received signal by utilizing empirical medians. Secondly, point-to-point mode requires additional data, in partiular a quantiative description of the profile of terrain which the signal must travel across [@Hufford:1995]. 

## Cellular capacity estimation

A common way to estimate the system capacity of a cellular network is via stochastic geometry methods. In this model we make use of another open-source Python library with stochastic geometry capabilities, the Python Simulator for Integrated Modelling of 5G, ``pysim5G`` [@Oughton:2019b]. Using ``pysim5G``, a capacity lookup table is generated using a set of simulations for each frequency band, for inter-site distances ranging from 400m to 30km. This lookup table is provided with the ``cdcam`` release in the data folder.

## Applications

The median propagation loss estimates produced by ``itmlogic`` could be used with other link budget estimation software to assess the capacity, coverage and cost of 5G infrastructure. For example, this could include application via the path loss module of the Python Simulator for Integrated Modelling of 5G, ``pysim5G`` [@Oughton:2019b].

## Acknowledgements

We would like to acknowledge the funding which has enabled development of itmlogic, from the EPSRC via (i) the Infrastructure Transitions Research Consortium Mistral project (EP/N017064/1) and (ii) Facebook Connectivity Lab's Rural Connectivity program.

# References


	
