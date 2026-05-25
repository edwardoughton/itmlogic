# malformed fixture — last-report.md

This file simulates an agent that produced narrative markdown only with
no usable JSON. It exists to prove `create-issues-from-findings.sh`
warns and skips the agent without crashing the whole run.

## Findings (prose only, no JSON block)

- Something is wrong somewhere in `genoa/src/foo.js`. Nobody knows what.
- The auditor handed back a CSV by mistake.

No machine-readable findings here.
