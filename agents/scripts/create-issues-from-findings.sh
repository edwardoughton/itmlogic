#!/usr/bin/env bash
# create-issues-from-findings.sh — read each agent's canonical findings,
# dedupe against agents/state/findings-dedup.json, and file GitHub issues
# for genuinely-new findings.
#
# Source-of-truth lookup order, per agent:
#   1. agents/<agent>/last-findings.json   (canonical, preferred)
#   2. agents/<agent>/last-report.md       (first ```json fenced block, fallback only)
#
# JSON is validated by agents/scripts/validate-findings-json.js before
# anything is parsed. A malformed input for a single agent is logged
# and skipped — it never crashes the run.
#
# Flags:
#   --dry-run   do not POST to GitHub, do not mutate findings-dedup.json
#               (still validates every input and prints what WOULD happen)
#
# Skips network writes silently when GITHUB_TOKEN is unset. Dedup state
# is still updated unless --dry-run is set.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPTS_DIR="${REPO_ROOT}/agents/scripts"
VALIDATOR="${SCRIPTS_DIR}/validate-findings-json.js"
DEDUP="${REPO_ROOT}/agents/state/findings-dedup.json"
NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

DRY_RUN=0
for arg in "$@"; do
  case "${arg}" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help)
      sed -n '2,20p' "$0"
      exit 0
      ;;
    *)
      echo "[create-issues] unknown flag: ${arg}" >&2
      exit 2
      ;;
  esac
done

if [[ ${DRY_RUN} -eq 1 ]]; then
  echo "[create-issues] DRY RUN — no GitHub writes, no findings-dedup.json mutation"
fi

if [[ -z "${GITHUB_TOKEN:-}" && ${DRY_RUN} -eq 0 ]]; then
  echo "[create-issues] GITHUB_TOKEN unset — skipping issue creation, dedup tracking still updated"
fi

if [[ ! -f "${DEDUP}" ]]; then
  mkdir -p "$(dirname "${DEDUP}")"
  printf '{"_comment":"Dedup hash store for agent findings.","findings":{}}\n' > "${DEDUP}"
fi

# Pick a sha256 implementation that exists on this host.
sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum | awk '{print $1}'
  else
    shasum -a 256 | awk '{print $1}'
  fi
}

# Extract the FIRST fenced ```json block from a markdown file. Stops at
# the first closing ``` so a file with multiple blocks does not get
# concatenated (which was the historic META-001 bug).
extract_first_json_block() {
  local md="$1"
  awk '
    BEGIN { in_block = 0 }
    /^```json[[:space:]]*$/ {
      if (!seen) { in_block = 1; seen = 1; next }
    }
    /^```[[:space:]]*$/ {
      if (in_block) { in_block = 0; exit }
    }
    { if (in_block) print }
  ' "${md}"
}

