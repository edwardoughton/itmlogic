import pytest
from itmlogic.dlthx import dlthx

def test_dlthx(setup_pfl1):

    assert round(dlthx(setup_pfl1, 2158.5, 77672.5), 4) == 89.2126


    