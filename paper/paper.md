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
  - name: Julius Kasuma
    orcid: 
    affiliation: 4
affiliations:
  - name: Environmental Change Institute, University of Oxford
    index: 1
  - name: Computer Laboratory, University of Cambridge
    index: 2
  - name: ElectroScience Laboratory, Ohio State University
    index: 3
  - name: Facebook Connectivity Lab, Facebook Research
    index: 4
date: 27 January 2020
bibliography: paper.bib
---

# Summary

Billions of people still do not have access to a basic, reliable internet connection. One of the most effective ways to provide wide area access to a disperate user base is via wireless radio technologies, such as cellular 4G or 5G. This is because the costs of deployment are considerably lower, which is beneficial in areas with low per capita income or adoption.

There is consensus that data science methods can help us to more accurately identify unconnected groups and help to design least-cost internet access strategies. However, many of the statistical tools in the field are written in Python and therefore there is a language conflict with classical models which many not have yet been deployed in this newer programing language.  

The Longley Rice Irregular Terrain Model is a classic propagation model developed by the Central Radio Propagation Laboratory during the 1960s in Colorado, USA, by A.G. Longley and P.L. Rice. The model is still pervasively used throughout the cellular industry by Mobile Network Operators (MNOs) as it is capable of predicting long-term median transmission loss over irregular terrain. The original open-source model is  available in Fortran 88 or C. However, there is no current Python implementation. 

There is also a division between academia and industry. Whereas academia is using [ray-tracing ???] methods, industry (for historical reasons) opt for the Longley-Rice model. This causes a disconnect between those working on cutting-edge R&D and those working in industry designing engineered networks for deployment. 

The long-term aim is to reduce the costs of deployment using data science. 

The Longley Rice Irregular Terrain Model (``itmlogic``) implements the classic Longley-Rice model enabling the quantification of propagation loss over irregular terrain in decibels (dB). ``itmlogic`` is capable of modeling the estimated propagation loss at different levels of user-defined confidence intervals.  

##INSERT SLIDE ON STRUCTURE OF ITMLOGIC MODULES
![Framework for capacity/demand/strategy assessment](itmlogic.png)

The estimation approach can be used with any digital elevation data, for any desired geographic area. 

## Statement of Need

Every decade a new generation of cellular technology is standardised and released. Increasingly, given the importance of the Internet of Things, Industry 4.0 and Smart Health applications, both governments and other digital ecosystem actors want to understand the costs associated with digital connectivity. However, there are very few open-source tools to help simultaneously understand both the engineering and cost implications of new connectivity technologies such as 5G. Hence, there is a key research need for this software.

Governments currently have a strong interest in 5G, with many making it a cornerstone of their industrial strategy. But there remain many coverage issues associated with basic 2G-4G mobile connectivity, particularly in rural areas. Market-led deployment approaches have many benefits, but as the delivery of connectivity in low population density areas becomes less viable, the market will at some point fail to deliver the infrastructure to support these necessary services. Software tools can help to provide the evidence base for policy and government to develop effective strategies to address this issue.

Additionally, while many large mobile network operators have their own in-house technoeconomic network planning capabilities, smaller operators do not. As a result, engineering analysis and business case assessment often take place as separate steps, rather than as an integrated process. This is another key use case for ``cdcam`` as engineers and business analysts at smaller operators could use the software to assess the costs of delivering connectivity to target areas.

## Uniqueness

The software is unique because unlike the industry-standard Long-Run Incremental Cost modelling approach, which is predominantly spreadsheet-based, the ``cdcam`` explicitly models the spatio-temporal roll-out of a new generation of cellular technology (e.g. 5G roll-out).

Such a framework allows users to explore how different infrastructure strategies based on heterogeneous technologies perform in terms of the capacity provided, the degree of population coverage, and the necessary investment costs.


## Spatial Units

Three types of spatial units are used in the model, including sites (points), lower layer statistical units, treated here as postcode sectors (polygons), and upper layer statistical units, treated here as local authority districts (polygons). The justification for using two layers of polygon statistical units is that it allows local areas to be upgraded using a high level of spatial granularity (n=9000), but then provides a level of aggregation for reporting results in a more manageable way (n=380).

## The Longley-Rice Model

The model purpose is to estimate the main characteristics of a radio link received signal level. Although this is a random phenomenon it can be represented by cumulative distributions. The model originally was created in the 1960s when television broadcasting and terrestrial radio were important systems that required better engineering [@Hufford:1982]. 

The model assumes a radio link which exists in three dimensional space on earth, with the model inputs being a quantiative description of the link conditions. Two modes of prediction are available for use. Firstly, area prediction mode estimates the received signal by utilizing empirical medians. Secondly, point-to-point mode requires additional data, in partiular a quantiative description of the profile of terrain which the signal must travel across [@Hufford:1995]. 

## Technologies and Deployment Strategies

There are three main ways to enhance the capacity and coverage of a wireless network: improving the spectral efficiency; adding more spectrum; and building more sites.

An analogy with a highway can be a useful way to explain these techniques. Improving the spectral efficiency enables you to fit more bits per Hertz on a radio wave, which is analogous to more vehicles per lane on a highway. Adding more spectrum provides you with more lanes on the highway, in which to fit more vehicles. Finally, building more sites can enable greater spatial reuse of existing spectrum, which is analogous to increasing the density of roads in an area, reducing the level of congestion.

``cdcam`` is capable of testing all three technology options by: upgrading sites to 4G, or from 4G to 5G, hence improving spectral efficiency; adding more spectrum bands, for either 4G (0.8 and 2.6 GHz), or 5G (0.7, 3.5, 26 GHz); and building more sites (a Small Cell layer).

Each of these technology options is then grouped into a set of strategies, including: No Investment, Spectrum Integration, Small Cells, Spectrum integration and Small Cells (hybrid).

## Cellular capacity estimation

A common way to estimate the system capacity of a cellular network is via stochastic geometry methods. In this model we make use of another open-source Python library with stochastic geometry capabilities, the Python Simulator for Integrated Modelling of 5G, ``pysim5G`` [@Oughton:2019b]. Using ``pysim5G``, a capacity lookup table is generated using a set of simulations for each frequency band, for inter-site distances ranging from 400m to 30km. This lookup table is provided with the ``cdcam`` release in the data folder.

## Applications

``cdcam`` has already been used to test the capacity, coverage and cost of 5G infrastructure in Britain [@Oughton:2018a; @Oughton:2018b] and the Netherlands [@Oughton:2019a].

The model is one of several infrastructure simulation models being used in ongoing research as part of the ITRC Mistral project to analyse national infrastructure systems-of-systems, using scenarios of population change generated by ``simim`` [@simim] and connected by a simulation model coupling library, ``smif`` [@smif].

## Acknowledgements

We would like to acknowledge the funding which has enabled development of itmlogic, from the EPSRC via (i) the Infrastructure Transitions Research Consortium Mistral project (EP/N017064/1) and (ii) Facebook Connectivity Lab.

# References
