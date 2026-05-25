# Genoa NEC sidecar

NEC2++ / PyNEC Method-of-Moments antenna modeling, running as an
**isolated sidecar process** that Genoa talks to over HTTP.

## Why a separate sidecar

NEC2++ ([tmolteno/necpp](https://github.com/tmolteno/necpp)) is **GPL
v2**.  Genoa's main codebase is not GPL.  The license boundary is
enforced by keeping NEC2++ in this sidecar — the API container
**never** imports, links, or statically embeds NEC2++ / PyNEC.  Every
result is treated as external evidence carrying
`provenance.license_boundary = "external sidecar"`.

## Regulatory uses (Genoa side)

- **47 CFR §73.62 / §73.150** — directional AM RTA (radiation
  theoretical analysis) for new tower-array applications and major
  modifications.
- **47 CFR §73.45** — MEOV monitor-point fields for licensed
  directional AM proof of performance.
- **47 CFR §1.1310 / OET-65** — near-field RF exposure at AM
  frequencies, where the far-field formulas in `engine/regulatory/oet65.js`
  are not valid within λ/(2π) (≈ 47 m at 1 MHz).

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| `GET`  | `/health` | Liveness + PyNEC availability probe. Always 200. |
| `POST` | `/model/run` | Run an arbitrary wire-segment model. |
| `POST` | `/model/am-array` | Convenience: build vertical-tower AM array from `frequency_khz` + `towers[]` and run. |
| `POST` | `/model/near-field` | Add additional probe points to an existing model and run. |

### Request — `POST /model/run`

```json
{
  "frequency_mhz": 1.0,
  "ground": {
    "type": "sommerfeld",
    "conductivity_s_m":  0.005,
    "dielectric_constant": 13
  },
  "wires": [
    {
      "tag": 1, "segments": 21,
      "x1": 0, "y1": 0, "z1": 0,
      "x2": 0, "y2": 0, "z2": 75,
      "radius_m": 0.25
    }
  ],
  "excitations": [
    { "tag": 1, "segment": 1, "voltage_real": 1, "voltage_imag": 0 }
  ],
  "pattern": {
    "theta_start": 90, "theta_stop": 90, "theta_step": 1,
    "phi_start":   0,  "phi_stop": 359,  "phi_step":  1
  },
  "near_field": {
    "enabled": true,
    "points": [{ "x": 10, "y": 0, "z": 2 }]
  }
}
```

### Response

```json
{
  "ok": true,
  "model_valid": true,
  "frequency_mhz": 1.0,
  "geometry": { "n_wires": 1, "total_length_m": 75, "n_segments": 21 },
  "ground":   { "type": "sommerfeld", "conductivity_s_m": 0.005, "dielectric_constant": 13 },
  "feedpoint": { "r_ohm": 36.5, "x_ohm": 21.4, "vswr_50": 1.43 },
  "pattern":   { "theta_deg": [...], "phi_deg": [...], "gain_dbi": [[...]] },
  "near_field": [
    { "x": 10, "y": 0, "z": 2, "e_v_m": 12.3, "h_a_m": 0.04, "s_mw_cm2": 0.2 }
  ],
  "warnings": ["..."],
  "provenance": {
    "engine":           "necpp/PyNEC",
    "source":           "NEC2++ sidecar",
    "license_boundary": "external sidecar",
    "sidecar_version":  "0.1.0",
    "generated_at":     "2026-...",
    "model_hash":       "sha256-of-canonical-input"
  }
}
```

## Local development

⚠️ Two install gotchas on Debian/Ubuntu:

1. There is **no `nec` apt package** on Bookworm / Jammy any more.
2. The PyPI `PyNEC` sdist is **broken** — it ships without the
   `necpp_src/` subdirectory the build needs, so `pip install PyNEC`
   produces a stub `.so` with no `PyInit__PyNEC` symbol and you get
   `ImportError: dynamic module does not define module export function`
   on import.

**The reliable path** (what the Dockerfile in this repo does):

```bash
# Build deps
sudo apt-get install -y \
    git build-essential autoconf automake libtool \
    swig pkg-config python3 python3-pip python3-numpy python3-dev

# Clone the real source repo (NOT pip).  --recurse-submodules pulls
# the necpp_src C++ engine.
git clone --depth=1 --recurse-submodules \
    https://github.com/tmolteno/python-necpp.git
cd python-necpp/necpp_src
make -f Makefile.git
./configure --without-lapack
make -j$(nproc)
sudo make install
sudo ldconfig

cd ../PyNEC
ln -s ../necpp_src .
swig -Wall -c++ -python PyNEC.i
sudo pip3 install --no-build-isolation --break-system-packages .

# Verify
python3 -c "import PyNEC; print(PyNEC.__file__)"

# Run the sidecar (back in genoa repo)
cd ~/genoa/src/sidecars/nec
SIDECAR_PORT=8085 node server.js
```

Smoke-test:

```bash
curl -s http://localhost:8085/health | jq
# expect { "pynec_available": true, ... }

curl -s -X POST -H 'content-type: application/json' \
  -d '{"frequency_mhz":1.0,"ground":{"type":"pec"},
       "wires":[{"tag":1,"segments":21,"x1":0,"y1":0,"z1":0,
                  "x2":0,"y2":0,"z2":75,"radius_m":0.25}],
       "excitations":[{"tag":1,"segment":1,"voltage_real":1,"voltage_imag":0}],
       "pattern":{"theta_start":90,"theta_stop":90,"theta_step":1,
                  "phi_start":0,"phi_stop":355,"phi_step":45}}' \
  http://localhost:8085/model/run | jq '.pattern.gain_dbi[0]'
# expect: a row of ~5.08 dBi (textbook quarter-wave monopole gain)
```

## Docker (recommended)

The Dockerfile uses a multi-stage build that compiles NEC2++ + PyNEC
from the `tmolteno/python-necpp` source repo (avoiding both the
missing `nec` apt package and the broken PyPI sdist).

```bash
docker build -t genoa-nec-sidecar:0.1.0 .
docker run --rm -p 8085:8085 genoa-nec-sidecar:0.1.0
# HEALTHCHECK verifies pynec_available:true at boot.

curl -s http://localhost:8085/health | jq
```

## Genoa API integration

Set `NEC_SIDECAR_URL` on the Genoa API deploy:

```
NEC_SIDECAR_URL=http://nec-sidecar:8085
```

When the sidecar is unreachable or PyNEC is missing, Genoa emits a
`NEC_MODEL_UNAVAILABLE` warning but compute does not fail — the
exhibit ships without the NEC evidence section.

## Warnings emitted on the Genoa side

| Code | Meaning |
|---|---|
| `NEC_MODEL_UNAVAILABLE` | Sidecar unreachable or PyNEC not installed. |
| `NEC_MODEL_INVALID_GEOMETRY` | Caller-supplied model failed schema / sanity. |
| `NEC_GROUND_MODEL_LIMITATION` | PEC ground assumed; real soil typically Sommerfeld. |
| `NEC_NEAR_FIELD_APPROXIMATION` | Near-field accuracy degrades within ≈ λ/8 of conductors. |
| `NEC_LICENSE_BOUNDARY_EXTERNAL` | Stamped on every NEC evidence block — GPL boundary preserved. |
