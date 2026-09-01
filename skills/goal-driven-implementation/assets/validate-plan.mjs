#!/usr/bin/env node
// Validates a goal-driven implementation plan file.
//   node validate-plan.mjs <plan.md>      validate one plan
//   node validate-plan.mjs --self-test    run the built-in fixtures
// gdi_schema 2 is the current contract; gdi_schema 1 plans are validated with the legacy rules.

import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const LIFECYCLE = new Set([
  "draft",
  "approved",
  "executing",
  "implemented",
  "verified",
  "shipped",
  "verification_blocked",
  "externally_deferred",
  "superseded",
  "abandoned",
]);
const PREFLIGHT = new Set([
  "pending",
  "ready",
  "known-baseline-red",
  "invalid-environment",
]);
const COMPLETION_STATUSES = new Set([
  "implemented",
  "verified",
  "shipped",
  "verification_blocked",
  "externally_deferred",
]);

// ---------- shared helpers ----------

function stripScalar(value) {
  const t = value.trim();
  if (
    (t.startsWith("'") && t.endsWith("'")) ||
    (t.startsWith('"') && t.endsWith('"')) ||
    (t.startsWith("`") && t.endsWith("`"))
  ) {
    return t.slice(1, -1);
  }
  return t;
}

function parseFrontmatter(md, errors) {
  const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!m) {
    errors.push("missing YAML frontmatter");
    return {};
  }
  const out = {};
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf(":");
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = stripScalar(line.slice(i + 1));
  }
  return out;
}

function between(md, startRe, endRe) {
  const s = startRe.exec(md);
  if (!s) return "";
  const rest = md.slice(s.index + s[0].length);
  const e = endRe.exec(rest);
  return e ? rest.slice(0, e.index) : rest;
}

function field(block, name) {
  const lines = block.split(/\r?\n/);
  const prefix = `${name}:`;
  const start = lines.findIndex((l) => l.trimStart().startsWith(prefix));
  if (start === -1) return "";
  const vals = [lines[start].trimStart().slice(prefix.length).trim()];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^[A-Z][A-Z0-9 /—-]+:\s*/.test(lines[i])) break;
    vals.push(lines[i]);
  }
  return vals.join("\n").trim();
}

function topologyGraph(md) {
  const t = between(md, /^### Topology graph$/m, /^### Graph Findings$/m);
  return t.match(/```mermaid\s*\r?\n([\s\S]*?)\r?\n```/)?.[1] ?? "";
}

function findCycle(ids, deps) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id, trail) {
    if (visiting.has(id)) return [...trail.slice(trail.indexOf(id)), id];
    if (visited.has(id)) return undefined;
    visiting.add(id);
    for (const d of deps.get(id) ?? []) {
      const c = visit(d, [...trail, id]);
      if (c) return c;
    }
    visiting.delete(id);
    visited.add(id);
    return undefined;
  }
  for (const id of ids) {
    const c = visit(id, []);
    if (c) return c;
  }
  return undefined;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseTable(body) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return { header: [], rows: [] };
  const cells = (l) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const header = cells(lines[0]);
  const rows = lines.slice(2).map(cells);
  return { header, rows };
}

const isPlaceholder = (cell) =>
  !cell || /^<.*>$/.test(cell) || /^`<.*>`$/.test(cell);

// ---------- section / ledger / graph checks shared by both schemas ----------

