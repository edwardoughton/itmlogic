from itmlogic.diffraction_attenuation.fht import fht


def test_fht():
    """
    Tests the supporting function for the height gain in the "three radii method" used
    in the computation of diffractive attenuation, as described in equations (4.20) and
    (6.2)-(6.7) of "The ITS Irregular Terrain Model, version 1.2.2: The Algorithm" with
    inputs corresponding to the "x" and "K" parameters of these equations.
    """
    x = 372.8075813962142
    pk = 0.0015012964882592428

    actual_answer = fht(x, pk)

    expected_answer = -11.915375775262177

    assert actual_answer == expected_answer

    assert round(fht(150, 20), 2) == 11.05

    assert round(fht(150, 1e-6), 2) == -29.96
