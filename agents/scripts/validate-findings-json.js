#!/usr/bin/env node
// validate-findings-json.js — strict validator for agents/<agent>/last-findings.json
//
// Usage:
//   node agents/scripts/validate-findings-json.js <path-to-json>...
//
// Exit codes:
//   0 — every file valid
//   1 — at least one file failed validation
//   2 — bad invocation (no args / file not readable)
//
// On failure, prints `<file>: <error>` to stderr. Treat this as the
// authoritative gate; create-issues-from-findings.sh calls into it.

import { readFileSync, existsSync } from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';

const SEVERITY = new Set([
  'BLOCKER', 'HIGH', 'MEDIUM', 'LOW', 'WARNING', 'INFO', 'SOFT',
]);
const DEPLOY_RECOMMENDATION = new Set(['APPROVE', 'BLOCK', 'WARN', 'NO_OP']);
const DEPLOYMENT_RISK = new Set(['low', 'medium', 'high']);

const TOP_REQUIRED = [
  'agent',
  'timestamp_utc',
  'head_sha',
  'branch',
  'summary',
  'deploy_recommendation',
  'findings',
];

const FINDING_REQUIRED = [
  'finding_id',
  'title',
  'severity',
  'confidence',
  'category',
  'affected_files',
  'regulatory_scope',
  'recommended_fix',
  'tests_required',
  'deployment_risk',
  'human_review_required',
  'reproducibility_notes',
];

function isStringArray(v) {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function validateFinding(f, idx) {
  const errors = [];
  if (f === null || typeof f !== 'object' || Array.isArray(f)) {
    return [`findings[${idx}]: must be an object`];
  }
  for (const key of FINDING_REQUIRED) {
    if (!(key in f)) errors.push(`findings[${idx}]: missing required key "${key}"`);
  }
  if ('severity' in f && !SEVERITY.has(f.severity)) {
    errors.push(
      `findings[${idx}].severity: "${f.severity}" not in {${[...SEVERITY].join(',')}}`,
    );
  }
  if ('confidence' in f) {
    if (typeof f.confidence !== 'number' || f.confidence < 0 || f.confidence > 1) {
      errors.push(`findings[${idx}].confidence: must be a number in [0, 1]`);
    }
  }
  if ('affected_files' in f && !isStringArray(f.affected_files)) {
    errors.push(`findings[${idx}].affected_files: must be string[]`);
  }
  if ('regulatory_scope' in f && !isStringArray(f.regulatory_scope)) {
    errors.push(`findings[${idx}].regulatory_scope: must be string[]`);
  }
  if ('tests_required' in f && !isStringArray(f.tests_required)) {
    errors.push(`findings[${idx}].tests_required: must be string[]`);
  }
  if ('deployment_risk' in f && !DEPLOYMENT_RISK.has(f.deployment_risk)) {
    errors.push(
      `findings[${idx}].deployment_risk: "${f.deployment_risk}" not in {low,medium,high}`,
    );
  }
  if ('human_review_required' in f && typeof f.human_review_required !== 'boolean') {
    errors.push(`findings[${idx}].human_review_required: must be boolean`);
  }
  for (const stringKey of [
    'finding_id', 'title', 'category', 'recommended_fix', 'reproducibility_notes',
  ]) {
    if (stringKey in f && typeof f[stringKey] !== 'string') {
      errors.push(`findings[${idx}].${stringKey}: must be string`);
    }
  }
  return errors;
}

function validateDoc(doc) {
  const errors = [];
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    return ['root: must be an object matching the canonical schema'];
  }
  for (const key of TOP_REQUIRED) {
    if (!(key in doc)) errors.push(`root: missing required key "${key}"`);
  }
  for (const stringKey of [
    'agent', 'timestamp_utc', 'head_sha', 'branch', 'summary',
  ]) {
    if (stringKey in doc && typeof doc[stringKey] !== 'string') {
      errors.push(`root.${stringKey}: must be string`);
    }
  }
  if ('deploy_recommendation' in doc && !DEPLOY_RECOMMENDATION.has(doc.deploy_recommendation)) {
    errors.push(
      `root.deploy_recommendation: "${doc.deploy_recommendation}" not in {${[...DEPLOY_RECOMMENDATION].join(',')}}`,
    );
  }
  if ('readiness_score' in doc && doc.readiness_score !== null) {
    if (typeof doc.readiness_score !== 'number' || doc.readiness_score < 0 || doc.readiness_score > 100) {
      errors.push('root.readiness_score: must be number in [0, 100] or null');
    }
  }
  if ('findings' in doc) {
    if (!Array.isArray(doc.findings)) {
      errors.push('root.findings: must be an array (use [] for a clean run)');
    } else {
      doc.findings.forEach((f, i) => errors.push(...validateFinding(f, i)));
    }
  }
  return errors;
}

function validateFile(path) {
  if (!existsSync(path)) {
    return [`${path}: file does not exist`];
  }
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    return [`${path}: cannot read file: ${e.message}`];
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    return [`${path}: invalid JSON: ${e.message}`];
  }
  return validateDoc(doc).map((msg) => `${path}: ${msg}`);
}

function main() {
  const files = argv.slice(2);
  if (files.length === 0) {
    stderr.write('usage: validate-findings-json.js <file>...\n');
    exit(2);
  }
  let anyFailed = false;
  for (const f of files) {
    const errors = validateFile(f);
    if (errors.length === 0) {
      stdout.write(`OK ${f}\n`);
    } else {
      anyFailed = true;
      for (const e of errors) stderr.write(`FAIL ${e}\n`);
    }
  }
  exit(anyFailed ? 1 : 0);
}

main();
