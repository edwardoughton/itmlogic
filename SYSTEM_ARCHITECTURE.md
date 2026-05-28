# Genoa autonomous agent — system architecture

## Layout

```
agents/
├── runtime/
│   ├── budget.json            ← token mode definitions
│   ├── compute-budget.json    ← compute mode + parallelism rules
│   └── job-queue.json         ← worker / job state
├── state/
│   ├── production-lock.json   ← kill switch (operator-controlled)
│   ├── deploy-history.json    ← append-only deploy log + last_good_sha
│   ├── findings-dedup.json    ← finding hash → seen_count + last_seen
│   └── deploy-approvals.json  ← (created on demand) RF-math approvals
├── reports/
│   ├── audit/                 ← agent run summaries
│   └── incidents/             ← auto-rollback incident reports
├── logs/                      ← per-run logs
├── golden/                    ← locked golden output snapshots
├── scripts/                   ← all .sh entry points (executable)
└── <agent-name>/
    ├── agent.md               ← canonical spec
    ├── checklist.md           ← pointer to agent.md
    ├── constraints.md         ← pointer to agent.md
    └── last-report.md         ← latest findings (overwritten each run)
```

## Data flow

```
git diff since last run ────────┐
                                 ▼
                          run-agent.sh ────► agents/<name>/last-report.md
                                 │             │
                                 │             ▼
                                 │      technical-pmp dedupes
                                 │             │
                                 │             ▼
                                 │      create-issues-from-findings.sh
                                 │             │
                                 │             ▼
                                 │      GitHub issues (labeled by severity + agent)
                                 │
                                 ▼
                       agents/state/findings-dedup.json
                                 │
                                 ▼
                       program-director reads all reports
                                 │
                                 ▼
                       agents/state/deploy-approvals.json
                                 │
                                 ▼
                       safe-deploy-digitalocean.sh (gates)
                                 │
                                 ▼
                       git push → DO auto-deploy → smoke → ROLLBACK if fail
```

## Safety gates (sequential, fail-fast)

### Pre-merge (`safe-merge.sh`)
1. Clean working tree
2. `npm test` passes (or new failures match the tolerated baseline)
3. `regulatory-regression-test.sh` (golden curves, HAAT, readiness, filing-package, PDF snapshot)
4. `golden-output-compare.sh` (locked snapshots match current engine output)
5. `npm run build` succeeds
6. `npm run lint` succeeds (if defined)
7. No secrets in diff

### Pre-deploy (`safe-deploy-digitalocean.sh`)
1. Production lock unlocked
2. `AGENT_DEPLOY_MODE=safe_prod_write` (else exit 0)
3. All pre-merge gates pass
4. Current UTC hour inside `[WINDOW_START, WINDOW_END]`
5. Daily deploy count below `AGENT_MAX_DEPLOYS_PER_DAY`
6. If RF/regulatory paths touched: three-way agent approval recorded for HEAD sha
7. Current branch is one of the deploy-on-push branches
8. `last_good_sha` recorded for rollback

### Post-deploy (`post-deploy-smoke-test.sh`)
1. `GET /healthz` → 200
2. `GET /readyz` → 200
3. `POST /api/exhibits/readiness` with smoke fixture → 200
4. `POST /api/exhibits/filing-package/summary` → 200
5. p95 latency over 10 `/readyz` probes < 3000 ms
6. No DO components with `replicas_ready < replicas_desired` (crash-loop signal)

Failure of any post-deploy gate triggers `rollback-digitalocean.sh` automatically.

## Token budget enforcement

Each `agent.md` carries a frontmatter-style budget block:

```yaml
MAX_CONTEXT_TOKENS:      150000
MAX_OUTPUT_TOKENS:         8000
MAX_ITERATIONS_PER_RUN:       4
STOP_WHEN_NO_NEW_FINDINGS: true
```

`run-agent.sh` reads the active `AGENT_TOKEN_MODE` from `agents/runtime/budget.json` and the per-agent overrides from `agent.md`. The smaller of the two wins.

`run-agent.sh` also short-circuits when:
- No commits since the agent's last run (`.last-run-sha` matches HEAD)
- Production lock active (downgrades to `report_only` for that invocation)
- Stop conditions in `agent.md` would fire

## Compute scaling

`compute-budget.json` defines four modes. The runner is the boundary:

- `local_only` — single process; `spawn-worker.sh` refuses to spawn additional workers
- `parallel_agents` — up to 4 workers on the same host (default)
- `burst_compute` — up to 8 workers, including short-lived burst workers for batch sweeps
- `heavy_analysis` — up to 16 workers; opt-in via `ENABLE_HEAVY_ANALYSIS=true`

Adaptive triggers in `compute-budget.json.adaptive_triggers`:

- Small diff (< 10 files changed) → downgrade to `local_only`
- Regulatory paths touched → upgrade to `heavy_analysis`
- Production unhealthy → downgrade to `local_only` + lock deploys

## Observability

Every agent run writes:
- `agents/logs/<agent>-context-<ts>.md` — input bundle (diff + agent.md)
- `agents/logs/<agent>-run-<ts>.log` — runner stdout/stderr
- `agents/<agent>/last-report.md` — findings + token usage estimate

Every deploy writes:
- `agents/state/deploy-history.json` — append-only

Every rollback writes:
- `agents/reports/incidents/incident-<ts>.md`
- GitHub issue if `GITHUB_TOKEN` set

## What's NOT in this build (deferred, explicit)

| Deferred | Why | When |
|---|---|---|
| `Dockerfile.agent-worker` | Operational infra needs droplet testing this session can't do | Operator-built per their existing Docker conventions |
| `docker-compose.agents.yml` | Same | Same |
| systemd unit | Host-OS dependent | Operator-built when running outside DO Actions |
| ML-based finding triage | Out of scope | Future |

The GitHub Actions workflow (`agent-safe-prod-write.yml`) IS the long-running runner for the current build — it executes on schedule + manual dispatch and replaces the need for a self-managed daemon. To run on a droplet instead, `agents/scripts/run-loop.sh` is a drop-in entrypoint for `nohup` / `systemd ExecStart`.