function checkSections(md, errors, requiredFields) {
  const matches = [...md.matchAll(/^## ([A-Z][0-9]+) — (.+)$/gm)];
  if (matches.length === 0) errors.push("no implementation sections found");
  const ids = matches.map((m) => m[1]);
  for (const id of new Set(ids.filter((id, i) => ids.indexOf(id) !== i))) {
    errors.push(`duplicate section ID: ${id}`);
  }
  const idSet = new Set(ids);
  const deps = new Map();
  for (const m of matches) {
    const id = m[1];
    const rest = md.slice(m.index + m[0].length);
    const next = rest.search(/^## /m);
    const block = next === -1 ? rest : rest.slice(0, next);
    for (const f of requiredFields) {
      if (!new RegExp(`^${escapeRe(f)}:`, "m").test(block))
        errors.push(`${id} is missing field: ${f}`);
    }
    const depIds = [
      ...new Set(field(block, "DEPENDS ON").match(/\b[A-Z][0-9]+\b/g) ?? []),
    ];
    deps.set(id, depIds);
    for (const d of depIds) {
      if (!idSet.has(d)) errors.push(`${id} depends on unknown section ${d}`);
      else if (d === id) errors.push(`${id} depends on itself`);
    }
  }
  const cycle = findCycle(ids, deps);
  if (cycle) errors.push(`section dependency cycle: ${cycle.join(" -> ")}`);
  return { ids, idSet };
}

function checkGraphMembership(md, ids, errors) {
  const graph = topologyGraph(md);
  if (!graph) {
    errors.push("Topology graph section has no Mermaid block");
    return graph;
  }
  for (const id of ids) {
    if (!new RegExp(`\\b${id}\\b`).test(graph))
      errors.push(`topology graph does not contain section ${id}`);
  }
  const goals = [...md.matchAll(/^### Goal ([0-9]+)\b/gm)].map((m) => m[1]);
  if (goals.length === 0) errors.push("no numbered Goal headings found");
  for (const g of goals) {
    if (!new RegExp(`Goal\\s+${g}\\b`).test(graph))
      errors.push(`topology graph does not label Goal ${g}`);
  }
  return graph;
}

function ledgerRows(md) {
  const ledger = between(md, /^## 5\. Progress ledger$/m, /^## Completion$/m);
  const lines = ledger.split(/\r?\n/);
  const rows = [];
  for (let i = 0; i < lines.length; i += 1) {
    const m = lines[i].match(/^- \[([ xX])\]\s+([A-Z][0-9]+)\b(.*)$/);
    if (!m) continue;
    const sub = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const s = lines[j].match(/^\s{2,}- (R\d+)\s+([a-z][a-z-]*):/);
      if (!s) break;
      sub.push(s[2]);
    }
    rows.push({ done: m[1] !== " ", id: m[2], text: m[3], rounds: sub });
  }
  return rows;
}

function checkLedgerMembership(rows, ids, idSet, errors) {
  const ledgerIds = rows.map((r) => r.id);
  for (const id of ids) {
    const n = ledgerIds.filter((x) => x === id).length;
    if (n !== 1)
      errors.push(`ledger must contain section ${id} exactly once; found ${n}`);
  }
  for (const id of new Set(ledgerIds)) {
    if (!idSet.has(id)) errors.push(`ledger contains unknown section ${id}`);
  }
}

function checkPreflight(md, status, errors) {
  const pre = between(
    md,
    /^### Execution-environment preflight$/m,
    /^### Expensive or mutating lifecycle gate budget$/m,
  );
  const pstatus = pre.match(/^Preflight status:\s*`?([a-z-]+)`?\s*$/m)?.[1];
  if (!PREFLIGHT.has(pstatus))
    errors.push(
      `Preflight status must be one of: ${[...PREFLIGHT].join(", ")}`,
    );
  for (const f of ["Checked", "Baseline SHA", "Execution realm"]) {
    if (!new RegExp(`^${f}:\\s*\\S.+$`, "m").test(pre))
      errors.push(`execution-environment preflight is missing ${f}`);
  }
  if (
    !/^\| Capability \| Probe \/ expected condition \| Observed evidence \| Classification \|$/m.test(
      pre,
    )
  ) {
    errors.push(
      "execution-environment preflight is missing the capability evidence table",
    );
  }
  const dispatch = new Set(["executing", "implemented", "verified", "shipped"]);
  if (
    status &&
    !["draft", "superseded", "abandoned"].includes(status) &&
    pstatus === "pending"
  ) {
    errors.push(
      `status ${status} requires a completed preflight classification`,
    );
  }
  if (
    dispatch.has(status) &&
    !["ready", "known-baseline-red"].includes(pstatus)
  ) {
    errors.push(
      `status ${status} requires a ready or known-baseline-red preflight`,
    );
  }
  if (status === "verification_blocked" && pstatus !== "invalid-environment") {
    errors.push(
      "verification_blocked requires an invalid-environment preflight",
    );
  }
  return { pre, pstatus };
}

function checkCompletion(md, status, rows, errors) {
  const accepted = rows.length > 0 && rows.every((r) => r.done);
  if (COMPLETION_STATUSES.has(status) && !accepted) {
    errors.push(
      `status ${status} requires every implementation ledger row to be checked`,
    );
  }
  const goals = between(md, /^## 1\. Goals\b.*$/m, /^## 2\./m);
  const completion = between(md, /^## Completion$/m, /^## Deferrals$/m);
  if (["verified", "shipped"].includes(status)) {
    if (/^- \[ \]/m.test(goals))
      errors.push(`status ${status} has unchecked goal exits`);
    if (/^- \[ \]/m.test(completion))
      errors.push(`status ${status} has unchecked completion items`);
  }
  const deferrals = between(md, /^## Deferrals$/m, /(?![\s\S])/);
  if (
    [
      "verification_blocked",
      "externally_deferred",
      "superseded",
      "abandoned",
    ].includes(status)
  ) {
    if (/^\s*None\.\s*$/m.test(deferrals) || !deferrals.trim()) {
      errors.push(
        `status ${status} requires a recorded deferral or disposition`,
      );
    }
  }
  return deferrals;
}

// ---------- schema 1 (legacy) ----------

const S1_HEADINGS = [
  ["execution contract", /^## 0\. Execution contract$/m],
  ["roles", /^### Roles$/m],
  ["model routing", /^### Model routing$/m],
  ["global gate", /^### Global gate$/m],
  ["execution-environment preflight", /^### Execution-environment preflight$/m],
  [
    "lifecycle gate budget",
    /^### Expensive or mutating lifecycle gate budget$/m,
  ],
  ["goals", /^## 1\. Goals\b.*$/m],
  ["topology", /^## 2\. Topology graph and recommended order$/m],
  ["topology graph", /^### Topology graph$/m],
  ["Graph Findings", /^### Graph Findings$/m],
  ["hard dependencies", /^### Hard dependencies$/m],
  ["soft dependencies", /^### Soft dependencies$/m],
  ["recommended linear order", /^### Recommended linear order$/m],
  ["sections", /^## 3\. Sections$/m],
  ["acceptance protocol", /^## 4\. Main-session acceptance protocol$/m],
  ["progress ledger", /^## 5\. Progress ledger$/m],
  ["completion", /^## Completion$/m],
  ["deferrals", /^## Deferrals$/m],
];
const S1_FIELDS = [
  "GOAL",
  "SOURCES",
  "TARGET",
  "DEPENDS ON",
  "IMPLEMENTER PROFILE",
  "CONTEXT TO AGGREGATE",
  "LIFECYCLE / GATE EFFECTS",
  "IMPLEMENT",
  "CONTRACT DECISION — ESCALATE",
  "VERIFY",
  "REVIEW",
  "ACCEPTANCE",
  "COMMIT",
];

function validateSchema1(md, fm, errors) {
  const status = fm.status;
  for (const [label, re] of S1_HEADINGS)
    if (!re.test(md)) errors.push(`missing required heading: ${label}`);
  const { pstatus } = checkPreflight(md, status, errors);
  const { ids, idSet } = checkSections(md, errors, S1_FIELDS);
  checkGraphMembership(md, ids, errors);
  const rows = ledgerRows(md);
  checkLedgerMembership(rows, ids, idSet, errors);
  checkCompletion(md, status, rows, errors);
  return { preflight: pstatus, sections: ids.length };
}

// ---------- schema 2 (current) ----------

const S2_HEADINGS = [
  ["premise corrections", /^## Premise corrections$/m],
  ["execution contract", /^## 0\. Execution contract$/m],
  ["roles", /^### Roles$/m],
  ["harness routing", /^### Harness routing$/m],
  ["global gate", /^### Global gate$/m],
  ["execution-environment preflight", /^### Execution-environment preflight$/m],
  ["known blockers", /^#### Known blockers$/m],
  [
    "lifecycle gate budget",
    /^### Expensive or mutating lifecycle gate budget$/m,
  ],
  ["rulings", /^### Rulings$/m],
  ["floor rulings", /^#### Floor rulings\b.*$/m],
  ["recorded calls", /^#### Recorded calls\b.*$/m],
  ["base drift policy", /^### Base drift policy$/m],
  ["rules", /^### Rules$/m],
  ["goals", /^## 1\. Goals\b.*$/m],
  ["topology", /^## 2\. Topology graph and recommended order$/m],
  ["topology graph", /^### Topology graph$/m],
  ["Graph Findings", /^### Graph Findings$/m],
  ["corrections in force", /^### Corrections in force$/m],
  ["hard dependencies", /^### Hard dependencies$/m],
  ["soft dependencies", /^### Soft dependencies$/m],
  ["recommended linear order", /^### Recommended linear order$/m],
  ["sections", /^## 3\. Sections$/m],
  ["acceptance protocol", /^## 4\. Main-session acceptance protocol$/m],
  ["progress ledger", /^## 5\. Progress ledger$/m],
  ["completion", /^## Completion$/m],
  ["deferrals", /^## Deferrals$/m],
];
const S2_FIELDS = [
  ...S1_FIELDS.slice(0, 6),
  "WRITERS",
  "SIBLING SURFACES",
  ...S1_FIELDS.slice(6),
];

function validateSchema2(md, fm, errors) {
  const status = fm.status;
  if (!/^\d+\.\d+\.\d+$/.test(fm.gdi_version ?? "")) {
    errors.push(
      "frontmatter gdi_version must be the skill release (semver), copied from assets/VERSION",
    );
  }
  if (!["claude", "codex"].includes(fm.harness))
    errors.push("frontmatter harness must be claude or codex");

  for (const [label, re] of S2_HEADINGS)
    if (!re.test(md)) errors.push(`missing required heading: ${label}`);

  const { pre, pstatus } = checkPreflight(md, status, errors);
  if (!/^\| Condition \| Detection \| Pre-approved handling \|$/m.test(pre)) {
    errors.push(
      "Known blockers table is missing (Condition | Detection | Pre-approved handling)",
    );
  }

  // Gate budget: actual runs recorded once verified/shipped.
  const budget = between(
    md,
    /^### Expensive or mutating lifecycle gate budget$/m,
    /^### Rulings$/m,
  );
  const bt = parseTable(budget);
  const actualIdx = bt.header.findIndex((h) => /^actual runs$/i.test(h));
  if (actualIdx === -1)
    errors.push(
      'lifecycle gate budget table must have an "Actual runs" column',
    );
  else if (["verified", "shipped"].includes(status)) {
    bt.rows.forEach((r, i) => {
      const cell = r[actualIdx] ?? "";
      if (!/^\d+$/.test(cell.replace(/`/g, ""))) {
        errors.push(
          `gate budget row ${i + 1} must record an integer in "Actual runs" once ${status}`,
        );
      }
    });
  }

  // Floor rulings: none pending once the plan leaves draft.
  const floor = between(
    md,
    /^#### Floor rulings\b.*$/m,
    /^#### Recorded calls\b.*$/m,
  );
  const ft = parseTable(floor);
  const rulingIdx = ft.header.findIndex((h) => /^ruling$/i.test(h));
  if (rulingIdx === -1)
    errors.push('Floor rulings table must have a "Ruling" column');
  else if (status && status !== "draft") {
    ft.rows.forEach((r, i) => {
      const cell = (r[rulingIdx] ?? "").toLowerCase();
      if (!cell || cell.includes("pending") || isPlaceholder(r[rulingIdx])) {
        errors.push(
          `floor ruling row ${i + 1} is still pending; status ${status} requires every floor ruling recorded`,
        );
      }
    });
  }

  const { ids, idSet } = checkSections(md, errors, S2_FIELDS);
  const graph = checkGraphMembership(md, ids, errors);
  const rows = ledgerRows(md);
  checkLedgerMembership(rows, ids, idSet, errors);

  // Ledger record schema for checked rows.
  for (const r of rows) {
    if (!r.done) continue;
    const rounds = r.text.match(/\brounds:\s*(\d+)/);
    if (!rounds) {
      errors.push(
        `ledger row ${r.id} is checked but has no "rounds: n" record`,
      );
      continue;
    }
    const n = Number(rounds[1]);
    if (r.rounds.length !== n) {
      errors.push(
        `ledger row ${r.id} declares rounds: ${n} but has ${r.rounds.length} "R<k> <class>:" lines`,
      );
    }
    if (!/\breview:\s*(independent|self\s*\()/.test(r.text)) {
      errors.push(
        `ledger row ${r.id} must record "review: independent" or "review: self (<reason>)"`,
      );
    }
    if (!/\brouting:/.test(r.text))
      errors.push(`ledger row ${r.id} must record "routing:"`);
    if (!/\bcost:/.test(r.text))
      errors.push(`ledger row ${r.id} must record "cost:"`);
    if (!/\baccepted\b/.test(r.text))
      errors.push(`ledger row ${r.id} must record "accepted <date> <sha>"`);

    // Graph marks derived from the ledger, enforced once the plan reaches a completion status.
    if (graph && COMPLETION_STATUSES.has(status)) {
      const nodeLines = graph
        .split(/\r?\n/)
        .filter((l) => new RegExp(`\\b${r.id}\\b`).test(l) && /\[/.test(l));
      const labels = nodeLines.join("\n");
      if (n > 0 && !labels.includes(`🔁×${n}`)) {
        errors.push(
          `topology node ${r.id} must carry 🔁×${n} to match the ledger`,
        );
      }
      if (n === 0 && !labels.includes("✅")) {
        errors.push(
          `topology node ${r.id} must carry ✅ (accepted with no rejection rounds)`,
        );
      }
    }
  }

  const deferrals = checkCompletion(md, status, rows, errors);
  // Every deferral row carries a tracking issue or a machine-checkable re-entry gate.
  if (!/^\s*None\.\s*$/m.test(deferrals)) {
    const dt = parseTable(deferrals);
    const ownerIdx = dt.header.findIndex((h) => /owner/i.test(h));
    const gateIdx = dt.header.findIndex((h) => /re-entry/i.test(h));
    if (ownerIdx === -1 || gateIdx === -1) {
      if (dt.header.length)
        errors.push(
          'Deferrals table must have "Owner / issue" and "Re-entry gate" columns',
        );
    } else {
      dt.rows.forEach((r, i) => {
        const owner = (r[ownerIdx] ?? "").replace(/`/g, "");
        const gate = (r[gateIdx] ?? "").replace(/`/g, "");
        const tracked = /#\d+/.test(owner) || /https?:\/\//.test(owner);
        const gated =
          gate && !isPlaceholder(gate) && !/^(none|-|n\/a|tbd)$/i.test(gate);
        if (!tracked && !gated) {
          errors.push(
            `deferral row ${i + 1} needs a filed issue (#n or URL) in "Owner / issue" or a machine-checkable "Re-entry gate"`,
          );
        }
      });
    }
  }

  return { preflight: pstatus, sections: ids.length };
}

// ---------- entry ----------

export function validatePlan(md) {
  const errors = [];
  const fm = parseFrontmatter(md, errors);
  const schema = fm.gdi_schema;
  const status = fm.status;
  if (!LIFECYCLE.has(status))
    errors.push(
      `frontmatter status must be one of: ${[...LIFECYCLE].join(", ")}`,
    );
  if (!fm.approval) errors.push("frontmatter approval is required");
  else if (
    status !== "draft" &&
    !["superseded", "abandoned"].includes(status) &&
    fm.approval === "pending"
  ) {
    errors.push(`status ${status} requires non-pending approval evidence`);
  }
  let extra = {};
  if (schema === "2") extra = validateSchema2(md, fm, errors);
  else if (schema === "1") extra = validateSchema1(md, fm, errors);
  else errors.push("frontmatter gdi_schema must be 2 (current) or 1 (legacy)");
  return {
    errors,
    summary: {
      approval: fm.approval,
      schema,
      status,
      version: fm.gdi_version,
      ...extra,
    },
  };
}

// ---------- self-test ----------

const S2_FIXTURE = `---
gdi_schema: 2
gdi_version: 0.2.0
status: approved
approval: 2026-09-01
harness: claude
---

# Example — Goal-Driven Implementation Plan

## Premise corrections
- none

## 0. Execution contract
### Roles
### Harness routing
| Role | Requested | Role-confirmed | Model/effort-confirmed | Fallback used |
|---|---|---|---|---|
| Implementer | gdi-implementer | yes | opus/high | none |
### Global gate
### Execution-environment preflight
Preflight status: ready
Checked: 2026-09-01
Baseline SHA: abc1234
Execution realm: local
| Capability | Probe / expected condition | Observed evidence | Classification |
|---|---|---|---|
| Toolchain | available | observed | ready |
#### Known blockers
| Condition | Detection | Pre-approved handling |
|---|---|---|
| none | - | - |
### Expensive or mutating lifecycle gate budget
| Gate | Consumes / invalidated by | Planned runs (impl / orch) | Preflight | Actual runs | Why this count is safe |
|---|---|---:|---|---:|---|
| Build | source | 0 / 1 | proven | 1 | after review |
### Rulings
#### Floor rulings (the user owns these)
| # | Section | Decision | Options | Recommendation | Ruling |
|---|---|---|---|---|---|
| F3 | all | Terminal external action | commit | commit | ruled 2026-09-01: commit |
#### Recorded calls (orchestrator-ruled under the floor, user-vetoable)
| # | Section | Call | Rationale |
|---|---|---|---|
| R1 | A1 | additive column | preserves invariant |
### Base drift policy
Re-baseline before final review.
### Rules
- sequential
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
### Corrections in force
- none yet
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
gdi-implementer.
CONTEXT TO AGGREGATE:
1. Existing code.
WRITERS:
- src/x.ts:10
SIBLING SURFACES:
none.
LIFECYCLE / GATE EFFECTS:
- Produces: source.
IMPLEMENT:
- Change behavior.
CONTRACT DECISION — ESCALATE:
Stop on floor items.
VERIFY:
- Run tests.
REVIEW:
Contract, scope, doc-truth.
ACCEPTANCE:
Goal 1 outcome.
COMMIT:
feat(example): add slice
## 4. Main-session acceptance protocol
Apply the checks.
## 5. Progress ledger
- [ ] A1 slice
## Completion
- [ ] Every section is committed.
- [ ] Goal 1 exit tests pass with evidence.
## Deferrals
None.
`;

const S1_FIXTURE = `---
gdi_schema: 1
status: approved
approval: 2026-08-29
---

# Legacy — Goal-Driven Implementation Plan

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

function expectError(result, needle, label) {
  if (!result.errors.some((e) => e.includes(needle))) {
    throw new Error(
      `${label}: expected an error containing "${needle}", got:\n${result.errors.join("\n") || "(none)"}`,
    );
  }
}

function selfTest() {
  const ok = validatePlan(S2_FIXTURE);
  if (ok.errors.length)
    throw new Error(`schema-2 fixture failed:\n${ok.errors.join("\n")}`);
  const legacy = validatePlan(S1_FIXTURE);
  if (legacy.errors.length)
    throw new Error(`schema-1 fixture failed:\n${legacy.errors.join("\n")}`);

  const accepted = S2_FIXTURE.replace(
    "status: approved",
    "status: implemented",
  ).replace(
    "- [ ] A1 slice",
    "- [x] A1 slice — accepted 2026-09-01 abc1234 — rounds: 1 — review: independent — routing: requested=gdi-implementer; role=yes; model/effort=opus/high — cost: ~90k tokens / 4 agents\n  - R1 doc-truth: README over-claimed the retry behavior",
  );
  expectError(validatePlan(accepted), "must carry 🔁×1", "graph mark parity");
  const annotated = accepted.replace(
    'A1["A1 — slice"]',
    'A1["A1 — slice ✅ 🔁×1"]',
  );
  const annotatedResult = validatePlan(annotated);
  if (annotatedResult.errors.length)
    throw new Error(
      `annotated fixture failed:\n${annotatedResult.errors.join("\n")}`,
    );

  expectError(
    validatePlan(
      S2_FIXTURE.replace("status: approved", "status: executing").replace(
        "- [ ] A1 slice",
        "- [x] A1 slice",
      ),
    ),
    'has no "rounds: n" record',
    "ledger record schema",
  );
  expectError(
    validatePlan(
      accepted
        .replace("rounds: 1 —", "rounds: 2 —")
        .replace('A1["A1 — slice"]', 'A1["A1 — slice 🔁×2"]'),
    ),
    "declares rounds: 2 but has 1",
    "round line count",
  );
  expectError(
    validatePlan(S2_FIXTURE.replace("ruled 2026-09-01: commit", "pending")),
    "is still pending",
    "floor ruling pending after approval",
  );
  expectError(
    validatePlan(
      S2_FIXTURE.replace(
        "## Deferrals\nNone.\n",
        "## Deferrals\n| ID | Class | Remaining work and risk | Owner / issue | Re-entry gate | Blocks | Status |\n|---|---|---|---|---|---|---|\n| D1 | coverage | live check | Ops | <observable> | none | open |\n",
      ),
    ),
    "needs a filed issue",
    "deferral tracking",
  );
  const trackedDeferral = validatePlan(
    S2_FIXTURE.replace(
      "## Deferrals\nNone.\n",
      "## Deferrals\n| ID | Class | Remaining work and risk | Owner / issue | Re-entry gate | Blocks | Status |\n|---|---|---|---|---|---|---|\n| D1 | coverage | live check | #123 | after deploy | none | open |\n",
    ),
  );
  if (trackedDeferral.errors.length)
    throw new Error(
      `tracked deferral failed:\n${trackedDeferral.errors.join("\n")}`,
    );
  expectError(
    validatePlan(
      annotated
        .replace("status: implemented", "status: verified")
        .replace("| 1 | after review", "| <n> | after review"),
    ),
    'must record an integer in "Actual runs"',
    "actual runs once verified",
  );
  expectError(
    validatePlan(
      S2_FIXTURE.replace("gdi_version: 0.2.0", "gdi_version: <copy>"),
    ),
    "gdi_version",
    "version stamp",
  );
  expectError(
    validatePlan(S2_FIXTURE.replace("WRITERS:\n- src/x.ts:10\n", "")),
    "missing field: WRITERS",
    "writers field",
  );
  expectError(
    validatePlan(S1_FIXTURE.replace("DEPENDS ON:\nnone.", "DEPENDS ON:\nA1.")),
    "depends on itself",
    "legacy dependency",
  );
  console.log("validate-plan self-test passed (schema 2 + legacy schema 1)");
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--self-test") {
  selfTest();
  process.exit(0);
}
if (args.length !== 1 || args[0].startsWith("--")) {
  console.error("Usage: node validate-plan.mjs <plan.md> | --self-test");
  process.exit(2);
}
const planPath = resolve(args[0]);
let markdown;
try {
  markdown = readFileSync(planPath, "utf8");
} catch (error) {
  console.error(`Could not read ${planPath}: ${error.message}`);
  process.exit(2);
}
const result = validatePlan(markdown);
if (result.errors.length) {
  console.error(`Plan validation failed: ${basename(planPath)}`);
  for (const e of result.errors) console.error(`- ${e}`);
  process.exit(1);
}
const s = result.summary;
console.log(
  `Plan validation passed: ${basename(planPath)} (schema=${s.schema}${s.version ? `, gdi_version=${s.version}` : ""}, status=${s.status}, preflight=${s.preflight}, sections=${s.sections})`,
);
