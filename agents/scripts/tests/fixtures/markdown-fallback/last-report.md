# markdown-fallback fixture — last-report.md

This file simulates an agent that did NOT produce `last-findings.json`
but DID embed a single canonical JSON block in its markdown report.
`create-issues-from-findings.sh` should extract the first ```json block
and validate it as the canonical schema.

## Findings (JSON)

```json
{
  "agent": "fixture-markdown-fallback",
  "timestamp_utc": "2026-05-21T18:30:00Z",
  "head_sha": "1111111111111111111111111111111111111111",
  "branch": "test-fixture",
  "summary": "Synthetic fixture: canonical findings embedded in markdown.",
  "deploy_recommendation": "NO_OP",
  "readiness_score": null,
  "findings": [
    {
      "finding_id": "MD-001",
      "title": "Fallback path finding",
      "severity": "INFO",
      "confidence": 0.5,
      "category": "fixture",
      "affected_files": ["genoa/src/bar.js"],
      "regulatory_scope": [],
      "recommended_fix": "Migrate this agent to emit last-findings.json directly.",
      "tests_required": [],
      "deployment_risk": "low",
      "human_review_required": false,
      "reproducibility_notes": "Run create-issues-from-findings.sh --dry-run; agent should resolve via fallback path."
    }
  ]
}
```

A second fenced code block follows but should NOT be parsed (the
extractor stops at the first closing fence):

```text
This block must be ignored.
```
