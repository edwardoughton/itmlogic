# Genoa agents — deployment autonomy

The exact rules under which the agent system is allowed to push code to production.

## TL;DR

Agents can write to production **only** when all of these are true simultaneously:

1. `AGENT_DEPLOY_MODE=safe_prod_write` (default is `pr_only`)
2. `agents/state/production-lock.json.locked === false`
3. Current UTC hour ∈ `[AGENT_ALLOWED_DEPLOY_WINDOW_START, AGENT_ALLOWED_DEPLOY_WINDOW_END]`
4. Today's deploy count `< AGENT_MAX_DEPLOYS_PER_DAY`
5. All pre-merge gates pass (`agents/scripts/safe-merge.sh`)
6. If RF/regulatory paths changed: three-way approval recorded for HEAD sha
7. Current branch is one of the operator-controlled deploy branches

If any one fails, `safe-deploy-digitalocean.sh` exits non-zero and no deploy happens.

## How to enable `safe_prod_write` mode

There are three places this env var can be set, in increasing order of caution:

### 1. Local one-off (operator at terminal)

```bash
cd /path/to/itmlogic
export AGENT_DEPLOY_MODE=safe_prod_write
export DIGITALOCEAN_ACCESS_TOKEN=<your DO PAT>
export DIGITALOCEAN_APP_ID=ee09120d-dee3-43b3-bc85-da39d3f43ad2
export PRODUCTION_URL=https://genoaiq.com
npm run agents:deploy
```

The script will refuse if the production lock is set, if pre-merge gates fail, etc. Use this when you want to manually drive the gated deploy without GH Actions.

### 2. GitHub Actions workflow dispatch (recommended for automation)

In the repo: **Actions → agent-safe-prod-write → Run workflow**
- `mode = safe_prod_write`
- `reason = "<why are you deploying now>"`

The workflow runs every gate before deploying. Each manual run is auditable (who, when, why) in the Actions log.

### 3. Scheduled cron (NOT recommended — kept as `report_only`)

The scheduled trigger (every 6h) intentionally hard-codes `mode=report_only`. Agents collect findings + open PRs, but the cron never auto-deploys. Production writes always require a deliberate workflow dispatch.

To allow scheduled deploys (not recommended), set repo variable `AGENT_DEPLOY_MODE=safe_prod_write`. **This is a footgun** — every 6h cron will then attempt a deploy. Almost certainly you want manual dispatch instead.

## How rollback works

### Auto-rollback (the default path)

When `safe-deploy-digitalocean.sh` runs:

1. **Before push:** records `last_good_sha` + `last_good_deploy_id` from DO (the currently-active deployment) into `agents/state/deploy-history.json`
2. **Push:** runs `git push origin <branch>`; DO auto-deploys on push
3. **Wait:** polls `/v2/apps/{id}` until `active_deployment.phase=ACTIVE` and `services[].source_commit_hash` matches the just-pushed sha (15-minute deadline)
4. **Smoke:** runs `post-deploy-smoke-test.sh` (`/healthz`, `/readyz`, contour readiness, filing-package summary, p95 latency, crash-loop scan)
5. **On smoke failure:**
   - `rollback-digitalocean.sh "post-deploy smoke failed for <new_sha>"` is invoked
   - POSTs `/v2/apps/{id}/deployments { rollback: { deployment_id: last_good_deploy_id } }`
   - Waits for the rollback deployment to reach ACTIVE
   - Writes `agents/reports/incidents/incident-<ts>.md`
   - Opens GitHub issue tagged `incident`, `auto-rollback`, `priority/high`
   - Auto-locks production via `lock-prod.sh` — no further deploys until operator unlocks

### Manual rollback

```bash
npm run agents:rollback -- "<reason>"
```

Reads `agents/state/deploy-history.json.last_good_sha`. Same flow as auto-rollback but operator-initiated. Still writes an incident and still auto-locks production after, so the operator can investigate without further automated deploys racing in.

### Recovering from auto-rollback

After auto-rollback fires, the production lock is engaged. To resume agent-initiated deploys:

1. Read the incident report under `agents/reports/incidents/`
2. Fix the underlying problem (open a PR via the agent system or by hand)
3. Get the PR through the normal pre-merge gates
4. Once the new code is on the deploy branch, run:
   ```bash
   npm run agents:unlock-prod -- "fixed root cause from incident <ts>"
   ```
5. Either run `npm run agents:deploy` manually or wait for the next workflow dispatch

The audit log in `production-lock.json` preserves every lock + unlock with reason, who, and when.

## Multi-agent approval (RF/regulatory changes)

When the diff touches `genoa/src/engine/{fm,am,haat,curves,coverage}/**`, the deploy script enforces three-way approval. The approvals are written to `agents/state/deploy-approvals.json` like this:

```json
{
  "approvals": [
    {
      "agent":      "principal-rf-engineer",
      "change_sha": "abc123…",
      "approved":   true,
      "approved_at":"2026-05-21T18:00:00Z",
      "reason":     "Golden suite passes + manual review of the new bivariate fit confirms FCC reference parity"
    }
  ]
}
```

The deploy script reads this file and refuses to push until it finds an `approved: true` row for the HEAD sha from each of:

- `principal-rf-engineer`
- `fcc-auditor`
- `program-director`

This file is written by the agents themselves during their normal runs — each agent's `agent.md` documents when it should record an approval. For first-deploy bootstrap or operator override, the operator can hand-edit this file.

## What "safe" guarantees and doesn't guarantee

**Safe means:**
- The agent system will not push code that fails the gates.
- Failed deploys are automatically rolled back.
- Production lock is honored everywhere.
- Every deploy + rollback is logged.

**Safe does NOT mean:**
- Zero possibility of bad code reaching production. If a regression is BOTH (a) accepted by the locked golden snapshots AND (b) invisible to the smoke test, it can ship. Mitigation: review the golden snapshots quarterly; expand the smoke test when new failure modes are observed.
- Bulletproof against malicious agent runs. The scripts assume the agent runner is honest. If an attacker compromises `GITHUB_TOKEN` or `DIGITALOCEAN_ACCESS_TOKEN`, they can bypass everything. Rotate secrets routinely.

## Quick reference

| What | Command |
|---|---|
| Check production-lock state | `npm run agents:check-lock` |
| Lock production writes | `npm run agents:lock-prod -- "<reason>"` |
| Unlock production writes | `npm run agents:unlock-prod -- "<reason>"` |
| Run a single agent | `npm run agents:rf` (or `agents:fcc`, `agents:pmp`) |
| Full agent pass | `npm run agents:audit` |
| Long-running loop | `npm run agents:loop` |
| Smoke test prod | `npm run agents:smoke` |
| Manual deploy (gated) | `npm run agents:deploy` |
| Manual rollback | `npm run agents:rollback -- "<reason>"` |
| Regulatory regression test | `npm run agents:regulatory` |
| Golden output compare | `npm run agents:golden` |
