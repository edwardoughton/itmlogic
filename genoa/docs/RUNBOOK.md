# Genoa On-Call Runbook

Operational responses for the most common failure modes. Keep this
document short and prescriptive — every incident step assumes the
on-call is half-awake at 03:00.

## 0. Triage flow (start here)

```
1. Open /readyz                 → is .ok=true and .db_healthy=true?
2. Open /api/sources/health     → is all_critical_have_a_reachable_source=true?
3. Read recent /api/exhibit logs → any SIDECAR_UNAVAILABLE warnings?
4. Decide:
   - DB only failure            → §2 DB recovery
   - One sidecar dead           → §3 Sidecar failure
   - Multiple sidecars dead     → §4 Rollback
   - FCC reviewer complains     → §5 Verify-cert flow
```

If `/readyz` itself does not respond, the container is down — restart
or fail over before continuing.

## 1. Incident triage at 03:00 (a sidecar just died)

A page typically arrives because a probe job hit `/readyz` and found
one or more sidecars `healthy=false`. The decision tree:

1. **Identify which sidecar.** From the page body or via:
   ```
   curl -sS https://<host>/readyz | jq '.sidecars | to_entries[] | select(.value.healthy==false)'
   ```
2. **Check `filing_effect`.**
   * `none` → the deploy is still safe to accept filings. File a
     follow-up ticket; do not wake anyone else.
   * `authoritative` → continue to step 3.
3. **Is the upstream provider down?** Probe the sidecar's own
   `/health` directly (URL printed in `.sidecars[<name>].baseUrl`). If
   200, the network path between Genoa and the sidecar is the problem
   — check egress / DNS / firewall. If non-200 or no response, the
   sidecar process or its upstream is down.
4. **Mitigate immediately:** if Genoa has a documented fallback (see
   the canonical fallback matrix in `services/sidecars.js`), confirm
   the next tier is reachable in `/api/sources/health`. Genoa walks
   that chain automatically — no operator action needed if a tier is
   green.
5. **If no fallback is configured or all tiers are red** → roll back
   (§4).
6. **File an incident.** Pin the failing sidecar's commit SHA and the
   exact `/readyz` snapshot in the ticket.

## 2. DB recovery

Symptoms: `/readyz` returns `db_healthy=false` and `/health/db` shows
a connection error.

1. **Confirm the pool is configured.** `.db_configured == false` means
   `DATABASE_URL` is unset — the app is in stateless mode by design,
   no action needed.
2. **SSL cert mismatch** (most common on managed Postgres):
   `/health/db` shows `self-signed certificate in certificate chain`.
   Fix: set `PG_SSL_REJECT_UNAUTHORIZED=false` and redeploy.
3. **Wrong host / credentials:** rotate `DATABASE_URL`; redeploy.
4. **Provider outage:** Genoa is safe to run stateless — pages that
   depend on the DB will return a structured `DB_UNAVAILABLE` warning
   rather than a 500. Wait for provider status to recover; no
   rollback required.

## 3. Sidecar failure responses

| Failing sidecar    | Filing impact                             | Immediate action                                                                                                  |
|--------------------|-------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| fortranFcc         | FM/TV §73.313 parity check unavailable    | Genoa falls back to vendored `tvfm_curves`; flag-warn but continue. Investigate upstream within business hours.   |
| fccam              | AM §73.182 night skywave authority lost   | If `GENOA_BERRY_SKYWAVE_FALLBACK=true`, Berry analytical fallback runs (SCREENING grade). Otherwise pause AM-night filings. |
| sun                | §73.99 PSRA/PSSA reduced-power blocked    | Pause AM sunrise/sunset filings until restored.                                                                   |
| fccContours        | Direct geo.fcc.gov contour fetch lost     | ZTR `_fcc_contour` covers; verify ZTR healthy. If both down, engine self-computes (warn).                         |
| fccLms             | LMS / public-file lookups offline         | Pause filings that need verbatim FCC license data; resume after restore.                                          |
| asr                | §17.4 ASR cross-check unavailable         | Pause tower exhibits.                                                                                             |
| faaOe              | FAA 7460-1 determination unavailable      | Pause tower exhibits.                                                                                             |
| terrain            | Terrain HAAT primary lost                 | Tier-2 (ZTR) or tier-3 (USGS+OpenMeteo+OpenTopoData) auto-takes over; verify in `/api/sources/health`.             |
| population         | Population sidecar lost                   | ACS or FCC Census Block fallback auto-engages; verify.                                                            |
| amPhysics          | SOMNEC2D advisory only                    | No filing impact — defer.                                                                                         |
| nec                | NEC2++ advisory only                      | No filing impact — defer.                                                                                         |
| geoRfEvidence      | Tree-canopy / landcover advisory          | No filing impact — defer.                                                                                         |
| splat              | SPLAT advisory                            | No filing impact — defer.                                                                                         |
| identity           | RadioDNS / EAS identity                   | No filing impact — defer; ZTR rich-station may cover.                                                             |
| map                | Contour-map page renderer                 | Engineering-statement PDF emits the deferred-to-engineer placeholder. Defer.                                      |
| measurement        | Telemetry only                            | No filing impact — defer.                                                                                         |