# Resolve canonical JSON for one agent. Writes the JSON document to
# stdout. Returns nonzero (and prints a [create-issues] warning to
# stderr) if neither path produced a valid document.
resolve_agent_json() {
  local agent_dir="$1"
  local agent="$2"
  local canonical="${agent_dir}last-findings.json"
  local report="${agent_dir}last-report.md"

  if [[ -f "${canonical}" ]]; then
    if node "${VALIDATOR}" "${canonical}" >/dev/null 2>&1; then
      cat "${canonical}"
      return 0
    fi
    echo "[create-issues] ${agent}: last-findings.json failed validation; trying markdown fallback" >&2
    node "${VALIDATOR}" "${canonical}" >&2 || true
  fi

  if [[ -f "${report}" ]]; then
    local block
    block=$(extract_first_json_block "${report}")
    if [[ -z "${block}" ]]; then
      echo "[create-issues] ${agent}: no last-findings.json, and no \`\`\`json block in last-report.md — skipping" >&2
      return 1
    fi
    local tmp
    tmp=$(mktemp)
    printf '%s' "${block}" > "${tmp}"
    if node "${VALIDATOR}" "${tmp}" >/dev/null 2>&1; then
      cat "${tmp}"
      rm -f "${tmp}"
      return 0
    fi
    # Legacy schema: a bare array of findings. Wrap into a minimal
    # canonical doc so we can still surface findings without crashing.
    if jq -e 'type == "array"' "${tmp}" >/dev/null 2>&1; then
      local wrapped
      wrapped=$(jq --arg a "${agent}" --arg t "${NOW}" \
        '{agent:$a, timestamp_utc:$t, head_sha:"", branch:"", summary:"legacy bare-array findings",
          deploy_recommendation:"NO_OP", readiness_score:null,
          findings: map({
            finding_id:    (.finding_id // ("LEGACY-" + (.title // "untitled" | tostring))),
            title:         (.title // "untitled"),
            severity:      (.severity // "INFO"),
            confidence:    (.confidence // 0),
            category:      (.category // "legacy"),
            affected_files: (.affected_files // []),
            regulatory_scope: (.regulatory_scope // []),
            recommended_fix:  (.recommended_fix // ""),
            tests_required:   (.tests_required // []),
            deployment_risk:  (.deployment_risk // "low"),
            human_review_required: (.human_review_required // false),
            reproducibility_notes: (.reproducibility_notes // "")
          })}' "${tmp}")
      echo "[create-issues] ${agent}: legacy bare-array findings detected — wrapping (please migrate to canonical schema)" >&2
      rm -f "${tmp}"
      printf '%s' "${wrapped}"
      return 0
    fi
    echo "[create-issues] ${agent}: markdown JSON block failed validation — skipping" >&2
    node "${VALIDATOR}" "${tmp}" >&2 || true
    rm -f "${tmp}"
    return 1
  fi

  echo "[create-issues] ${agent}: no last-findings.json and no last-report.md — skipping" >&2
  return 1
}

dedup_key() {
  # agent | finding_id | title | sha256(sorted affected_files)
  local agent="$1" fid="$2" title="$3" files_csv="$4"
  local files_hash
  files_hash=$(printf '%s' "${files_csv}" | sha256)
  printf '%s|%s|%s|%s' "${agent}" "${fid}" "${title}" "${files_hash}" | sha256
}

TOTAL_AGENTS=0
TOTAL_FINDINGS=0
TOTAL_NEW=0
TOTAL_SKIPPED=0

for AGENT_DIR in "${REPO_ROOT}/agents/"*/; do
  [[ -d "${AGENT_DIR}" ]] || continue
  AGENT=$(basename "${AGENT_DIR}")
  case "${AGENT}" in
    logs|reports|runtime|scripts|state) continue ;;
  esac

  JSON_DOC=$(resolve_agent_json "${AGENT_DIR}" "${AGENT}" || true)
  if [[ -z "${JSON_DOC}" ]]; then
    TOTAL_SKIPPED=$((TOTAL_SKIPPED + 1))
    continue
  fi
  TOTAL_AGENTS=$((TOTAL_AGENTS + 1))

  COUNT=$(printf '%s' "${JSON_DOC}" | jq '.findings | length')
  echo "[create-issues] ${AGENT}: ${COUNT} finding(s)"
  TOTAL_FINDINGS=$((TOTAL_FINDINGS + COUNT))

  # iterate without a subshell so counters survive
  while IFS= read -r FINDING; do
    [[ -n "${FINDING}" ]] || continue
    TITLE=$(jq -r '.title' <<<"${FINDING}")
    SEV=$(jq -r '.severity' <<<"${FINDING}")
    FID=$(jq -r '.finding_id' <<<"${FINDING}")
    FILES_CSV=$(jq -r '.affected_files | sort | join(",")' <<<"${FINDING}")
    KEY=$(dedup_key "${AGENT}" "${FID}" "${TITLE}" "${FILES_CSV}")

    ALREADY=$(jq --arg k "${KEY}" '.findings[$k] // null' "${DEDUP}")
    if [[ "${ALREADY}" != "null" ]]; then
      echo "  - dup  ${FID}  ${TITLE}"
      if [[ ${DRY_RUN} -eq 0 ]]; then
        TMP=$(mktemp)
        jq --arg k "${KEY}" --arg t "${NOW}" \
           '.findings[$k].seen_count += 1 | .findings[$k].last_seen = $t' \
           "${DEDUP}" > "${TMP}"
        mv "${TMP}" "${DEDUP}"
      fi
      continue
    fi

    TOTAL_NEW=$((TOTAL_NEW + 1))
    echo "  + NEW  ${FID}  [${SEV}]  ${TITLE}"

    if [[ ${DRY_RUN} -eq 1 ]]; then
      continue
    fi

    TMP=$(mktemp)
    jq --arg k "${KEY}" --arg t "${NOW}" --arg a "${AGENT}" --arg ti "${TITLE}" --arg fid "${FID}" --arg sev "${SEV}" \
       '.findings[$k] = {agent:$a, finding_id:$fid, title:$ti, severity:$sev, first_seen:$t, last_seen:$t, seen_count:1}' \
       "${DEDUP}" > "${TMP}"
    mv "${TMP}" "${DEDUP}"

    if [[ -n "${GITHUB_TOKEN:-}" ]]; then
      LABEL=$(echo "${SEV}" | tr '[:upper:]' '[:lower:]')
      BODY=$(jq -r '
        "**Severity:** \(.severity)\n" +
        "**Confidence:** \(.confidence)\n" +
        "**Finding ID:** \(.finding_id)\n" +
        "**Category:** \(.category)\n" +
        "**Reported by:** '"${AGENT}"'\n\n" +
        "## Affected files\n" + (.affected_files | map("- `\(.)`") | join("\n")) + "\n\n" +
        "## Regulatory scope\n" + ((.regulatory_scope // []) | map("- \(.)") | join("\n")) + "\n\n" +
        "## Recommended fix\n\(.recommended_fix)\n\n" +
        "## Tests required\n" + (.tests_required | map("- \(.)") | join("\n")) + "\n\n" +
        "**Deployment risk:** \(.deployment_risk)\n" +
        "**Human review required:** \(.human_review_required)\n\n" +
        "## Reproducibility\n\(.reproducibility_notes)\n"
      ' <<<"${FINDING}")
      curl -fsS \
        -X POST \
        -H "Authorization: token ${GITHUB_TOKEN}" \
        -H "Accept: application/vnd.github.v3+json" \
        -d "$(jq -n --arg t "${TITLE}" --arg b "${BODY}" --arg l "${LABEL}" --arg a "${AGENT}" \
            '{title:$t, body:$b, labels:["agent-finding", $l, ("agent/" + $a)]}')" \
        "https://api.github.com/repos/chelstein/itmlogic/issues" \
        > /tmp/issue-resp.json
      ISSUE_NUMBER=$(jq -r '.number' /tmp/issue-resp.json)
      echo "    filed #${ISSUE_NUMBER}"
    fi
  done < <(printf '%s' "${JSON_DOC}" | jq -c '.findings[]')

done

echo "[create-issues] done — agents=${TOTAL_AGENTS} skipped=${TOTAL_SKIPPED} findings=${TOTAL_FINDINGS} new=${TOTAL_NEW}"
