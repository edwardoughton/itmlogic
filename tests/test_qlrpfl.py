import pytest
from itmlogic.preparatory_subroutines.qlrpfl import qlrpfl

def test_qlrpfl(
    setup_prop_to_test_qlrpfl,
    setup_final_prop_to_test_qlrpfl,
    setup_prop_to_test_qlrpfl_pimter,
    setup_final_prop_to_test_qlrpfl_pimter,
    setup_prop_to_test_qlrpfl_pimter_5,
    setup_final_prop_to_test_qlrpfl_pimter_5
    ):
    """
    Test the preparatory subroutine for point-to-point mode, as in Section 43 by Hufford
    (see references/itm.pdf).

    """
    actual_answer = qlrpfl(setup_prop_to_test_qlrpfl)

    expected_answer = setup_final_prop_to_test_qlrpfl

    assert actual_answer['dist'] == expected_answer['dist']
    assert actual_answer['the'] == expected_answer['the']
    assert actual_answer['dl'] == expected_answer['dl']
    assert actual_answer['mdp'] == expected_answer['mdp']
    assert actual_answer['lvar'] == expected_answer['lvar']
    assert actual_answer['klim'] == expected_answer['klim']
    assert actual_answer['he'] == expected_answer['he']
    assert actual_answer['gme'] == expected_answer['gme']

    actual_answer = qlrpfl(setup_prop_to_test_qlrpfl_pimter)

    expected_answer = setup_final_prop_to_test_qlrpfl_pimter

    assert actual_answer['dist'] == expected_answer['dist']
    assert actual_answer['the'] == expected_answer['the']
    assert actual_answer['dl'] == expected_answer['dl']
    assert actual_answer['mdp'] == expected_answer['mdp']
    assert actual_answer['lvar'] == expected_answer['lvar']
    assert actual_answer['he'] == expected_answer['he']
    assert actual_answer['aref'] == expected_answer['aref']

    actual_answer = qlrpfl(setup_prop_to_test_qlrpfl_pimter_5)

    expected_answer = setup_final_prop_to_test_qlrpfl_pimter_5

    assert actual_answer['dist'] == expected_answer['dist']
    assert actual_answer['the'] == expected_answer['the']
    assert actual_answer['dl'] == expected_answer['dl']
    assert actual_answer['mdp'] == expected_answer['mdp']
    assert actual_answer['lvar'] == expected_answer['lvar']
    assert actual_answer['he'] == expected_answer['he']
    assert actual_answer['aref'] == expected_answer['aref']
