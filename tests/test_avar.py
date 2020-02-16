import pytest
from itmlogic.avar import avar

def test_avar(
    setup_prop_to_test_avar,
    setup_prop_to_test_avar_uarea,
    ):

    actual_answer, actual_prop = avar(
        1.2817, 0, 1.2817,
        setup_prop_to_test_avar
        )

    expected_answer = 20.877472366318642

    assert actual_answer == expected_answer

    actual_answer, actual_prop = avar(
        0, 0, 0,
        setup_prop_to_test_avar_uarea
        )

    expected_answer = 33.44778607772954

    assert actual_answer == expected_answer
