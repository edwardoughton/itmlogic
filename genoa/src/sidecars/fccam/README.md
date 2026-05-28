# Genoa FCCAM sidecar

HTTP wrapper around the FCC's public-domain **Fccam.for** skywave
program — the same code that backs the FCC's published AM
nighttime allocation tables under 47 CFR §73.182 / §73.190.

This sidecar deliberately mirrors the architecture of
`fcc-fortran-engine` (the FM TVFMFS_METRIC wrapper that already
runs on the operator droplet): one FORTRAN binary, one FastAPI
process, one `/run` endpoint that returns a result + an
`input_sha256` for replay determinism.

Genoa-side client: [`genoa/src/evidence/fccamClient.js`](../../evidence/fccamClient.js).

## Why a separate sidecar from the FM one?

`Fccam.for` is a different program from `Tvfmfs.for`.  The FCC ships
them separately and they parse different input formats.  Co-locating
them in one container would mean cross-coupling their version
contracts; keeping them split keeps each one's provenance independent
(reviewers can check the source SHA of just the program they care about).

## What we do NOT bundle

We do not commit `Fccam.for` to this repo.  The FCC publishes it
on their AM engineering page; the operator drops it into this
directory before `docker build`.  The Dockerfile fails the build
if `Fccam.for` is missing — silently producing a stub binary
would defeat the entire point of the parity check.

## Operator deploy (on droplet, alongside the FM sidecar)

```bash
ssh root@159.223.153.153

# 1. Get the source from the FCC.  Drop it into this directory.
curl -fsSLo /tmp/Fccam.for \
  "https://www.fcc.gov/media/radio/am-skywave-program/Fccam.for"
#   (or whichever official URL the FCC currently serves it at)

# 2. Build.
cd /tmp/genoa-tmp/genoa/src/sidecars/fccam
cp /tmp/Fccam.for .
docker build -t genoa-fccam .

# 3. Run.  Pick any port free on the droplet (8090 default).
TOKEN="$(openssl rand -hex 32)"
docker run -d --name genoa-fccam \
  -p 8090:8090 \
  -e FCCAM_API_TOKEN="$TOKEN" \
  --restart unless-stopped \
  genoa-fccam

# 4. Verify.
curl -sS -H "Authorization: Bearer $TOKEN" \
  http://localhost:8090/version | jq

# 5. Wire to App Platform.  Two env vars:
#      FCCAM_SIDECAR_URL=http://159.223.153.153:8090
#      FCCAM_API_TOKEN=$TOKEN  (mark SECRET in the app spec)
```

## Endpoints

| Method | Path        | Description                                  | Auth     |
|--------|-------------|----------------------------------------------|----------|
| GET    | /healthz    | Liveness + binary-present flag               | none     |
| GET    | /version    | Engine + source + binary SHAs, build time    | bearer   |
| POST   | /run        | Single skywave compute                       | bearer   |
| POST   | /run-batch  | Vectorized compute (1..1024 inputs)          | bearer   |

`/run` request shape — see `main.py::RunRequest`:

```json
{
  "erp_kw": 50.0,
  "freq_khz": 700,
  "distance_km": 425.7,
  "midpoint_lat": 39.5,
  "percent_time": 50,
  "mode": "field_at_distance"
}
```

Response includes `input_sha256` (canonical hash over the normalized
inputs) so reviewers can match an exhibit row to a hand-replay of
the same call.

## Bringing the sidecar up against the golden suite

After `docker run`, point the Genoa golden suite at the new sidecar:

```bash
FCCAM_SIDECAR_URL=http://localhost:8090 \
FCCAM_API_TOKEN="$TOKEN" \
  node --test genoa/src/tests/fccamClientIntegration.test.js
```

The integration suite is skipped automatically when `FCCAM_SIDECAR_URL`
is unset (CI default), so it never blocks the regular test run.

## Regulatory references

- 47 CFR §73.182 — AM nighttime engineering standards of allocation
- 47 CFR §73.190(c) — Wang formula explicitly permitted for skywave
- 17 USC §105 — FCC code is US Government work product, public domain
