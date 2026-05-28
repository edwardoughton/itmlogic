# technical-pmp — constraints

Canonical source: `agents/technical-pmp/agent.md` (see "Constraints" section).

Hard constraints (CANNOT violate without human override):
- Honor `agents/state/production-lock.json`
- Honor budget knobs in agent.md (MAX_CONTEXT_TOKENS, MAX_ITERATIONS_PER_RUN, STOP_WHEN_NO_NEW_FINDINGS)
- Stop when stop_conditions in agent.md fire
- Never SSH into production
- Never bypass safety scripts (agents/scripts/safe-*.sh)
