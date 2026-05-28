# Minimal Makefile for the FCCAM sidecar.  The image build invokes
# `make fccam` to produce the binary; the python wrapper invokes
# the binary via subprocess.
#
# Fccam.for is FCC's published Wang-skywave program (47 CFR §73.190(c)).
# 17 USC §105 — US Government work product, public domain — but we
# don't bundle it; the operator drops it in at build time.

FC      ?= gfortran
FFLAGS  ?= -O2 -fno-automatic -std=legacy -ffixed-line-length-none -w

fccam: Fccam.for
	$(FC) $(FFLAGS) -o fccam Fccam.for

clean:
	rm -f fccam *.o

.PHONY: clean
