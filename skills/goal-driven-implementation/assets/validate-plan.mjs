#!/usr/bin/env node
// Validates a goal-driven implementation plan file.
//   node validate-plan.mjs <plan.md>      validate one plan
//   node validate-plan.mjs <plan.md> --commit-boundaries --repo-root <repo>
//     also check stopping-point fields and accepted commits against Git
//   node validate-plan.mjs <plan.md> --repo-root <repo> --write-sets [A1,A2]
//     also list uncommitted paths under the section whose WRITE SET owns them, with a digest per
//     section; without IDs, every unchecked section that declares a WRITE SET is listed
//   node validate-plan.mjs --self-test    run the built-in fixtures
// gdi_schema 2 is the current contract; gdi_schema 1 plans are validated with the legacy rules.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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

// A table header row with exactly these cells, whatever the column padding or letter case.
const hasTableHeader = (text, cells) =>
  text.split(/\r?\n/).some((line) => {
    const row = line.trim();
    if (!row.startsWith("|")) return false;
    const got = row.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().toLowerCase());
    return got.length === cells.length && got.every((c, i) => c === cells[i].toLowerCase());
  });

// Fenced code blocks hold examples, such as the ledger record schema; blank them so an example
// row is not read as plan content. Line count and offsets stay the same.
const withoutFences = (text) => {
  let fenced = false;
  return text.split("\n").map((line) => {
    const isFence = /^\s*(```|~~~)/.test(line);
    if (isFence) fenced = !fenced;
    return fenced || isFence ? "" : line;
  }).join("\n");
};

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
  const lines = withoutFences(ledger).split(/\r?\n/);
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

function checkCommitBoundaries(md, errors) {
  for (const m of md.matchAll(/^## ([A-Z][0-9]+) — (.+)$/gm)) {
    const rest = md.slice(m.index + m[0].length);
    const next = rest.search(/^## /m);
    const block = next === -1 ? rest : rest.slice(0, next);
    for (const name of ["MILESTONE", "COMMIT BOUNDARY"]) {
      if (isPlaceholder(field(block, name).replace(/\s+/g, " "))) {
        errors.push(`${m[1]} needs a concrete ${name} for commit-boundary review`);
      }
    }
  }
}

// Use the explicitly selected worktree, not an inherited Git process context.
function gitEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
}

// Read-only calls: without optional locks, `git status` never holds the index lock that an
// implementer's own Git command may need at the same moment.
function git(repoRoot, args, { trim = true } = {}) {
  const out = execFileSync("git", ["--no-optional-locks", "-C", repoRoot, ...args], {
    encoding: "utf8",
    env: gitEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return trim ? out.trim() : out;
}

// The plan file is the orchestrator's ledger, not section work. Match it by name so a plan that
// was moved (an archive step) still exempts its earlier path.
const isPlanFile = (path, planPath) => Boolean(planPath) && basename(path) === basename(planPath);

// ---------- parallel batches and write sets (optional schema-2 surface) ----------

function sectionBlocks(md) {
  return [...md.matchAll(/^## ([A-Z][0-9]+) — (.+)$/gm)].map((m) => {
    const rest = md.slice(m.index + m[0].length);
    const next = rest.search(/^## /m);
    return { id: m[1], block: next === -1 ? rest : rest.slice(0, next) };
  });
}

// WRITE SET: one repository-relative path or glob per line. `*` and `?` match inside one path
// segment, `**` is a whole segment that matches any depth, and a directory ends with `/`; every
// other entry names exactly the files its pattern matches. A list marker, backticks, and a note
// after a dash are allowed. Returns null when the field is absent, `none`, or still the template
// placeholder. Anything that would drop or misread a path is an error.
function writeSet(block, id, errors) {
  if (!/^WRITE SET:/m.test(block)) return null;
  const value = field(block, "WRITE SET");
  if (isPlaceholder(value.replace(/\s+/g, " ")) || /^(none|n\/a)(\s|\.?$)/i.test(value)) return null;
  const lines = block.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith("WRITE SET:"));
  const next = lines.slice(start + 1).map((l) => l.match(/^([A-Z][A-Z0-9 /—-]+):\s*/)?.[1]).find(Boolean);
  if (next && ![...S2_FIELDS, "MILESTONE", "COMMIT BOUNDARY", "PARALLEL"].includes(next)) {
    errors.push(`${id} WRITE SET is cut short by the label "${next}:"; list one path per line and nothing else`);
  }
  const entries = [];
  for (const raw of value.split(/\r?\n/)) {
    const line = raw.trim().replace(/^(?:[-*]|\d+[.)])\s+/, "");
    if (!line) continue;
    const quoted = line.match(/^`([^`]+)`(.*)$/);
    const entry = (quoted ? quoted[1] : line.split(/\s/)[0]).replace(/^\.\//, "");
    const rest = (quoted ? quoted[2] : line.slice(line.split(/\s/)[0].length)).trim();
    if (rest && !/^(?:—|–|-|\(|#|\/\/)/.test(rest)) {
      errors.push(`${id} WRITE SET takes one path per line, with any note after a dash: "${line}"`);
    } else if (/[,;]$/.test(entry) || /[{}[\]"\\]/.test(entry)) {
      errors.push(`${id} WRITE SET entry uses unsupported punctuation or glob syntax: "${entry}"`);
    } else if (entry.startsWith("/") || /^[A-Za-z]:/.test(entry)) {
      errors.push(`${id} WRITE SET path must be repository-relative: "${entry}"`);
    } else if (entry.split("/").some((seg) => seg.includes("**") && seg !== "**")) {
      errors.push(`${id} WRITE SET entry must use "**" as a whole path segment: "${entry}"`);
    } else {
      entries.push(entry);
    }
  }
  return entries;
}

function writeSetRegExp(entry) {
  const pattern = entry.endsWith("/") ? `${entry}**` : entry;
  let re = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      i += 1;
      if (pattern[i + 1] === "/") {
        i += 1;
        re += "(?:.*/)?";
      } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += escapeRe(c);
  }
  return new RegExp(`^${re}$`);
}

const inWriteSet = (path, entries) => entries.some((e) => writeSetRegExp(e).test(path));

// Two entries overlap when one file path can match both. A literal against a glob is exact. Two
// globs are compared segment by segment; once `**` makes the depth unknown, only two file names
// that cannot match rule an overlap out, so the answer errs toward reporting an overlap.
function entriesOverlap(a, b) {
  const isGlob = (s) => /[*?]/.test(s);
  const [pa, pb] = [a, b].map((e) => (e.endsWith("/") ? `${e}**` : e));
  if (!isGlob(pa) && !isGlob(pb)) return pa === pb;
  if (isGlob(pa) !== isGlob(pb)) return isGlob(pa) ? writeSetRegExp(pa).test(pb) : writeSetRegExp(pb).test(pa);
  const segmentsMatch = (x, y) => {
    if (!isGlob(x) && !isGlob(y)) return x === y;
    if (isGlob(x) !== isGlob(y)) return isGlob(x) ? writeSetRegExp(x).test(y) : writeSetRegExp(y).test(x);
    const head = (g) => g.slice(0, g.search(/[*?]/));
    const tail = (g) => g.slice(Math.max(g.lastIndexOf("*"), g.lastIndexOf("?")) + 1);
    return (head(x).startsWith(head(y)) || head(y).startsWith(head(x))) &&
      (tail(x).endsWith(tail(y)) || tail(y).endsWith(tail(x)));
  };
  const [sa, sb] = [pa.split("/"), pb.split("/")];
  for (let i = 0; i < Math.min(sa.length, sb.length); i += 1) {
    if (sa[i] === "**" || sb[i] === "**") {
      return sa.at(-1) === "**" || sb.at(-1) === "**" || segmentsMatch(sa.at(-1), sb.at(-1));
    }
    if (!segmentsMatch(sa[i], sb[i])) return false;
  }
  return sa.length === sb.length;
}

function writeSetsOverlap(a, b) {
  for (const x of a) for (const y of b) if (entriesOverlap(x, y)) return [x, y];
  return undefined;
}

// Sections sharing `PARALLEL: batch <label>` may be implemented at the same time: no DEPENDS ON
// path may join two members, and their WRITE SETs must be declared and disjoint.
function checkParallelBatches(md, errors) {
  const blocks = sectionBlocks(md);
  const deps = new Map(
    blocks.map(({ id, block }) => [id, field(block, "DEPENDS ON").match(/\b[A-Z][0-9]+\b/g) ?? []]),
  );
  const reaches = (from, to, seen = new Set()) =>
    (deps.get(from) ?? []).some((d) => d === to || (!seen.has(d) && reaches(d, to, seen.add(d))));
  const sets = new Map();
  const batches = new Map();
  for (const { id, block } of blocks) {
    const before = errors.length;
    const entries = writeSet(block, id, errors);
    const malformed = errors.length > before;
    if (entries) sets.set(id, entries);
    if (!/^PARALLEL:/m.test(block)) continue;
    const value = field(block, "PARALLEL").split(/\r?\n/)[0].trim().replace(/`/g, "");
    if (/^(no|none)\b/i.test(value)) continue;
    const label = value.match(/^batch\s+([A-Za-z0-9][\w-]*)/i)?.[1];
    if (!label) {
      errors.push(`${id} PARALLEL must be "no" or "batch <label>"`);
      continue;
    }
    if (!entries?.length && !malformed) {
      errors.push(`${id} is in parallel batch ${label} and needs a WRITE SET listing every path it may write`);
    }
    batches.set(label, [...(batches.get(label) ?? []), id]);
  }
  for (const [label, members] of batches) {
    for (let i = 0; i < members.length; i += 1) {
      for (let j = i + 1; j < members.length; j += 1) {
        const [a, b] = [members[i], members[j]];
        if (reaches(a, b) || reaches(b, a)) {
          errors.push(`parallel batch ${label}: ${a} and ${b} are joined by a DEPENDS ON path; batch members must be independent`);
        }
        const hit = writeSetsOverlap(sets.get(a) ?? [], sets.get(b) ?? []);
        if (hit) {
          errors.push(`parallel batch ${label}: ${a} and ${b} both claim ${hit[0] === hit[1] ? hit[0] : `${hit[0]} / ${hit[1]}`} in WRITE SET`);
        }
      }
    }
  }
  return batches.size;
}

// Uncommitted paths grouped by the section whose WRITE SET owns them, with a digest of each
// section's paths and contents. Lists the named sections, or every unchecked section that
// declares a WRITE SET. The plan file is left out.
export function attributeChanges(md, repoRoot, planPath, ids) {
  const done = new Set(ledgerRows(md).filter((row) => row.done).map((row) => row.id));
  const sets = sectionBlocks(md)
    .filter(({ id }) => (ids ? ids.includes(id) : !done.has(id)))
    .map(({ id, block }) => [id, writeSet(block, id, []) ?? []])
    .filter(([, entries]) => entries.length);
  const top = git(repoRoot, ["rev-parse", "--show-toplevel"]);
  const tokens = git(repoRoot, ["status", "--porcelain=v1", "-z", "-uall"], { trim: false }).split("\0");
  const paths = new Set();
  for (let i = 0; i < tokens.length; i += 1) {
    if (!tokens[i]) continue;
    paths.add(tokens[i].slice(3));
    // A rename or copy entry is followed by its source path.
    if (/[RC]/.test(tokens[i].slice(0, 2))) paths.add(tokens[++i]);
  }
  const bySection = new Map(sets.map(([id]) => [id, []]));
  const outside = [];
  const shared = [];
  for (const path of [...paths].sort()) {
    if (isPlanFile(path, planPath)) continue;
    const owners = sets.filter(([, entries]) => inWriteSet(path, entries)).map(([id]) => id);
    for (const id of owners) bySection.get(id).push(path);
    if (owners.length === 0) outside.push(path);
    if (owners.length > 1) shared.push(`${path} (${owners.join(", ")})`);
  }
  const digests = new Map();
  for (const [id, owned] of bySection) {
    if (!owned.length) continue;
    const hash = createHash("sha256");
    for (const path of owned) {
      hash.update(`${path}\0`);
      try {
        hash.update(readFileSync(join(top, path)));
      } catch {
        hash.update("absent");
      }
      hash.update("\0");
    }
    digests.set(id, hash.digest("hex").slice(0, 12));
  }
  return { bySection, digests, outside, shared };
}

// A WRITE SET entry that names an existing directory without the trailing `/` would match no file.
function checkWriteSetPaths(md, repoRoot, errors) {
  let top;
  try {
    top = git(repoRoot, ["rev-parse", "--show-toplevel"]);
  } catch {
    return;
  }
  for (const { id, block } of sectionBlocks(md)) {
    for (const entry of writeSet(block, id, []) ?? []) {
      if (/[*?]/.test(entry) || entry.endsWith("/")) continue;
      if (statSync(join(top, entry), { throwIfNoEntry: false })?.isDirectory()) {
        errors.push(`${id} WRITE SET entry "${entry}" is a directory; end it with "/"`);
      }
    }
  }
}

function checkAcceptedCommits(md, repoRoot, errors, planPath) {
  const acceptedRows = ledgerRows(md).filter((row) => row.done);
  try {
    git(repoRoot, ["rev-parse", "--show-toplevel"]);
    if (acceptedRows.length) git(repoRoot, ["rev-parse", "--verify", "HEAD^{commit}"]);
  } catch {
    errors.push(`commit verification needs a Git worktree (and committed HEAD for accepted rows): ${repoRoot}`);
    return 0;
  }
  const commits = new Map();
  const owners = new Map();
  for (const row of acceptedRows) {
    const sha = row.text.match(/\baccepted\s+\d{4}-\d{2}-\d{2}\s+`?([a-f0-9]{7,64})`?(?=\s|$|[;,])/i)?.[1];
    if (!sha) {
      errors.push(`${row.id} needs an accepted date and commit SHA for Git verification`);
      continue;
    }
    let commit;
    try {
      commit = git(repoRoot, ["rev-parse", "--verify", "--end-of-options", `${sha}^{commit}`]);
      if (!commit.toLowerCase().startsWith(sha.toLowerCase())) throw new Error("not a commit object ID");
    } catch {
      errors.push(`${row.id} accepted SHA ${sha} does not resolve to a commit`);
      continue;
    }
    try {
      git(repoRoot, ["merge-base", "--is-ancestor", commit, "HEAD"]);
    } catch {
      errors.push(`${row.id} accepted commit ${sha} is not reachable from HEAD`);
      continue;
    }
    if (owners.has(commit)) {
      errors.push(`${row.id} shares its accepted commit with ${owners.get(commit)}; sections need separate commits`);
    }
    owners.set(commit, row.id);
    commits.set(row.id, commit);
  }
  for (const m of md.matchAll(/^## ([A-Z][0-9]+) — (.+)$/gm)) {
    const commit = commits.get(m[1]);
    if (!commit) continue;
    const rest = md.slice(m.index + m[0].length);
    const next = rest.search(/^## /m);
    const block = next === -1 ? rest : rest.slice(0, next);
    for (const dep of new Set(field(block, "DEPENDS ON").match(/\b[A-Z][0-9]+\b/g) ?? [])) {
      if (!commits.has(dep)) {
        errors.push(`${m[1]} is accepted without a verified dependency commit for ${dep}`);
        continue;
      }
      try {
        git(repoRoot, ["merge-base", "--is-ancestor", commits.get(dep), commit]);
      } catch {
        errors.push(`${m[1]} accepted commit does not contain dependency ${dep}`);
      }
    }
  }
  // A section that declares a WRITE SET commits only paths inside it, plus the plan file.
  for (const { id, block } of sectionBlocks(md)) {
    const commit = commits.get(id);
    const entries = commit && writeSet(block, id, []);
    if (!entries?.length) continue;
    const files = git(repoRoot, ["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "-z", commit], { trim: false })
      .split("\0").filter(Boolean);
    for (const file of files) {
      if (!isPlanFile(file, planPath) && !inWriteSet(file, entries)) {
        errors.push(`${id} commit ${commit.slice(0, 9)} changes ${file} outside its WRITE SET; if the path belongs to the section, add it to WRITE SET and record the call`);
      }
    }
  }
  return commits.size;
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
  if (!hasTableHeader(pre, ["Capability", "Probe / expected condition", "Observed evidence", "Classification"])) {
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
  if (!hasTableHeader(pre, ["Condition", "Detection", "Pre-approved handling"])) {
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
  const batches = checkParallelBatches(md, errors);
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
    const signOff = r.text.match(/\breview:\s*sign-off\s*\(([^)\n]*)\)/);
    const signOffReason = signOff?.[1].trim();
    const validSignOff = signOff && !isPlaceholder(signOffReason) &&
      !/^(pending|none|-|n\/a|tbd)$/i.test(signOffReason);
    if (!/\breview:\s*(independent|self\s*\()/.test(r.text) && !validSignOff) {
      errors.push(
        `ledger row ${r.id} must record "review: independent", "review: self (<reason>)", or "review: sign-off (<reason>)" with a concrete reason`,
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

  return { preflight: pstatus, sections: ids.length, batches };
}

// ---------- entry ----------

export function validatePlan(md, { commitBoundaries = false, repoRoot, planPath } = {}) {
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
  if (commitBoundaries) checkCommitBoundaries(md, errors);
  if (repoRoot) {
    extra.commits = checkAcceptedCommits(md, repoRoot, errors, planPath);
    if (schema === "2") checkWriteSetPaths(md, repoRoot, errors);
  }
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

function commitSelfTest() {
  const repo = mkdtempSync(join(tmpdir(), "gdi-commit-check-"));
  try {
    git(repo, ["init", "-q", "-b", "main"]);
    const unborn = validatePlan(S2_FIXTURE, { repoRoot: repo });
    if (unborn.errors.length || unborn.summary.commits !== 0) throw new Error("new worktree rejected before any section was accepted");
    const commitFile = (name) => {
      writeFileSync(join(repo, name), `${name}\n`);
      git(repo, ["add", "--", name]);
      git(repo, ["-c", "user.name=GDI test", "-c", "user.email=gdi@example.test",
        "-c", "commit.gpgsign=false", "-c", `core.hooksPath=${join(repo, "no-hooks")}`,
        "commit", "-qm", name]);
      return git(repo, ["rev-parse", "HEAD"]);
    };
    const first = commitFile("first.txt");
    git(repo, ["checkout", "-qb", "other"]);
    const unreachable = commitFile("other.txt");
    git(repo, ["checkout", "-q", "main"]);
    const second = commitFile("second.txt");
    const record = (id, sha) => `- [x] ${id} slice — accepted 2026-09-22 ${sha} — rounds: 0 — review: independent — routing: test — cost: unknown`;
    const one = (sha) => S2_FIXTURE.replace("- [ ] A1 slice", record("A1", sha));
    const checked = validatePlan(one(first), { repoRoot: repo });
    if (checked.errors.length || checked.summary.commits !== 1) {
      throw new Error(`reachable commit failed: ${checked.errors.join("\n")}`);
    }
    expectError(validatePlan(one("f".repeat(40)), { repoRoot: repo }), "does not resolve", "missing commit");
    expectError(validatePlan(one(unreachable), { repoRoot: repo }), "not reachable", "other branch commit");
    expectError(validatePlan(one("pending"), { repoRoot: repo }), "date and commit SHA", "unrecorded commit");
    const blob = git(repo, ["rev-parse", `${first}:first.txt`]);
    expectError(validatePlan(one(blob), { repoRoot: repo }), "does not resolve", "blob is not a commit");
    git(repo, ["tag", "deadbee", first]);
    expectError(validatePlan(one("deadbee"), { repoRoot: repo }), "does not resolve", "tag is not SHA evidence");

    const pair = (a, b) => `## A1 — first\nDEPENDS ON:\nnone\n## A2 — second\nDEPENDS ON:\nA1\n## 5. Progress ledger\n${record("A1", a)}\n${record("A2", b)}\n## Completion\n`;
    const pairResult = (a, b) => {
      const errors = [];
      checkAcceptedCommits(pair(a, b), repo, errors);
      return { errors };
    };
    if (pairResult(first, second).errors.length) throw new Error("ordered dependency commits rejected");
    expectError(pairResult(second, first), "does not contain dependency", "reversed commit order");
    expectError(pairResult(first, first), "shares its accepted commit", "combined section commit");
    const missingDependency = pair(first, second).replace(record("A1", first), "- [ ] A1 pending");
    const errors = [];
    checkAcceptedCommits(missingDependency, repo, errors);
    expectError({ errors }, "without a verified dependency", "unchecked dependency");

    const planPath = join(repo, "plan with spaces.md");
    writeFileSync(planPath, one(first).replace("TARGET:\nPackage.",
      "MILESTONE:\nStandalone delivery.\nCOMMIT BOUNDARY:\nOne complete behavior; nothing else needed.\nTARGET:\nPackage."));
    const scriptPath = fileURLToPath(import.meta.url);
    const cli = execFileSync(process.execPath, [scriptPath, planPath, "--commit-boundaries", "--repo-root", repo],
      { encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
    if (!cli.includes("commits=1") || !cli.includes("commit-boundaries=checked")) throw new Error("CLI did not run requested checks");
    const renamed = join(repo, "check-plan.mjs");
    symlinkSync(scriptPath, renamed);
    const linked = execFileSync(process.execPath, [renamed, planPath], { encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
    if (!linked.includes("Plan validation passed")) throw new Error("the CLI did not run through a renamed link");
    rmSync(renamed);
    for (const args of [[planPath, "--repo-root"], [planPath, "--unknown"], [planPath, "--commit-boundaries", "--commit-boundaries"], [planPath, "--write-sets"]]) {
      let status;
      try {
        execFileSync(process.execPath, [scriptPath, ...args], { stdio: "pipe" });
      } catch (error) {
        status = error.status;
      }
      if (status !== 2) throw new Error(`invalid CLI arguments did not fail with usage error: ${args.join(" ")}`);
    }

    // Neither accepted-record validation nor its Git calls should change the worktree.
    writeFileSync(join(repo, "user.txt"), "unrelated local work\n");
    const before = git(repo, ["status", "--porcelain=v1", "-uall"]);
    const indexBefore = git(repo, ["write-tree"]);
    const previousDir = process.env.GIT_DIR;
    try {
      process.env.GIT_DIR = join(repo, "missing-git-dir");
      const isolated = validatePlan(one(second), { repoRoot: repo });
      if (isolated.errors.length) throw new Error("inherited GIT_DIR overrode selected repository");
    } finally {
      if (previousDir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = previousDir;
    }
    if (git(repo, ["status", "--porcelain=v1", "-uall"]) !== before ||
        git(repo, ["write-tree"]) !== indexBefore || git(repo, ["rev-parse", "HEAD"]) !== second) {
      throw new Error("commit verification mutated Git state");
    }
    expectError(validatePlan(one(first), { repoRoot: join(repo, "missing") }), "committed HEAD", "invalid repo");

    // An accepted section that declares a WRITE SET commits only paths inside it.
    const scoped = (sha, set) => one(sha).replace("DEPENDS ON:\nnone.\n", `DEPENDS ON:\nnone.\nWRITE SET:\n${set}\n`);
    const inside = validatePlan(scoped(first, "- first.txt"), { repoRoot: repo });
    if (inside.errors.length) throw new Error(`commit inside its WRITE SET rejected: ${inside.errors.join("\n")}`);
    expectError(validatePlan(scoped(first, "- src/**"), { repoRoot: repo }), "outside its WRITE SET", "commit outside WRITE SET");
    const ledgerOnly = validatePlan(scoped(first, "- src/**"), { repoRoot: repo, planPath: join(repo, "first.txt") });
    if (ledgerOnly.errors.length) throw new Error("the plan file must not count against a WRITE SET");

    // Uncommitted paths are listed under the unchecked section whose WRITE SET owns them.
    mkdirSync(join(repo, "src", "a"), { recursive: true });
    writeFileSync(join(repo, "src", "a", "new.ts"), "export {};\n");
    writeFileSync(join(repo, "second.txt"), "edited\n");
    git(repo, ["mv", "first.txt", "moved.txt"]);
    const pending = S2_FIXTURE.replace("DEPENDS ON:\nnone.\n", "DEPENDS ON:\nnone.\nWRITE SET:\n- src/a/\n- moved.txt\n");
    const owned = attributeChanges(pending, repo, planPath);
    if (owned.bySection.get("A1").join() !== "moved.txt,src/a/new.ts" ||
        owned.outside.join() !== "first.txt,second.txt,user.txt" || owned.shared.length ||
        !/^[a-f0-9]{12}$/.test(owned.digests.get("A1"))) {
      throw new Error(`write-set attribution failed: ${JSON.stringify([...owned.bySection], null, 1)} ${owned.outside}`);
    }
    if (attributeChanges(scoped(first, "- src/a/"), repo, planPath).bySection.size ||
        attributeChanges(scoped(first, "- src/a/"), repo, planPath, ["A1"]).bySection.get("A1").join() !== "src/a/new.ts") {
      throw new Error("an accepted section is listed only when it is named");
    }
    writeFileSync(join(repo, "src", "a", "new.ts"), "export const edited = true;\n");
    if (attributeChanges(pending, repo, planPath).digests.get("A1") === owned.digests.get("A1")) {
      throw new Error("the digest must change when a listed path changes");
    }
    expectError(validatePlan(pending.replace("- src/a/\n", "- src/a\n"), { repoRoot: repo }), 'is a directory; end it with "/"', "directory without a trailing slash");
    writeFileSync(planPath, pending);
    const listing = execFileSync(process.execPath, [scriptPath, planPath, "--repo-root", repo, "--write-sets", "A1"],
      { encoding: "utf8", env: gitEnv(), stdio: ["ignore", "pipe", "pipe"] });
    if (!/A1 digest=[a-f0-9]{12}\n  moved\.txt\n  src\/a\/new\.ts\noutside every listed WRITE SET\n  first\.txt/.test(listing)) {
      throw new Error(`--write-sets listing failed:\n${listing}`);
    }
    let unknownStatus;
    try {
      execFileSync(process.execPath, [scriptPath, planPath, "--repo-root", repo, "--write-sets", "Z9"], { stdio: "pipe" });
    } catch (error) {
      unknownStatus = error.status;
    }
    if (unknownStatus !== 2) throw new Error("--write-sets accepted an unknown section ID");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function selfTest() {
  const ok = validatePlan(S2_FIXTURE);
  if (ok.errors.length)
    throw new Error(`schema-2 fixture failed:\n${ok.errors.join("\n")}`);
  const legacy = validatePlan(S1_FIXTURE);
  if (legacy.errors.length)
    throw new Error(`schema-1 fixture failed:\n${legacy.errors.join("\n")}`);

  // Table headers are matched by cell, so a formatter's column padding does not hide a table.
  const padded = validatePlan(
    S2_FIXTURE
      .replace("| Capability | Probe / expected condition | Observed evidence | Classification |",
        "| Capability          | Probe / expected condition | Observed evidence | Classification  |")
      .replace("| Condition | Detection | Pre-approved handling |", "| Condition   | Detection   | Pre-approved handling   |"),
  );
  if (padded.errors.length) throw new Error(`padded table headers were rejected:\n${padded.errors.join("\n")}`);
  expectError(
    validatePlan(S2_FIXTURE.replace("| Capability | Probe / expected condition | Observed evidence | Classification |", "| Capability | Observed evidence |")),
    "missing the capability evidence table", "capability table header");
  expectError(
    validatePlan(S2_FIXTURE.replace("| Condition | Detection | Pre-approved handling |", "| Condition | Handling |")),
    "Known blockers table is missing", "known blockers table header");

  // The ledger record schema is an example inside a code fence, not a ledger row.
  const fencedExample = validatePlan(S2_FIXTURE.replace(
    "## 5. Progress ledger\n",
    "## 5. Progress ledger\n```text\n- [x] A1 <title> — accepted <YYYY-MM-DD> <sha> — rounds: 2 — review: independent\n  - R1 failure-mode: <one line>\n```\n",
  ));
  if (fencedExample.errors.length) throw new Error(`a fenced ledger example was read as a row:\n${fencedExample.errors.join("\n")}`);
  expectError(
    validatePlan(S2_FIXTURE.replace("- [ ] A1 slice\n", "- [ ] A1 slice\n- [ ] A1 slice again\n")),
    "exactly once; found 2", "duplicate ledger row outside a fence");

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

  const signedOff = annotated.replace(
    "review: independent",
    "review: sign-off (review repeated a refuted claim; see Graph Findings)",
  );
  const signOffResult = validatePlan(signedOff);
  if (signOffResult.errors.length)
    throw new Error(`sign-off fixture failed:\n${signOffResult.errors.join("\n")}`);
  const selfReviewed = validatePlan(annotated.replace(
    "review: independent", "review: self (reviewer route unavailable)",
  ));
  if (selfReviewed.errors.length)
    throw new Error(`self-review compatibility failed:\n${selfReviewed.errors.join("\n")}`);
  for (const invalid of [
    "sign-off", "sign-off ()", "sign-off (   )", "sign-off (<reason>)",
    "sign-off (pending)", "sign-off (none)", "waived",
  ]) {
    expectError(validatePlan(annotated.replace("review: independent", `review: ${invalid}`)),
      'must record "review:', `invalid review record: ${invalid}`);
  }
  expectError(validatePlan(signedOff.replace(
    "  - R1 doc-truth: README over-claimed the retry behavior", "",
  )), "declares rounds: 1 but has 0", "sign-off preserves round history");

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
  expectError(validatePlan(S2_FIXTURE, { commitBoundaries: true }), "MILESTONE", "missing boundary fields");
  const bounded = S2_FIXTURE.replace("TARGET:\nPackage.",
    "MILESTONE:\nMessaging admission PR.\nCOMMIT BOUNDARY:\nOne supported sender is fenced; other effect families remain.\nTARGET:\nPackage.");
  const boundedResult = validatePlan(bounded, { commitBoundaries: true });
  if (boundedResult.errors.length) throw new Error(`commit boundary rejected: ${boundedResult.errors.join("\n")}`);
  expectError(validatePlan(bounded.replace("One supported sender is fenced; other effect families remain.", "<explain>"),
    { commitBoundaries: true }), "COMMIT BOUNDARY", "placeholder boundary");
  expectError(validatePlan(bounded.replace("One supported sender is fenced; other effect families remain.",
    "<Why this behavior or usable internal capability is coherent without the next section; what\n" +
    "remains for the milestone. Reference the checks below. If several mechanisms must change\n" +
    "together, explain the invariant that makes them atomic.>"),
    { commitBoundaries: true }), "COMMIT BOUNDARY", "multiline template boundary");
  expectError(validatePlan(bounded.replace("Messaging admission PR.", ""),
    { commitBoundaries: true }), "MILESTONE", "empty milestone");

  // Parallel batches: members are independent and their WRITE SETs are declared and disjoint.
  const a1Block = between(S2_FIXTURE, /^## A1 — slice$/m, /^## 4\. /m);
  const member = (deps, parallel, set) => a1Block.replace("DEPENDS ON:\nnone.\n",
    `DEPENDS ON:\n${deps}\n${parallel ? `PARALLEL:\n${parallel}\n` : ""}${set ? `WRITE SET:\n${set}\n` : ""}`);
  const batch = ({ a1 = "- src/a/**\n- `docs/a notes.md` — owning doc", a2 = "- src/b/\n- docs/b.md", a2Deps = "none.", a2Parallel = "batch 1" } = {}) =>
    S2_FIXTURE
      .replace(a1Block, `${member("none.", "batch 1", a1)}## A2 — second${member(a2Deps, a2Parallel, a2)}`)
      .replace('--> G1{"Goal 1"}', '--> G1{"Goal 1"}\n  IN1 --> A2["A2 — second"] --> G1')
      .replace("- [ ] A1 slice", "- [ ] A1 slice — batch 1: implementing\n- [ ] A2 second");
  const batched = validatePlan(batch());
  if (batched.errors.length || batched.summary.batches !== 1) {
    throw new Error(`parallel batch fixture failed:\n${batched.errors.join("\n")}`);
  }
  expectError(validatePlan(batch({ a2Deps: "none (soft: A1 wording)." })), "joined by a DEPENDS ON path", "dependent batch members");
  expectError(validatePlan(batch({ a2: "- src/a/x.ts" })), "both claim src/a/** / src/a/x.ts", "file inside a sibling glob");
  expectError(validatePlan(batch({ a1: "- packages/x/README.md", a2: "- packages/x/" })), "both claim", "file inside a sibling directory");
  expectError(validatePlan(batch({ a2: "" })), "needs a WRITE SET", "batch member without WRITE SET");
  expectError(validatePlan(batch({ a2: "<Every path this section may write.>" })), "needs a WRITE SET", "placeholder WRITE SET");
  expectError(validatePlan(batch({ a2Parallel: "yes" })), 'PARALLEL must be "no" or "batch <label>"', "malformed PARALLEL");
  expectError(validatePlan(batch({ a2: "- /abs/path.ts" })), "must be repository-relative", "absolute WRITE SET path");
  for (const [set, needle] of [
    ["- everything under billing", "one path per line"], ["- src/b/**, tests/shared/**", "one path per line"],
    ["- `src/b/x.ts`, `src/shared.ts`", "one path per line"], ["- src/shared.ts,", "unsupported punctuation"],
    ["- src/{b,shared}/**", "unsupported punctuation"], ["- src/**.ts", 'as a whole path segment'],
    ["- src/b/**\nTESTS:\n- tests/b/**", 'cut short by the label "TESTS:"'],
  ]) {
    expectError(validatePlan(batch({ a2: set })), needle, `WRITE SET line: ${set}`);
  }
  const tolerated = validatePlan(batch({ a2: "1. src/b/**\n2) ./Makefile\n* `docs/b notes.md` (owning doc)\n- LICENSE - text" }));
  if (tolerated.errors.length) throw new Error(`valid WRITE SET lines were rejected:\n${tolerated.errors.join("\n")}`);
  for (const serial of [batch({ a2: "- src/a/x.ts", a2Parallel: "no — applies a migration" }), batch({ a2: "- src/a/x.ts", a2Parallel: "batch 2" }),
    batch({ a2: "- src/a/x.ts", a2Parallel: "", a2Deps: "A1." }), batch({ a2: "none", a2Parallel: "no" })]) {
    const result = validatePlan(serial);
    if (result.errors.length) throw new Error(`sections outside one batch were rejected:\n${result.errors.join("\n")}`);
  }
  const chained = [];
  checkParallelBatches("## A1 — a\nDEPENDS ON:\nnone\nPARALLEL:\nbatch 1\nWRITE SET:\n- a/\n## A2 — b\nDEPENDS ON:\nA1\n" +
    "## A3 — c\nDEPENDS ON:\nA2\nPARALLEL:\nbatch 1\nWRITE SET:\n- c/\n", chained);
  expectError({ errors: chained }, "A1 and A3 are joined by a DEPENDS ON path", "transitive dependency inside a batch");
  for (const [a, b, expected] of [
    ["src/a.ts", "src/a.ts", true], ["src/a.ts", "src/b.ts", false], ["src/api/", "src/api/handler.ts", true],
    ["src/api", "src/api/handler.ts", false], ["src/api/", "src/apix/handler.ts", false],
    ["src/**/*.test.ts", "src/api/handler.ts", false], ["src/**/*.test.ts", "src/api/handler.test.ts", true],
    ["src/**/*.test.ts", "src/api/", true], ["src/**/*.ts", "src/**/*.md", false], ["src/**/*.ts", "src/**/*.test.ts", true],
    ["src/a/**", "docs/**", false], ["**/README.md", "packages/x/README.md", true], ["src/a?.ts", "src/ab.ts", true],
    ["src/*.ts", "src/x/y.ts", false], ["src/*", "src/api/handler.ts", false], ["packages/*/README.md", "packages/x/", true],
    ["packages/*/README.md", "packages/x/src/a.ts", false], ["src/**", "src/a.ts", true], ["**/*.ts", "docs/a.md", false],
    [".github/", "**/*.yml", true], ["packages/next.js/", "packages/**/*.test.ts", true], ["packages/*-api/**", "packages/**/*.test.ts", true],
    ["**/__tests__/*.ts", "src/b/index.ts", false], ["apps/web/**/*.tsx", "apps/web/Dockerfile", false],
    ["apps/web/**/*.tsx", "apps/api/**/*.ts", false], ["src/*/index.ts", "src/*/main.ts", false], ["src/*/a.ts", "src/x/*.ts", true],
  ]) {
    if (entriesOverlap(a, b) !== expected || entriesOverlap(b, a) !== expected) {
      throw new Error(`WRITE SET overlap(${a}, ${b}) should be ${expected}`);
    }
  }
  commitSelfTest();
  console.log("validate-plan self-test passed (schemas, parallel batches, commit boundaries, real Git commits)");
}

export { between, field, ledgerRows, parseFrontmatter, parseTable, sectionBlocks, withoutFences, writeSet };

function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") {
    selfTest();
    process.exit(0);
  }
  const usage = "Usage: node validate-plan.mjs <plan.md> [--commit-boundaries] [--repo-root <repo> [--write-sets [A1,A2]]] | --self-test";
  let planPath;
  const options = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--commit-boundaries" && !options.commitBoundaries) {
      options.commitBoundaries = true;
    } else if (args[i] === "--repo-root" && !options.repoRoot && args[i + 1] && !args[i + 1].startsWith("-")) {
      options.repoRoot = resolve(args[++i]);
    } else if (args[i] === "--write-sets" && !options.writeSets) {
      options.writeSets = true;
      if (/^[A-Z][0-9]+(,[A-Z][0-9]+)*$/.test(args[i + 1] ?? "")) options.writeSetIds = args[++i].split(",");
    } else if (!args[i].startsWith("-") && !planPath) {
      planPath = resolve(args[i]);
    } else {
      console.error(usage);
      process.exit(2);
    }
  }
  if (!planPath || (options.writeSets && !options.repoRoot)) {
    console.error(usage);
    process.exit(2);
  }
  options.planPath = planPath;
  let markdown;
  try {
    markdown = readFileSync(planPath, "utf8");
  } catch (error) {
    console.error(`Could not read ${planPath}: ${error.message}`);
    process.exit(2);
  }
  const result = validatePlan(markdown, options);
  if (result.errors.length) {
    console.error(`Plan validation failed: ${basename(planPath)}`);
    for (const e of result.errors) console.error(`- ${e}`);
    process.exit(1);
  }
  const s = result.summary;
  console.log(
    `Plan validation passed: ${basename(planPath)} (schema=${s.schema}${s.version ? `, gdi_version=${s.version}` : ""}, status=${s.status}, preflight=${s.preflight}, sections=${s.sections}${s.batches ? `, parallel-batches=${s.batches}` : ""}${options.commitBoundaries ? ", commit-boundaries=checked" : ""}${options.repoRoot ? `, commits=${s.commits}` : ""})`,
  );
  if (options.writeSets) {
    const { bySection, digests, outside, shared } = attributeChanges(markdown, options.repoRoot, planPath, options.writeSetIds);
    const missing = (options.writeSetIds ?? []).filter((id) => !bySection.has(id));
    if (missing.length) {
      console.error(`--write-sets: no section with a WRITE SET named ${missing.join(", ")}`);
      process.exit(2);
    }
    const list = (paths) => (paths.length ? paths : ["(none)"]).map((path) => `  ${path}`).join("\n");
    console.log("Uncommitted paths by WRITE SET (the plan file is left out):");
    for (const [id, paths] of bySection) console.log(`${id}${digests.has(id) ? ` digest=${digests.get(id)}` : ""}\n${list(paths)}`);
    console.log(`outside every listed WRITE SET\n${list(outside)}`);
    if (shared.length) console.log(`in more than one listed WRITE SET\n${list(shared)}`);
  }
}

// Run the CLI when this file is the entry script, under any name or through a link; a script that
// imports the parsers gets the exports only.
const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && [entry, realpathSync(entry)].includes(fileURLToPath(import.meta.url))) main();