Every "defer" decision must still file a ticket — silent degradation
is exactly the failure mode this runbook exists to prevent.

## 4. Rollback procedure

Use when (a) two or more authoritative sidecars are red, (b) a new
deploy correlates with rising 5xx, or (c) a regression in exhibit
output is reported.

App Platform / managed:

```
# Identify the prior good deployment
doctl apps list-deployments <APP_ID>

# Pin to it
doctl apps create-deployment <APP_ID> --image <prior-sha>
```

Bare metal / self-hosted:

```
docker pull ghcr.io/<org>/genoa:<prior-sha>
docker stop genoa && docker rm genoa
docker run -d --name genoa --env-file .env -p 8080:8080 ghcr.io/<org>/genoa:<prior-sha>
```

Post-rollback validation: re-run all of `DEPLOY_CHECKLIST.md §2-4`.
Do not declare recovery until the sample exhibit smoke command
returns HTTP 200 with no new `SIDECAR_UNAVAILABLE` warnings.

## 5. DB recovery (data loss / corruption)

For pool-level outages, see §2. For actual data loss:

1. **Stop writes.** Set the deploy to read-only by unsetting
   `GENOA_API_TOKEN` — the orchestrator will reject mutating requests
   with 401.
2. **Snapshot first.** Take a point-in-time snapshot before any
   recovery action. If the provider supports PITR (DigitalOcean
   Managed Postgres, RDS), prefer that over `pg_dump`.
3. **Restore.** Use the provider's restore-to-new-cluster flow; never
   restore in place. Point `DATABASE_URL` to the restored cluster and
   redeploy.
4. **Reconcile.** Run `/health/db` against the new cluster and
   compare the row counts to the snapshot before declaring recovery.
5. **Post-incident.** Re-enable `GENOA_API_TOKEN` only after a
   filing-smoke run (one AM and one FM exhibit) completes cleanly.

## 6. Verify-cert flow for FCC reviewers

An FCC reviewer or counsel may ask: "what engines produced these
numbers, and were any of them substitutions?" Use this flow:

1. **Pull the exhibit's evidence block.** Every exhibit returned by
   `/api/exhibit` ships an `evidence` object that records:
   * `engine` — the primary engine name (e.g., `fortranFcc`,
     `tvfm_curves`, `fccam`, `berry_skywave`).
   * `sidecars_used` — the array of sidecars actually consulted.
   * `warnings` — any `SIDECAR_UNAVAILABLE`, `TERRAIN_NOT_APPLIED`,
     `POPULATION_PLACEHOLDER`, etc.
2. **Cross-check against /readyz at exhibit time.** The PDF footer
   includes the deploy SHA and the `/readyz` snapshot timestamp.
   Replay that snapshot from your audit-log table or from the
   `evidence.health_snapshot` field embedded in the JSON.
3. **Walk the registry.** For each sidecar listed in
   `evidence.sidecars_used`, look up its `filing_effect` in
   `SIDECAR_REGISTRY.md`. Any `authoritative` entry that was healthy
   at exhibit time is a defensible source.
4. **Disclose substitutions.** If `evidence.warnings` includes a
   substitution (e.g., FCCAM unavailable → Berry fallback), the
   exhibit text already labels that page as SCREENING grade and cites
   §73.190(c) for the permission to use a different model. Point the
   reviewer at the labeled page.
5. **Hand-off.** Provide the reviewer with:
   * the exhibit PDF,
   * the exhibit JSON (full evidence object),
   * the `/readyz` snapshot at exhibit time,
   * the SHA of `genoa/src/api/services/sidecars.js` in effect.

This four-artifact bundle is the verify-cert package.
