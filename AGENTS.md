# Genoa autonomous agent system

Ten agents that continuously audit, propose, and (gated) deploy improvements to Genoa. Designed to run unattended for weeks at a time on DigitalOcean App Platform.

## The ten agents

| Agent | Owns | Approval authority |
|---|---|---|
| `principal-rf-engineer` | FCC propagation correctness, HAAT, terrain integration, RF scientific integrity | RF math (required) |
| `fcc-attorney` | CFR citations, filing language, waiver risk, LMS schema consistency | Filing language (co-sign) |
| `fcc-auditor` | Provenance, reproducibility, evidence chain, audit trail | RF math (required); filing language (co-sign) |
| `compliance-officer` | EAS, OET-65, public file, license tracking | Compliance gaps |
| `senior-station-engineer` | Operational practicality, transmitter chain reality | Soft (advisory) |
| `gis-terrain-scientist` | DEM, WGS-84 geodesy, polygon clipping, contour geometry | GIS math (co-sign) |
| `devsecops-agent` | Docker, CI/CD, DO safety, secrets, sidecar health, deps | Deploy gates (required) |
| `evidence-reporting-agent` | PDF layout, exhibit consistency, provenance blocks | PDF wording (co-sign) |
| `technical-pmp` | Dedup findings, file issues, sprint summary | None (process) |
| `program-director` | Coordination, deploy approval, readiness score | Final deploy approver (required) |

## Triplets that require unanimous approval

Any change touching `genoa/src/engine/{fm,am,haat,curves,coverage}/**` requires YES from:

1. `principal-rf-engineer`
2. `fcc-auditor`
3. `program-director`

Without all three, `safe-deploy-digitalocean.sh` refuses to push.

## Finding format

Every agent emits TWO artifacts per run:

1. `agents/<agent>/last-report.md` — narrative markdown for humans.
2. `agents/<agent>/last-findings.json` — strict machine-readable JSON, the **source of truth** for issue filing and dedup. Markdown is presentation only.

`last-findings.json` MUST conform to this canonical schema:

```json
{
  "agent":               "principal-rf-engineer",
  "timestamp_utc":       "2026-05-21T18:51:02Z",
  "head_sha":            "6a25ce7de82bbe5badbc6d6acb33e0412c62ded1",
  "branch":              "genoa-audit-remediation-phase2",
  "summary":             "one-line headline for the run",
  "deploy_recommendation": "APPROVE | BLOCK | WARN | NO_OP",
  "readiness_score":      null,
  "findings": [
    {
      "finding_id":            "F-001",
      "title":                 "short summary, becomes the GitHub issue title",
      "severity":              "BLOCKER | HIGH | MEDIUM | LOW | WARNING | INFO | SOFT",
      "confidence":            0.0,
      "category":              "rf-math | regulatory-citation | renderer | devsec | gis | docs | governance",
      "affected_files":        ["path/to/file.js"],
      "regulatory_scope":      ["47 CFR §73.215"],
      "recommended_fix":       "what to do",
      "tests_required":        ["test path or test name"],
      "deployment_risk":       "low | medium | high",
      "human_review_required": true,
      "reproducibility_notes": "how to reproduce the finding locally"
    }
  ]
}
```

Rules:

- `agent`, `timestamp_utc`, `head_sha`, `branch`, `summary`, `deploy_recommendation`, and `findings` are **required**.
- `findings` MUST be an array (use `[]` for a clean run).
- `severity` MUST be one of the seven enum values above.
- `deploy_recommendation` MUST be one of `APPROVE`, `BLOCK`, `WARN`, `NO_OP`.
- `readiness_score` is a number `0-100` or `null` (only `program-director` sets it).
- Validate before commit: `node agents/scripts/validate-findings-json.js agents/<agent>/last-findings.json`.

