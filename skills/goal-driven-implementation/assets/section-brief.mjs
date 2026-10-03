#!/usr/bin/env node
// Writes one section's assignment file from a plan and prints the dispatch stubs for that section.
// The orchestrator sends a stub; the agent reads the files it names. Nothing in the assignment is
// retyped: the section block, rulings, corrections in force, gates, and preflight are copied from
// the plan.
//
//   node section-brief.mjs <plan.md> <ID> --run-dir <dir> --repo-root <repo> [--round <n>]
//                          [--harness claude|codex]
//   node section-brief.mjs <plan.md> <ID>            print the assignment, write nothing
//   node section-brief.mjs --self-test
//
// --run-dir    a directory outside the repository for this plan's dispatch files and agent
//              reports. The assignment goes to <dir>/<ID>.assignment.md.
// --repo-root  the checkout. The first call stores its uncommitted paths in <dir>/baseline.txt as
//              the WORKING-TREE BASELINE; later calls read that file, so a section's own work in
//              progress never becomes baseline. Nothing is captured when work may already be in
//              the tree (a correction round, or a ledger row with batch state): write
//              baseline.txt by hand then. Edit the file when unrelated changes appear.
// --round      0 (default) for the first dispatch; n for the n-th correction round. It selects
//              the report file names and, from round 1, prints the stub for a fresh carrier.
// --harness    defaults to the plan's `harness` frontmatter. Codex stubs carry REPORT FILE: none.
//
// Exit 0 = written, 1 = the plan lacks the section, 2 = usage or IO error.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { between, ledgerRows, parseFrontmatter, parseTable, sectionBlocks, writeSet } from "./validate-plan.mjs";

const ASSETS = dirname(fileURLToPath(import.meta.url));
const slug = (lens) => lens.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function gitEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));
}

// Uncommitted paths, repository-relative, the plan file left out.
function uncommittedPaths(repoRoot, planPath) {
  const out = execFileSync("git", ["--no-optional-locks", "-C", repoRoot, "status", "--porcelain=v1", "-z", "-uall"], {
    encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024,
  });
  const tokens = out.split("\0");
  const paths = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!tokens[i]) continue;
    const status = tokens[i].slice(0, 2);
    paths.push(`${status} ${tokens[i].slice(3)}`);
    if (/[RC]/.test(status)) i += 1;
  }
  return paths.filter((line) => basename(line.slice(3)) !== basename(planPath));
}

// The body under a heading up to the next heading of the same or a higher level. A `# comment`
// line inside a code fence is not a heading.
function under(md, headingRe, level) {
  const lines = md.split(/\r?\n/);
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start === -1) return "";
  const stop = new RegExp(`^#{1,${level}} `);
  const body = [];
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && stop.test(line)) break;
    body.push(line);
  }
  return body.join("\n").replace(/^\s*\n/, "").trimEnd();
}

// A path as one shell word.
const q = (path) => (/^[\w@%+=:,./-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`);

// Whether a Section cell covers the section: `all`, the ID, or a range such as `B1-B3` or `D1–4`.
export function cellCovers(cell, id) {
  const text = cell.replace(/`/g, "");
  if (/\ball\b/i.test(text) || new RegExp(`\\b${id}\\b`).test(text)) return true;
  const [, letter, number] = id.match(/^([A-Z])(\d+)$/);
  for (const m of text.matchAll(/\b([A-Z])(\d+)\s*[-–—]\s*([A-Z])?(\d+)\b/g)) {
    if (m[1] === letter && (m[3] ?? letter) === letter && Number(m[2]) <= Number(number) && Number(number) <= Number(m[4])) return true;
  }
  return false;
}

// Table rows whose Section cell covers this section, with the table's header.
function rulingRows(body, id) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim().startsWith("|"));
  const { header, rows } = parseTable(body);
  const col = header.findIndex((h) => /^section$/i.test(h));
  if (col === -1 || lines.length < 3) return [];
  const mine = lines.slice(2).filter((_, i) => cellCovers(rows[i]?.[col] ?? "", id));
  return mine.length ? [lines[0], lines[1], ...mine] : [];
}

