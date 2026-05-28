# Genoa Deploy Checklist

Use this checklist for every promote-to-prod and every sidecar URL
rotation. The intent is to catch the small set of misconfigurations
that have historically broken filings (wrong sidecar URL → exhibit
quietly degrades; wrong DB SSL flag → /readyz returns sidecars but no
DB; etc.).

## 1. Env vars

Required (Genoa runs without them but with reduced fidelity — set them
unless you are deliberately running a stateless demo):

```
# Database
DATABASE_URL                          # full Postgres DSN
PG_SSL_REJECT_UNAUTHORIZED=false      # managed PG with self-signed cert

# Authoritative sidecars (filing_effect = authoritative)
FORTRAN_FCC_SIDECAR_URL               # §73.313 / TVFMFS reference engine
FCCAM_SIDECAR_URL                     # §73.182 AM skywave
FCC_SUN_SIDECAR_URL                   # §73.99 PSRA/PSSA sunrise/sunset
FCC_CONTOURS_URL                      # geo.fcc.gov contours (or proxy)
FCC_LMS_URL                           # FCC LMS / public-files (or proxy)
ASR_SIDECAR_URL                       # §17.4 ASR cross-check
FAA_OE_SIDECAR_URL                    # FAA 7460-1 OE/AAA
TERRAIN_SIDECAR_URL                   # terrain HAAT / itmlogic / SPLAT
POPULATION_EVIDENCE_URL               # population sidecar (operator)
ZTR_BASE_URL                          # ZTR facility + LOS

# Advisory / observability (filing_effect = none)
AM_PHYSICS_SIDECAR_URL                # SOMNEC2D advisory physics
NEC_SIDECAR_URL                       # NEC2++ / PyNEC antenna model
GEO_RF_EVIDENCE_SIDECAR_URL           # Tree canopy / landcover
SPLAT_SIDECAR_URL                     # SPLAT advisory
IDENTITY_SIDECAR_URL                  # RadioDNS / EAS identity
MAP_SIDECAR_URL                       # Contour-map page renderer
MEASUREMENT_SIDECAR_URL               # Optional telemetry collector
```

Auth secrets (set only for sidecars whose contract requires them):

```
FCC_SUN_API_TOKEN                     # bearer for the FCC sunrise sidecar
GENOA_API_TOKEN                       # bearer that protects /api/* writes
SESSION_SECRET                        # cookie signing
```

Optional toggles (defaults usually fine):

```
POPULATION_USE_ACS=1                  # prefer ACS 5-year over decennial
POPULATION_DISABLE_FCC_CENSUS=1       # forbid the FCC Census fallback
FCC_CONTOURS_DISABLE=1                # disable direct geo.fcc.gov fallback
FCC_LMS_DISABLE=1                     # disable FCC LMS direct fallback
GENOA_BERRY_SKYWAVE_FALLBACK=false    # disallow Berry fallback when FCCAM missing
```

## 2. Confirm /readyz is green

After deploy completes, hit the readiness endpoint and verify:

```
curl -sS https://<host>/readyz | jq
```

Acceptance:

* `.ok == true`
* `.db_configured == true` and `.db_healthy == true` (unless this is a
  stateless deploy)
* For each sidecar you set: `.sidecars["<name>"].healthy == true`
* For each authoritative sidecar (`filing_effect == "authoritative"`):
  must be `configured == true` and `healthy == true` before accepting
  filings on this deploy.

A quick green-check filter:

```
curl -sS https://<host>/readyz \
  | jq '.sidecars | to_entries[] | select(.value.filing_effect=="authoritative" and (.value.healthy != true))'
```

If that query returns **any** entries, do NOT promote — fix or roll
back per `RUNBOOK.md`.

## 3. DB probe

```
curl -sS https://<host>/health/db | jq
```

Verify `database`, `user`, and `version` are populated. If the body
includes an SSL error, set `PG_SSL_REJECT_UNAUTHORIZED=false` on a
managed Postgres provider and redeploy.

## 4. Sample exhibit smoke command

Run a single low-cost exhibit to confirm the orchestrator can walk all
fallback tiers end-to-end:

```
curl -sS -X POST https://<host>/api/exhibit \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $GENOA_API_TOKEN" \
  -d '{
        "service": "FM",
        "callsign": "KQED-FM",
        "studio_only": true
      }' \
  | jq '.evidence | { engine, sidecars_used, warnings }'
```

Acceptance:

* HTTP 200
* `.evidence.engine` is `tvfm_curves` or `fortranFcc` (never empty)
* `.evidence.warnings` contains no `SIDECAR_UNAVAILABLE` for any
  sidecar whose env var you set above
* The orchestrator emits a non-empty `evidence.sidecars_used` list.

If any of those fail, do **not** promote — see `RUNBOOK.md` for triage.

## 5. Rollback gate

Before declaring a deploy successful, confirm you can roll back in
under one minute (App Platform: prior deployment is one click; bare
metal: prior image tag is pinned). The rollback procedure itself is
in `RUNBOOK.md`.