`last-report.md` MAY embed the same JSON in a fenced ` ```json ` block as a fallback for legacy parsing — but only ONE such block per file, and it MUST match the canonical schema. The pipeline prefers `last-findings.json`; the markdown block is a fallback, not a primary path.

`create-issues-from-findings.sh` dedupes against `agents/state/findings-dedup.json`. The dedup key is:

```
sha256(agent + "|" + finding_id + "|" + title + "|" + sort(affected_files))
```

Findings older than 30 days drop out of the dedup; new occurrences re-file.

### Out-of-band artifacts

`program-director` MUST NOT pack multiple JSON blocks into `last-report.md`. Side-channel state lives at:

- `agents/state/deploy-approvals.json` — append-only deploy decisions (managed by `program-director`).
- `agents/reports/audit/<agent>-<YYYY-MM-DD>.md` — daily audit summaries.

## Deploy modes

| `AGENT_DEPLOY_MODE` | Behavior |
|---|---|
| `report_only` | Agents write last-report.md only.  No GitHub writes, no PRs, no deploys. |
| `pr_only` *(default)* | Agents may file issues and open PRs.  Cannot merge, cannot deploy. |
| `safe_prod_write` | Agents may merge AND deploy, but only after every gate in `agents/scripts/safe-deploy-digitalocean.sh` passes. |

## Budget modes

| `AGENT_TOKEN_MODE` | Context / output | Iterations | Use |
|---|---|---|---|
| `conservative` | 40k / 4k | 2 | Daily incremental scan |
| `balanced` *(default)* | 120k / 8k | 4 | Quick scan + targeted deep dive |
| `deep` | 200k / 16k | 8 | Weekly full audit |
| `max_safe` | 400k / 24k | 16 | Week-long unattended runs |

| `COMPUTE_MODE` | Max workers | Parallel agents | Notes |
|---|---|---|---|
| `local_only` | 1 | 1 | Debugging |
| `parallel_agents` *(default)* | 4 | 4 | One host, agents in parallel |
| `burst_compute` | 8 | 6 | Scheduled batch (regression sweeps) |
| `heavy_analysis` | 16 | 8 | Weekly deep audit |

Parallelism rules live in `agents/runtime/compute-budget.json`. The scheduler honors them.

## Token / cost controls

Every agent has these stop conditions (defined in its `agent.md`):

- `STOP_WHEN_NO_NEW_FINDINGS=true` (default)
- Findings repeat → stop
- Tests fail the same way twice → halt with BLOCKER
- No git changes since last run → skip
- Production locked → downgrade to `report_only` for the run
- Provider rate limit approaching → write partial report + resume next loop

Each run logs (in `agents/logs/<agent>-<timestamp>.log`):
- estimated tokens used
- files inspected / files skipped
- stop reason
- whether more useful work remains

## How agents coordinate

Order of operations in a full audit (`run-all-agents.sh`):

```
parallel group 1: principal-rf-engineer, gis-terrain-scientist
parallel group 2: fcc-attorney, fcc-auditor
parallel group 3: evidence-reporting-agent, compliance-officer
parallel group 4: senior-station-engineer
parallel group 5: devsecops-agent
serialized:      technical-pmp  →  program-director
```

`program-director` reads every other agent's `last-report.md`, computes the filing-readiness score, and writes deploy approvals to `agents/state/deploy-approvals.json`. `safe-deploy-digitalocean.sh` reads those approvals before pushing.

## Production lock

`agents/state/production-lock.json` is the kill switch:

- `npm run agents:lock-prod -- "<reason>"` — block all agent-initiated deploys
- `npm run agents:unlock-prod -- "<reason>"` — restore deploy authority
- The lock is consulted by every script that touches production
- Auto-locked after any failed post-deploy smoke (rollback also fires)

## Rollback

Auto-triggered when post-deploy smoke fails. `safe-deploy-digitalocean.sh`:

1. Records `last_good_sha` + `last_good_deploy_id` BEFORE the new push
2. Pushes (DO auto-deploys on push)
3. Waits for ACTIVE
4. Runs `post-deploy-smoke-test.sh`
5. On failure → `rollback-digitalocean.sh "<reason>"` which:
   - POSTs `/v2/apps/{id}/deployments` with `rollback.deployment_id = last_good_deploy_id`
   - Waits for rollback to reach ACTIVE
   - Writes incident report to `agents/reports/incidents/`
   - Opens a GitHub issue tagged `incident`, `auto-rollback`, `priority/high`
   - Locks production (operator must unlock)

Manual rollback: `npm run agents:rollback -- "<reason>"`.

## How to run unattended for weeks

1. Configure repo secrets (Settings → Secrets):
   - `DIGITALOCEAN_ACCESS_TOKEN` — DO PAT with app r/w
   - `DIGITALOCEAN_APP_ID` — dolphin-app UUID
   - `PRODUCTION_URL` — `https://genoaiq.com`
2. Configure repo variables (Settings → Variables):
   - `AGENT_TOKEN_MODE=max_safe` (or balanced for tighter cost)
   - `COMPUTE_MODE=burst_compute` (or parallel_agents)
   - `AGENT_MAX_DEPLOYS_PER_DAY=2`
   - `AGENT_ALLOWED_DEPLOY_WINDOW_START=13`
   - `AGENT_ALLOWED_DEPLOY_WINDOW_END=22`
3. Enable the GitHub Actions workflow `agent-safe-prod-write.yml`. By default it runs every 6h in `report_only` mode and never auto-deploys.
4. To enable production writes, manually dispatch the workflow with `mode=safe_prod_write` and a written reason. The workflow is logged + auditable; every deploy is gated.
5. Monitor:
   - `agents/state/deploy-history.json` — every deploy + rollback
   - `agents/reports/incidents/` — auto-rollback incident reports
   - GitHub issues tagged `agent-finding` — open work
   - GitHub issues tagged `incident` — production events
