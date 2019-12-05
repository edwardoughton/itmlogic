import pytest
from itmlogic.qlra import qlra

def test_qlra(
    setup_prop_to_test_qlra,
    setup_final_prop_to_test_qlra
    ):

    actual_answer = qlra([2,2], setup_prop_to_test_qlra)

    expected_answer = setup_final_prop_to_test_qlra

    assert actual_answer['he'] == expected_answer['he']
    assert actual_answer['dl'] == expected_answer['dl']
    assert actual_answer['the'] == expected_answer['the']
    assert actual_answer['mdp'] == expected_answer['mdp']
    assert actual_answer['klim'] == expected_answer['klim']
