#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const lifecycleStatuses = new Set([
  'draft',
  'approved',
  'executing',
  'implemented',
  'verified',
  'shipped',
  'verification_blocked',
  'externally_deferred',
  'superseded',
  'abandoned',
]);

const preflightStatuses = new Set([
  'pending',
  'ready',
  'known-baseline-red',
  'invalid-environment',
]);

const requiredHeadings = [
  ['execution contract', /^## 0\. Execution contract$/m],
  ['roles', /^### Roles$/m],
  ['model routing', /^### Model routing$/m],
  ['global gate', /^### Global gate$/m],
  ['execution-environment preflight', /^### Execution-environment preflight$/m],
  [
    'expensive or mutating lifecycle gate budget',
    /^### Expensive or mutating lifecycle gate budget$/m,
  ],
  ['goals', /^## 1\. Goals\b.*$/m],
  ['topology', /^## 2\. Topology graph and recommended order$/m],
  ['topology graph', /^### Topology graph$/m],
  ['Graph Findings', /^### Graph Findings$/m],
  ['hard dependencies', /^### Hard dependencies$/m],
  ['soft dependencies', /^### Soft dependencies$/m],
  ['recommended linear order', /^### Recommended linear order$/m],
  ['sections', /^## 3\. Sections$/m],
  ['acceptance protocol', /^## 4\. Main-session acceptance protocol$/m],
  ['progress ledger', /^## 5\. Progress ledger$/m],
  ['completion', /^## Completion$/m],
  ['deferrals', /^## Deferrals$/m],
];

const requiredSectionFields = [
  'GOAL',
  'SOURCES',
  'TARGET',
  'DEPENDS ON',
  'IMPLEMENTER PROFILE',
  'CONTEXT TO AGGREGATE',
  'LIFECYCLE / GATE EFFECTS',
  'IMPLEMENT',
  'CONTRACT DECISION — ESCALATE',
  'VERIFY',
  'REVIEW',
  'ACCEPTANCE',
  'COMMIT',
];

function stripScalar(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("'") && trimmed.endsWith("'")) ||
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('`') && trimmed.endsWith('`'))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(markdown, errors) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) {
    errors.push('missing YAML frontmatter');
    return {};
  }

  const values = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    values[line.slice(0, separator).trim()] = stripScalar(line.slice(separator + 1));
  }
  return values;
}

function extractBetween(markdown, startPattern, endPattern) {
  const startMatch = startPattern.exec(markdown);
  if (!startMatch) return '';
  const start = startMatch.index + startMatch[0].length;
  const remainder = markdown.slice(start);
  const endMatch = endPattern.exec(remainder);
  return endMatch ? remainder.slice(0, endMatch.index) : remainder;
}

function extractField(block, field) {
  const lines = block.split(/\r?\n/);
  const prefix = `${field}:`;
  const start = lines.findIndex((line) => line.trimStart().startsWith(prefix));
  if (start === -1) return '';

  const values = [lines[start].trimStart().slice(prefix.length).trim()];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Z][A-Z0-9 /—-]+:\s*/.test(lines[index])) break;
    values.push(lines[index]);
  }
  return values.join('\n').trim();
}

function extractTopologyGraph(markdown) {
  const topology = extractBetween(
    markdown,
    /^### Topology graph$/m,
    /^### Graph Findings$/m,
  );
  return topology.match(/```mermaid\s*\r?\n([\s\S]*?)\r?\n```/)?.[1] ?? '';
}

function findCycle(sectionIds, dependencies) {
  const visiting = new Set();
  const visited = new Set();

  function visit(id, trail) {
    if (visiting.has(id)) {
      const start = trail.indexOf(id);
      return [...trail.slice(start), id];
    }
    if (visited.has(id)) return undefined;

    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      const cycle = visit(dependency, [...trail, id]);
      if (cycle) return cycle;
    }
    visiting.delete(id);
    visited.add(id);
    return undefined;
  }

  for (const id of sectionIds) {
    const cycle = visit(id, []);
    if (cycle) return cycle;
  }
  return undefined;
}

function validatePlan(markdown) {
  const errors = [];
  const frontmatter = parseFrontmatter(markdown, errors);
  const schema = frontmatter.gdi_schema;
  const status = frontmatter.status;
  const approval = frontmatter.approval;

  if (schema !== '1') errors.push('frontmatter gdi_schema must be 1');
  if (!lifecycleStatuses.has(status)) {
    errors.push(`frontmatter status must be one of: ${[...lifecycleStatuses].join(', ')}`);
  }
  if (!approval) {
    errors.push('frontmatter approval is required');
  } else if (
    status !== 'draft' &&
    !['superseded', 'abandoned'].includes(status) &&
    approval === 'pending'
  ) {
    errors.push(`status ${status} requires non-pending approval evidence`);
  }

  for (const [label, pattern] of requiredHeadings) {
    if (!pattern.test(markdown)) errors.push(`missing required heading: ${label}`);
  }

  const preflight = extractBetween(
    markdown,
    /^### Execution-environment preflight$/m,
    /^### Expensive or mutating lifecycle gate budget$/m,
  );
  const preflightStatus = preflight.match(
    /^Preflight status:\s*`?([a-z-]+)`?\s*$/m,
  )?.[1];
  if (!preflightStatuses.has(preflightStatus)) {
    errors.push(`Preflight status must be one of: ${[...preflightStatuses].join(', ')}`);
  }
  for (const field of ['Checked', 'Baseline SHA', 'Execution realm']) {
    if (!new RegExp(`^${field}:\\s*\\S.+$`, 'm').test(preflight)) {
      errors.push(`execution-environment preflight is missing ${field}`);
    }
  }
  if (!/^\| Capability \| Probe \/ expected condition \| Observed evidence \| Classification \|$/m.test(preflight)) {
    errors.push('execution-environment preflight is missing the capability evidence table');
  }

  const dispatchStatuses = new Set(['executing', 'implemented', 'verified', 'shipped']);
  if (
    status &&
    !['draft', 'superseded', 'abandoned'].includes(status) &&
    preflightStatus === 'pending'
  ) {
    errors.push(`status ${status} requires a completed preflight classification`);
  }
  if (dispatchStatuses.has(status) && !['ready', 'known-baseline-red'].includes(preflightStatus)) {
    errors.push(`status ${status} requires a ready or known-baseline-red preflight`);
  }
  if (status === 'verification_blocked' && preflightStatus !== 'invalid-environment') {
    errors.push('verification_blocked requires an invalid-environment preflight');
  }

  const sectionMatches = [...markdown.matchAll(/^## ([A-Z][0-9]+) — (.+)$/gm)];
  if (sectionMatches.length === 0) errors.push('no implementation sections found');

  const sectionIds = sectionMatches.map((match) => match[1]);
  const duplicates = sectionIds.filter((id, index) => sectionIds.indexOf(id) !== index);
  for (const id of new Set(duplicates)) errors.push(`duplicate section ID: ${id}`);

  const sectionIdSet = new Set(sectionIds);
  const dependencies = new Map();
  for (const match of sectionMatches) {
    const id = match[1];
    const blockStart = match.index + match[0].length;
    const remainder = markdown.slice(blockStart);
    const nextHeading = remainder.search(/^## /m);
    const block = nextHeading === -1 ? remainder : remainder.slice(0, nextHeading);

    for (const field of requiredSectionFields) {
      if (!new RegExp(`^${field.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}:`, 'm').test(block)) {
        errors.push(`${id} is missing field: ${field}`);
      }
    }

    const dependencyText = extractField(block, 'DEPENDS ON');
    const ids = [...new Set(dependencyText.match(/\b[A-Z][0-9]+\b/g) ?? [])];
    dependencies.set(id, ids);
    for (const dependency of ids) {
      if (!sectionIdSet.has(dependency)) {
        errors.push(`${id} depends on unknown section ${dependency}`);
      } else if (dependency === id) {
        errors.push(`${id} depends on itself`);
      }
    }
  }

  const cycle = findCycle(sectionIds, dependencies);
  if (cycle) errors.push(`section dependency cycle: ${cycle.join(' -> ')}`);

  const topologyGraph = extractTopologyGraph(markdown);
  if (!topologyGraph) {
    errors.push('Topology graph section has no Mermaid block');
  } else {
    for (const id of sectionIds) {
      if (!new RegExp(`\\b${id}\\b`).test(topologyGraph)) {
        errors.push(`topology graph does not contain section ${id}`);
      }
    }
  }

  const goals = [...markdown.matchAll(/^### Goal ([0-9]+)\b/gm)].map((match) => match[1]);
  if (goals.length === 0) errors.push('no numbered Goal headings found');
  for (const goal of goals) {
    if (topologyGraph && !new RegExp(`Goal\\s+${goal}\\b`).test(topologyGraph)) {
      errors.push(`topology graph does not label Goal ${goal}`);
    }
  }

  const ledger = extractBetween(markdown, /^## 5\. Progress ledger$/m, /^## Completion$/m);
  const ledgerRows = [...ledger.matchAll(/^- \[([ xX])\]\s+([A-Z][0-9]+)\b/gm)];
  const ledgerIds = ledgerRows.map((match) => match[2]);
  for (const id of sectionIds) {
    const count = ledgerIds.filter((ledgerId) => ledgerId === id).length;
    if (count !== 1) errors.push(`ledger must contain section ${id} exactly once; found ${count}`);
  }
  for (const id of new Set(ledgerIds)) {
    if (!sectionIdSet.has(id)) errors.push(`ledger contains unknown section ${id}`);
  }

  const allSectionsAccepted = ledgerRows.length > 0 && ledgerRows.every((row) => row[1] !== ' ');
  const acceptedSectionStatuses = new Set([
    'implemented',
    'verified',
    'shipped',
    'verification_blocked',
    'externally_deferred',
  ]);
  if (acceptedSectionStatuses.has(status) && !allSectionsAccepted) {
    errors.push(`status ${status} requires every implementation ledger row to be checked`);
  }

  const goalsBody = extractBetween(markdown, /^## 1\. Goals\b.*$/m, /^## 2\./m);
  const completionBody = extractBetween(markdown, /^## Completion$/m, /^## Deferrals$/m);
  if (['verified', 'shipped'].includes(status)) {
    if (/^- \[ \]/m.test(goalsBody)) errors.push(`status ${status} has unchecked goal exits`);
    if (/^- \[ \]/m.test(completionBody)) {
      errors.push(`status ${status} has unchecked completion items`);
    }
  }

  const deferrals = extractBetween(markdown, /^## Deferrals$/m, /(?![\s\S])/);
  if (['verification_blocked', 'externally_deferred', 'superseded', 'abandoned'].includes(status)) {
    if (/^\s*None\.\s*$/m.test(deferrals) || !deferrals.trim()) {
      errors.push(`status ${status} requires a recorded deferral or disposition`);
    }
  }

  return {
    errors,
    summary: {
      approval,
      preflightStatus,
      schema,
      sections: sectionIds.length,
      status,
    },
  };
}

function selfTest() {
  const valid = `---
gdi_schema: 1
status: approved
approval: 2026-08-29
---

# Example — Goal-Driven Implementation Plan

## 0. Execution contract
### Roles
### Model routing
### Global gate
### Execution-environment preflight
Preflight status: ready
Checked: 2026-08-29
Baseline SHA: abc1234
Execution realm: local
| Capability | Probe / expected condition | Observed evidence | Classification |
|---|---|---|---|
| Toolchain | available | observed | ready |
### Expensive or mutating lifecycle gate budget
| Gate | Consumes / invalidated by | Planned runs | Why this count is safe |
|---|---|---:|---|
| Build | source | 1 | after review |
## 1. Goals — observable definition of done
### Goal 1 — example
- [ ] outcome
## 2. Topology graph and recommended order
### Topology graph
\`\`\`mermaid
flowchart LR
  IN1(["request"]) --> A1["A1 — slice"] --> G1{"Goal 1"}
\`\`\`
### Graph Findings
- None.
### Hard dependencies
- None.
### Soft dependencies
- None.
### Recommended linear order
A1 -> Goal 1
## 3. Sections
## A1 — slice
GOAL:
Outcome.
SOURCES:
Request.
TARGET:
Package.
DEPENDS ON:
none.
IMPLEMENTER PROFILE:
goal-implementer-terra.
CONTEXT TO AGGREGATE:
1. Existing code.
LIFECYCLE / GATE EFFECTS:
- Produces: source.
IMPLEMENT:
- Change behavior.
CONTRACT DECISION — ESCALATE:
Stop on contract drift.
VERIFY:
- Run tests.
REVIEW:
Contract and scope.
ACCEPTANCE:
Goal 1 outcome.
COMMIT:
feat(example): add slice
## 4. Main-session acceptance protocol
Apply the acceptance checks.
## 5. Progress ledger
- [ ] A1 slice
## Completion
- [ ] Every section is committed.
- [ ] Goal 1 exit tests pass with evidence.
## Deferrals
None.
`;

  const validResult = validatePlan(valid);
  if (validResult.errors.length > 0) {
    throw new Error(`valid fixture failed:\n${validResult.errors.join('\n')}`);
  }

  const invalidLedger = validatePlan(valid.replace('- [ ] A1 slice', '- [ ] B1 slice'));
  if (!invalidLedger.errors.some((error) => error.includes('ledger must contain section A1'))) {
    throw new Error('ledger mismatch fixture did not fail as expected');
  }

  const invalidPreflight = validatePlan(
    valid.replace('status: approved', 'status: executing').replace('Preflight status: ready', 'Preflight status: pending'),
  );
  if (!invalidPreflight.errors.some((error) => error.includes('requires a ready'))) {
    throw new Error('dispatch preflight fixture did not fail as expected');
  }

  const invalidDependency = validatePlan(valid.replace('DEPENDS ON:\nnone.', 'DEPENDS ON:\nA1.'));
  if (!invalidDependency.errors.some((error) => error.includes('depends on itself'))) {
    throw new Error('dependency fixture did not fail as expected');
  }

  const invalidVerified = validatePlan(
    valid.replace('status: approved', 'status: verified').replace('- [ ] A1 slice', '- [x] A1 slice'),
  );
  if (!invalidVerified.errors.some((error) => error.includes('unchecked goal exits'))) {
    throw new Error('verified lifecycle fixture did not fail as expected');
  }

  const invalidDeferral = validatePlan(
    valid
      .replace('status: approved', 'status: externally_deferred')
      .replace('- [ ] A1 slice', '- [x] A1 slice'),
  );
  if (!invalidDeferral.errors.some((error) => error.includes('requires a recorded deferral'))) {
    throw new Error('typed deferral fixture did not fail as expected');
  }

  console.log('validate-plan self-test passed');
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--self-test') {
  selfTest();
  process.exit(0);
}

if (args.length !== 1 || args[0].startsWith('--')) {
  console.error('Usage: node validate-plan.mjs <plan.md> | --self-test');
  process.exit(2);
}

const planPath = resolve(args[0]);
let markdown;
try {
  markdown = readFileSync(planPath, 'utf8');
} catch (error) {
  console.error(`Could not read ${planPath}: ${error.message}`);
  process.exit(2);
}

const result = validatePlan(markdown);
if (result.errors.length > 0) {
  console.error(`Plan validation failed: ${basename(planPath)}`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Plan validation passed: ${basename(planPath)} ` +
    `(schema=${result.summary.schema}, status=${result.summary.status}, ` +
    `preflight=${result.summary.preflightStatus}, sections=${result.summary.sections})`,
);
