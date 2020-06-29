import pytest
from itmlogic.preparatory_subroutines.qlra import qlra

def test_qlra(
    setup_prop_to_test_qlra,
    setup_final_prop_to_test_qlra,
    setup_prop_to_test_qlra_uarea,
    setup_final_prop_to_test_qlra_uarea
    ):
    """
    Test the preparatory subroutine for area prediction mode, as described in
    equations (3.1)-(3.4) of "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm"
    and as a function of the siting criteria for the transmit and receive terminals described
    using 2 element array KST (0=random, 1= "with care", 2= "with great care").

    """
    actual_answer = qlra([2,2], setup_prop_to_test_qlra)

    expected_answer = setup_final_prop_to_test_qlra

    assert actual_answer['he'] == expected_answer['he']
    assert actual_answer['dl'] == expected_answer['dl']
    assert actual_answer['the'] == expected_answer['the']
    assert actual_answer['mdp'] == expected_answer['mdp']
    assert actual_answer['klim'] == expected_answer['klim']

    actual_answer = qlra([2,2], setup_prop_to_test_qlra_uarea)

    expected_answer = setup_final_prop_to_test_qlra_uarea

    assert actual_answer['he'] == expected_answer['he']
    assert actual_answer['dl'] == expected_answer['dl']
    assert actual_answer['the'] == expected_answer['the']
    assert actual_answer['mdp'] == expected_answer['mdp']
    assert actual_answer['klim'] == expected_answer['klim']