export function buildAssignment(md, id, { planPath = "", baseline = null } = {}) {
  const heading = [...md.matchAll(/^## ([A-Z][0-9]+) — (.+)$/gm)].find((m) => m[1] === id);
  const section = sectionBlocks(md).find((s) => s.id === id);
  if (!heading || !section) return null;
  const title = heading[2].trim();
  const fm = parseFrontmatter(md, []);

  const floor = rulingRows(between(md, /^#### Floor rulings\b.*$/m, /^#{1,6} /m), id);
  const calls = rulingRows(between(md, /^#### Recorded calls\b.*$/m, /^#{1,6} /m), id);
  const corrections = under(md, /^### Corrections in force$/, 3);
  const gate = under(md, /^### Global gate$/, 3);
  const preflight = under(md, /^### Execution-environment preflight$/, 3);

  // Every other section whose unchecked ledger row carries batch state has uncommitted work here.
  const blocks = new Map(sectionBlocks(md).map((s) => [s.id, s.block]));
  const titles = new Map([...md.matchAll(/^## ([A-Z][0-9]+) — (.+)$/gm)].map((m) => [m[1], m[2].trim()]));
  const siblings = ledgerRows(md)
    .filter((row) => !row.done && row.id !== id)
    .map((row) => ({ id: row.id, state: row.text.match(/\b(batch\s+[\w-]+:\s*[^—]*|left batch\s+[\w-]+[^—]*)/i)?.[1].trim() }))
    .filter((row) => row.state)
    .map((row) => ({ ...row, title: titles.get(row.id) ?? "", set: writeSet(blocks.get(row.id) ?? "", row.id, []) ?? [] }));
  const batchLabel = section.block.match(/^PARALLEL:\s*\n?\s*`?batch\s+([\w-]+)/mi)?.[1];
  const batchState = ledgerRows(md).some((row) => !row.done && /\b(batch\s+[\w-]+:|left batch)/i.test(row.text));

  const parts = [
    `# Assignment — ${id} ${title}`,
    "",
    `Generated from ${planPath || "the plan"}${fm.gdi_version ? ` (gdi_version ${fm.gdi_version}, status ${fm.status})` : ""}.`,
    "The plan file remains the source. Do not edit the plan or this file.",
    "",
    "=== SECTION (verbatim from the plan) ===",
    `${heading[0]}${section.block.trimEnd()}`,
    "",
    "=== APPLICABLE RULINGS ===",
    "Floor rulings (the user's):",
    floor.length ? floor.join("\n") : "none recorded for this section",
    "",
    "Recorded calls (the orchestrator's, below the floor):",
    calls.length ? calls.join("\n") : "none recorded for this section",
    "",
    "=== CORRECTIONS IN FORCE ===",
    corrections || "none yet",
    "",
    "=== GLOBAL GATE ===",
    gate || "none recorded",
    "",
    "=== EXECUTION-ENVIRONMENT PREFLIGHT ===",
    preflight || "none recorded",
    "",
    "=== PARALLEL BATCH ===",
    siblings.length
      ? siblings.map((s) => `- ${s.id} — ${s.title} — ${s.state} — WRITE SET: ${s.set.length ? s.set.join(", ") : "none declared"}`).join("\n")
      : "none — no other section has uncommitted work in this checkout",
    "",
    "=== WORKING-TREE BASELINE ===",
    baseline === null
      ? "not captured — treat every uncommitted change outside your own work as one to preserve, and ask the orchestrator before touching one"
      : baseline.length
        ? `Changes that predate this section. Preserve them and leave them out of your work:\n${baseline.join("\n")}`
        : "clean — every uncommitted change in the checkout is this section's work, or a listed PARALLEL BATCH section's",
    "",
  ];
  return { text: parts.join("\n"), title, siblings, batchLabel, batchState, harness: fm.harness };
}

export function dispatchStubs({ id, runDir, repoRoot, round = 0, harness = "claude", lenses = [] }) {
  const file = (name) => join(runDir, name);
  const suffix = round > 0 ? `-r${round}` : "";
  const prior = round > 1 ? `${id}-impl-r${round - 1}.md` : `${id}-impl.md`;
  const validate = (kind, name) =>
    `node ${q(join(ASSETS, "validate-report.mjs"))} --kind ${kind} --repo-root ${repoRoot ? q(repoRoot) : "<repo>"} --input ${q(file(name))} --fix`;
  const delivery = (kind, name) => harness === "codex"
    ? ["REPORT FILE: none — return the report as your final message"]
    : [`REPORT FILE: ${file(name)}`, `VALIDATE: ${validate(kind, name)}`];
  const assignment = file(`${id}.assignment.md`);
  const implementer = round === 0
    ? [
        "IMPLEMENTER",
        `Read ${join(ASSETS, "prompts", "implementer.md")} and ${assignment} in full before anything else.`,
        "The first holds your rules and report format. The second is your assignment.",
        ...delivery("implementer", `${id}-impl.md`),
        "ADDITIONAL CONTEXT: none",
      ]
    : [
        `FRESH CORRECTION CARRIER (round ${round}; a resumed implementer gets the rejection follow-up instead)`,
        `Read ${join(ASSETS, "prompts", "implementer.md")} and ${assignment} in full before anything else.`,
        "You take over this section at a correction round: follow CORRECTION ROUND in the rules file.",
        `PRIOR REPORT: ${file(prior)}`,
        "REVIEW RESULT: rejected. Fix exactly these gaps, nothing else:",
        "1. <file:line — gap — required fix>",
        ...delivery("implementer", `${id}-impl${suffix}.md`),
      ];
  const report = round === 0 ? `${id}-impl.md` : `${id}-impl${suffix}.md`;
  const named = lenses.length ? lenses : ["<lens>"];
  const reviewer = [
    `REVIEWER (one dispatch per lens${lenses.length ? "" : "; replace <lens>"})`,
    `Read ${join(ASSETS, "prompts", "reviewer.md")}, ${assignment}, and the implementer report ${file(report)} in full before anything else.`,
    `LENS: ${named.length === 1 ? named[0] : "<one of the lenses below>"}`,
    "DIFF SCOPE: the uncommitted changes the report's DIFF lists",
    "GRAPH CONTEXT: none",
    ...(harness === "codex"
      ? [...delivery("reviewer", ""), ...(named.length > 1 ? named.map((lens) => `  ${lens}`) : [])]
      : named.length === 1
        ? delivery("reviewer", `${id}-rev-${slug(named[0])}${suffix}.md`)
        : [
            `REPORT FILE: ${file(`${id}-rev-<lens>${suffix}.md`)}`,
            `VALIDATE: ${validate("reviewer", `${id}-rev-<lens>${suffix}.md`)}`,
            ...named.map((lens) => `  ${lens} → ${id}-rev-${slug(lens)}${suffix}.md`),
          ]),
  ];
  return [implementer.join("\n"), reviewer.join("\n")].join("\n\n");
}

// The lens names a section's REVIEW field lists. Only a list item that is a lens name counts: a
// sentence that mentions "capacity" or "contract" names no lens.
export function sectionLenses(block) {
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((l) => /^REVIEW:/.test(l));
  if (start === -1) return [];
  const body = [lines[start].replace(/^REVIEW:/, "")];
  for (const line of lines.slice(start + 1)) {
    if (/^[A-Z][A-Z0-9 /—-]+:\s*/.test(line) || /^## /.test(line)) break;
    body.push(line);
  }
  const known = [
    ["security/authz", /^security(\/[\w-]+)?$|^authz$/], ["data/migration", /^data(\/migration)?( correctness)?$|^migration$/],
    ["contract/API", /^contract(\/api)?( compatibility)?$|^api$/], ["failure-mode/reliability", /^failure-mode(\/[\w-]+)?$|^reliability$/],
    ["convention/scope", /^convention(\/scope)?$|^scope$/], ["doc-truth", /^doc-truth$/],
    ["capacity/false-positive", /^capacity(\/false-positive)?$/], ["evaluator soundness", /^evaluator( soundness)?$/],
  ];
  const text = body.join("\n").trim();
  if (text.startsWith("<")) return [];
  const items = text.split(/[,;+·\n]|\band\b|\.\s/)
    .map((item) => item.replace(/^\s*(?:[-*]\s+)?(?:(?:independent\s+)?lenses(?: by name)?:)?\s*/i, "")
      .replace(/\s+(?:\(|—|–|- ).*$/, "").replace(/^(?:independent|the)\s+/i, "").replace(/\s+lens(?:es)?$/i, "")
      .replace(/[.`*\s]+$/g, "").replace(/^[`*]+/, "").toLowerCase());
  return known.filter(([, re]) => items.some((item) => re.test(item))).map(([name]) => name);
}

// ---------- self-test ----------

function selfTest() {
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`self-test: ${msg}`);
  };
  const plan = `---
gdi_schema: 2
gdi_version: 0.9.0
status: executing
approval: 2026-10-03
harness: claude
---

# Example

## 0. Execution contract
### Global gate
\`\`\`bash
# the owning package, then its dependents
npm test
\`\`\`
Final gate: after final review.
### Execution-environment preflight
Preflight status: ready
#### Known blockers
| Condition | Detection | Pre-approved handling |
| --------- | --------- | --------------------- |
| port busy | EADDRINUSE | use 3013 |
### Expensive or mutating lifecycle gate budget
| Gate | Actual runs |
|---|---|
### Rulings
#### Floor rulings (the user owns these)
| #   | Section | Decision | Ruling |
| --- | ------- | -------- | ------ |
| F1  | A2 ⚠    | price    | ruled  |
| F3  | all     | terminal | commit |
#### Recorded calls (orchestrator-ruled under the floor, user-vetoable)
| # | Section | Call | Rationale |
|---|---|---|---|
| R1 | A1, A3 | additive column | invariant |
| R2 | A2 | other | none |
| R3 | A1–A2 | ranged call | spans both |
#### Approved contract
| Field | Section | Note |
|---|---|---|
| id | all | not a recorded call |
### Base drift policy
Rebase before final review.
## 2. Topology graph and recommended order
### Corrections in force
- 2026-10-03 — A0 — the fee is reserved, not debited (src/a.ts:3)
### Hard dependencies
- none
## 3. Sections
## A1 — First slice
GOAL:
Outcome one.
DEPENDS ON:
none
PARALLEL:
batch 1
WRITE SET:
- src/a/
REVIEW:
Lenses: security, contract, convention/scope, doc-truth.
ACCEPTANCE:
Goal 1.
COMMIT:
feat: one
## A2 — Second slice
GOAL:
Outcome two.
PARALLEL:
batch 1
WRITE SET:
- src/b/
- docs/b.md — owning doc
REVIEW:
<Lenses: security, data>
COMMIT:
feat: two
## 4. Main-session acceptance protocol
Apply the checks.
## 5. Progress ledger
\`\`\`text
- [x] A1 <title> — batch 9: implementing
\`\`\`
- [ ] A1 First slice — Goal 1 — batch 1: implementing
- [ ] A2 Second slice — Goal 1 — batch 1: in review /run/A2-impl.md
## Completion
- [ ] done
## Deferrals
None.
`;
  const a1 = buildAssignment(plan, "A1", { planPath: "/p/plan.md", baseline: ["?? notes.txt"] });
  assert(a1 && a1.title === "First slice", "section found with its title");
  assert(a1.text.includes("## A1 — First slice\nGOAL:\nOutcome one."), "section block is verbatim");
  assert(!a1.text.includes("Outcome two"), "another section's block is left out");
  assert(a1.text.includes("| F3  | all     | terminal | commit |") && !a1.text.includes("| F1 "), "floor rulings filtered by section");
  assert(a1.text.includes("| R1 | A1, A3 | additive column | invariant |") && !a1.text.includes("| R2 "), "recorded calls filtered by section");
  assert(a1.text.includes("| R3 | A1–A2 | ranged call | spans both |") && !a1.text.includes("not a recorded call"), "a range covers the section; the next table is not read");
  for (const [cell, id, expected] of [["B1-B3", "B2", true], ["B1-B3", "B4", false], ["D1–4", "D3", true], ["B1-B3, D1-D4", "D4", true],
    ["B1-B3", "C2", false], ["A2 ⚠", "A2", true], ["A12", "A1", false], ["all sections", "C7", true], ["A1-B3", "A2", false]]) {
    assert(cellCovers(cell, id) === expected, `cellCovers(${cell}, ${id}) should be ${expected}`);
  }
  assert(a1.text.includes("the fee is reserved, not debited (src/a.ts:3)") && !a1.text.includes("Hard dependencies"), "corrections in force copied");
  assert(a1.text.includes("# the owning package, then its dependents\nnpm test") && a1.text.includes("Final gate: after final review."), "global gate copied past a fenced comment line");
  assert(a1.text.includes("| port busy | EADDRINUSE | use 3013 |") && !a1.text.includes("Actual runs"), "preflight carries known blockers only");
  assert(a1.text.includes("- A2 — Second slice — batch 1: in review /run/A2-impl.md — WRITE SET: src/b/, docs/b.md"), `sibling listed with state and write set:\n${a1.text}`);
  assert(a1.text.includes("?? notes.txt") && a1.batchLabel === "1", "baseline listed; batch label read");
  const a2 = buildAssignment(plan, "A2", {});
  assert(a2.text.includes("- A1 — First slice — batch 1: implementing — WRITE SET: src/a/"), "fenced ledger example is not a sibling");
  assert(a2.text.includes("| F1  | A2 ⚠    | price    | ruled  |") && a2.text.includes("not captured"), "floor row with a mark; baseline not captured");
  assert(buildAssignment(plan, "A9", {}) === null, "unknown section");
  const alone = buildAssignment(plan.replace(" — batch 1: in review /run/A2-impl.md", ""), "A1", { baseline: [] });
  assert(alone.text.includes("none — no other section has uncommitted work") && alone.text.includes("clean —"), "no sibling state, clean baseline");

  const blocks = new Map(sectionBlocks(plan).map((s) => [s.id, s.block]));
  assert(sectionLenses(blocks.get("A1")).join() === "security/authz,contract/API,convention/scope,doc-truth", `lenses read from REVIEW: ${sectionLenses(blocks.get("A1"))}`);
  assert(sectionLenses(blocks.get("A2")).length === 0, "a placeholder REVIEW field names no lens");
  const lensesOf = (review) => sectionLenses(`GOAL:\nx\nREVIEW:\n${review}\nACCEPTANCE:\ny`).join();
  assert(lensesOf("Lenses: security, data, contract, reliability, convention/scope, doc-truth.") ===
    "security/authz,data/migration,contract/API,failure-mode/reliability,convention/scope,doc-truth", "short lens names in a list");
  assert(lensesOf("Convention/scope and doc-truth. The API contract is unchanged, so no new capacity policy review is required.") ===
    "convention/scope,doc-truth", `a sentence that mentions a lens word names no lens: ${lensesOf("Convention/scope and doc-truth. The API contract is unchanged, so no new capacity policy review is required.")}`);
  assert(lensesOf("- security/authz\n- doc-truth; evaluator soundness + capacity/false-positive") ===
    "security/authz,doc-truth,capacity/false-positive,evaluator soundness", "bulleted and separated lens names");
  assert(lensesOf("Independent security/tenancy, data (additive payload field), contract/API — the BFF shape, and doc-truth\nlenses.") ===
    "security/authz,data/migration,contract/API,doc-truth", "lens names with a note or a qualifier");
  const stubs = dispatchStubs({ id: "A1", runDir: "/run", repoRoot: "/repo", lenses: ["doc-truth"] });
  assert(stubs.includes("REPORT FILE: /run/A1-impl.md") && stubs.includes("--kind implementer --repo-root /repo --input /run/A1-impl.md --fix"), "implementer stub");
  assert(stubs.includes("REPORT FILE: /run/A1-rev-doc-truth.md") && stubs.includes("the implementer report /run/A1-impl.md"), "reviewer stub");
  const round2 = dispatchStubs({ id: "A1", runDir: "/run", repoRoot: "/repo", round: 2, lenses: ["doc-truth", "contract/API"] });
  assert(round2.includes("PRIOR REPORT: /run/A1-impl-r1.md") && round2.includes("REPORT FILE: /run/A1-impl-r2.md"), "carrier stub names the prior and the new report");
  assert(round2.includes("contract/API → A1-rev-contract-api-r2.md"), "reviewer file names per lens and round");
  const spaced = dispatchStubs({ id: "A1", runDir: "/tmp/my run", repoRoot: "/work/it's here", lenses: ["doc-truth"] });
  assert(spaced.includes(`--repo-root '/work/it'\\''s here' --input '/tmp/my run/A1-impl.md' --fix`), `paths are quoted as shell words:\n${spaced}`);
  const codex = dispatchStubs({ id: "A1", runDir: "/run", repoRoot: "/repo", harness: "codex", lenses: ["doc-truth"] });
  assert(!codex.includes("VALIDATE:") && codex.includes("REPORT FILE: none"), "codex stubs return the report as the final message");
  const codexLenses = dispatchStubs({ id: "A1", runDir: "/run", repoRoot: "/repo", harness: "codex", lenses: ["doc-truth", "contract/API"] });
  assert(codexLenses.includes("LENS: <one of the lenses below>") && codexLenses.endsWith("  doc-truth\n  contract/API"), `codex stub lists the lenses:\n${codexLenses}`);

  // A real worktree: the first call stores the baseline, later calls reuse it.
  const repo = mkdtempSync(join(tmpdir(), "gdi-brief-"));
  try {
    const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q", "-b", "main");
    const planPath = join(repo, "plan.md");
    const runDir = join(repo, ".run");
    const sequential = plan.replace(" — batch 1: implementing", "").replace(" — batch 1: in review /run/A2-impl.md", "");
    writeFileSync(planPath, sequential);
    writeFileSync(join(repo, "user notes.txt"), "unrelated\n");
    const script = fileURLToPath(import.meta.url);
    const run = (...args) => execFileSync(process.execPath, [script, planPath, ...args], { encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
    const exit = (...args) => {
      try {
        run(...args);
        return 0;
      } catch (error) {
        return error.status;
      }
    };
    const first = run("A1", "--run-dir", runDir, "--repo-root", repo);
    assert(first.includes(join(runDir, "A1.assignment.md")) && first.includes("LENS: <one of the lenses below>"), `CLI summary:\n${first}`);
    assert(readFileSync(join(runDir, "baseline.txt"), "utf8") === "?? user notes.txt\n", "baseline stored without the plan file or the run directory");
    mkdirSync(join(repo, "src", "a"), { recursive: true });
    writeFileSync(join(repo, "src", "a", "new.ts"), "export {};\n");
    run("A1", "--run-dir", runDir, "--repo-root", repo, "--round", "1");
    const again = readFileSync(join(runDir, "A1.assignment.md"), "utf8");
    assert(again.includes("?? user notes.txt") && !again.includes("src/a/new.ts"), "section work in progress is not baseline");

    // With work possibly in the tree and no stored baseline, nothing is captured.
    for (const [label, args, text] of [
      ["a correction round", ["--round", "1"], sequential],
      ["batch state in the ledger", [], plan],
    ]) {
      const fresh = join(repo, `.run-${args.length}`);
      writeFileSync(planPath, text);
      const out = run("A1", "--run-dir", fresh, "--repo-root", repo, ...args);
      assert(out.includes("NOT CAPTURED") && !existsSync(join(fresh, "baseline.txt")), `baseline is not captured at ${label}:\n${out}`);
      assert(readFileSync(join(fresh, "A1.assignment.md"), "utf8").includes("not captured —"), `assignment says so at ${label}`);
      writeFileSync(join(fresh, "baseline.txt"), "");
      assert(run("A1", "--run-dir", fresh, "--repo-root", repo, ...args).includes("baseline: 0 path(s)"), `a baseline written by hand is used at ${label}`);
    }
    assert(exit("A9", "--run-dir", runDir, "--repo-root", repo) === 1, "unknown section exits 1");
    assert(exit("A1", "--run-dir", runDir) === 2, "--run-dir without --repo-root is a usage error");
    assert(run("A2").startsWith("# Assignment — A2 Second slice"), "without --run-dir the assignment is printed");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
  console.log("section-brief self-test passed");
}

// ---------- CLI ----------

function main(argv) {
  const args = [...argv];
  if (args.includes("--self-test")) {
    selfTest();
    return 0;
  }
  const usage = "usage: section-brief.mjs <plan.md> <ID> [--run-dir <dir> --repo-root <repo>] [--round <n>] [--harness claude|codex] | --self-test";
  const opt = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return null;
    const v = args[i + 1];
    if (v === undefined || v.startsWith("--")) {
      console.error(`${name} requires a value`);
      process.exit(2);
    }
    args.splice(i, 2);
    return v;
  };
  const runDirArg = opt("--run-dir");
  const repoRootArg = opt("--repo-root");
  const roundArg = opt("--round") ?? "0";
  const harnessArg = opt("--harness");
  const [planArg, id] = args;
  if (!planArg || !/^[A-Z][0-9]+$/.test(id ?? "") || args.length !== 2 || !/^\d+$/.test(roundArg) ||
      (harnessArg && !["claude", "codex"].includes(harnessArg))) {
    console.error(usage);
    return 2;
  }
  if (runDirArg && !repoRootArg) {
    console.error(`--run-dir needs --repo-root: the baseline is captured from the checkout on the first call\n${usage}`);
    return 2;
  }
  const planPath = resolve(planArg);
  const repoRoot = repoRootArg ? resolve(repoRootArg) : null;
  const runDir = runDirArg ? resolve(runDirArg) : null;
  let md;
  try {
    md = readFileSync(planPath, "utf8");
  } catch (error) {
    console.error(`Could not read ${planPath}: ${error.message}`);
    return 2;
  }

  // The baseline is captured once, before any section work exists. At a correction round, or with
  // batch state in the ledger, uncommitted section work may be in the tree and is never captured.
  const stored = runDir ? join(runDir, "baseline.txt") : null;
  const workMayExist = Number(roundArg) > 0 ||
    ledgerRows(md).some((row) => !row.done && /\b(batch\s+[\w-]+:|left batch)/i.test(row.text));
  let baseline = null;
  let captured = false;
  try {
    if (stored && existsSync(stored)) {
      baseline = readFileSync(stored, "utf8").split(/\r?\n/).filter((l) => l.trim());
    } else if (repoRoot && !(runDir && workMayExist)) {
      const top = execFileSync("git", ["-C", repoRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] }).trim();
      const inRunDir = (path) => runDir && resolve(top, path).startsWith(`${runDir}/`);
      baseline = uncommittedPaths(repoRoot, planPath).filter((line) => !inRunDir(line.slice(3)));
      captured = Boolean(runDir);
    }
  } catch (error) {
    console.error(`Could not read the working tree of ${repoRoot}: ${error.message.split("\n")[0]}`);
    return 2;
  }

  const built = buildAssignment(md, id, { planPath, baseline });
  if (!built) {
    console.error(`${basename(planPath)} has no section "## ${id} — …"`);
    return 1;
  }
  if (!runDir) {
    process.stdout.write(built.text);
    return 0;
  }
  mkdirSync(runDir, { recursive: true });
  if (captured) writeFileSync(stored, baseline.length ? `${baseline.join("\n")}\n` : "");
  const out = join(runDir, `${id}.assignment.md`);
  writeFileSync(out, built.text);

  const harness = harnessArg ?? (built.harness === "codex" ? "codex" : "claude");
  const lenses = sectionLenses(sectionBlocks(md).find((s) => s.id === id).block);
  console.log(`assignment: ${out}`);
  console.log(`  section ${id} — ${built.title}`);
  console.log(`  parallel batch: ${built.siblings.length ? built.siblings.map((s) => `${s.id} (${s.state})`).join(", ") : "none"}`);
  console.log(`  baseline: ${baseline === null
    ? `NOT CAPTURED — section work may already be in the tree. Write the paths that predate the plan to ${stored} (one \`git status --porcelain\` line each, or an empty file) and run this again.`
    : `${baseline.length} path(s), ${stored}${captured ? " (captured now)" : ""}`}`);
  if (built.batchLabel && built.siblings.length === 0) {
    console.log(`  NOTE: ${id} carries batch ${built.batchLabel}, and no other ledger row carries batch state. If another member runs now, write its state on its row and run this again.`);
  }
  console.log(`  lenses named in REVIEW: ${lenses.length ? lenses.join(", ") : "none recognized"} (SKILL.md step 4 decides which run)`);
  console.log("");
  console.log(dispatchStubs({ id, runDir, repoRoot, round: Number(roundArg), harness, lenses }));
  return 0;
}

// Run the CLI when this file is the entry script, under any name or through a link.
const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && [entry, realpathSync(entry)].includes(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
