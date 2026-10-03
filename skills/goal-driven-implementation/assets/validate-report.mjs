#!/usr/bin/env node
// Structurally validate an agent's return before the orchestrator acts on it: required labels
// present, verdict well-formed, every file:line anchor resolves to a real file and a line that
// exists. Pattern taken from the aiq-lite code-research subagent validator.
//
//   node validate-report.mjs --kind <mapper|reviewer|final|implementer|correction|anchors>
//                            [--input <file>] [--repo-root <dir>] [--fix] [--json]
//   <agent output> | node validate-report.mjs --kind reviewer --repo-root .
//   node validate-report.mjs --self-test
//
// Exit 0 = valid (warnings allowed), 1 = hard errors, 2 = usage or IO error.
// --fix rewrites the --input file so every short anchor that resolves to one file carries its
// repository-relative path. It changes nothing else.
//
// Kinds (report formats are the ones in assets/prompts/*.md):
//   mapper       SYMBOLS PATTERN TESTS WRITERS COUPLINGS LIFECYCLE SIBLINGS UNCERTAINTIES
//                labels present; SYMBOLS carries at least one anchor. Warns "thin" under three
//                anchors and "soft" when UNCERTAINTIES bullets outnumber anchors.
//   reviewer     VERDICT: APPROVE|REJECT; EVIDENCE with at least 2 anchors; FINDINGS none or one
//                anchored item each carrying a `trigger:` segment and an evidence tag
//                (test|code|partial|config|inference).
//                REJECT with FINDINGS: none is an error. All-inference findings are a warning the
//                orchestrator verifies before relaying.
//   final        as reviewer with VERDICT: CLEAN|FINDINGS.
//   implementer  STATUS: complete|blocked|decision-needed; report labels present; every CLAIMS
//                item anchored; RETIRES non-empty and a `none` entry is explained; GATE EVIDENCE
//                non-empty; decision-needed carries a DECISION BRIEF.
//   correction   correction report labels present; STATUS vocabulary and CLAIMS anchors checked;
//                RETIRES non-empty and a `none` entry is explained; GATE EVIDENCE non-empty;
//                decision-needed carries a substantive separate or compact decision brief.
//   anchors      only the anchor check, for any text (a plan file, a brief, a finding list).
//
// An anchor is `path/with.ext:N` or `path/with.ext:N-M`, optionally in backticks. Absolute paths
// are errors; with --repo-root the file must exist and N (and M) must not exceed its line count.
// A short anchor (`hooks.ts:14`, `billing/hooks.ts:14`) resolves when exactly one existing
// repository file ends with that path at a directory boundary and the cited line exists in it.
// Each resolution is printed as a NOTE so the author can see which file was taken. A short anchor
// that matches several files, or none, is an error. A host with a port (`127.0.0.1:5432`,
// `api.example.com:443`) is not an anchor.
//
// A label is a line that starts with the label and a colon. A known label is also accepted as a
// Markdown heading or bold line, with or without the colon, and with a parenthetical before the
// colon (`GATE EVIDENCE (tested state: ...):`). A FINDINGS or CLAIMS item is one
// bullet with its wrapped and nested lines; without bullets, each unindented line is an item.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ANCHOR_RE =
  /(?<![\w.])`?((?:[A-Za-z]:)?[\\/]?(?:[\w.@+-]+[\\/])*[\w.@+-]+\.(?=\d*[A-Za-z])[A-Za-z0-9]{1,12}):(\d+)(?:-(\d+))?`?(?![\w:])/g;
// A bare host name with a port, when no file of that name exists.
const HOST_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|dev|app|ai|co|cloud|local|internal|test|example|invalid)$/i;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const EVIDENCE_TAG_RE = /\bevidence:(?:\*\*|__)?\s*[`*_]*(test|code|partial|config|inference)\b/i;
const TRIGGER_RE = /\btrigger:\s*\S/i;
const LABEL_RE = /^([A-Z][A-Z0-9 /_-]{1,40}?)(?:\*\*|__)?:(?:\*\*|__)?[ \t]*(.*)$/;
const LABEL_NOTE_RE = /^([A-Z][A-Z0-9 /_-]{1,40}?)\s*(\([^)]*\))(?:\*\*|__)?:(?:\*\*|__)?[ \t]*(.*)$/;

const MAPPER_LABELS = ["SYMBOLS", "PATTERN", "TESTS", "WRITERS", "COUPLINGS", "LIFECYCLE", "SIBLINGS", "UNCERTAINTIES"];
const IMPLEMENTER_LABELS = [
  "STATUS", "ANCHOR DELTA", "DIFF", "RETIRES", "CLAIMS", "CALLS", "GATE EVIDENCE", "TESTS RUN",
  "ACCEPTANCE", "SIBLINGS", "DEFERRALS", "RISKS",
];
const CORRECTION_LABELS = [
  "STATUS", "DIFF", "RETIRES", "FINDINGS RESOLVED", "CLAIMS", "GATE EVIDENCE", "TESTS RUN",
  "EXIT TESTS",
];
const REVIEW_LABELS = ["VERDICT", "EVIDENCE", "FINDINGS"];
// Labels accepted without a colon when the line holds nothing else (`## SYMBOLS`, `**NOTES**`).
const KNOWN_LABELS = new Set([
  ...MAPPER_LABELS, ...IMPLEMENTER_LABELS, ...CORRECTION_LABELS, ...REVIEW_LABELS,
  "NOTES", "LIVE FLOW", "ENV", "LIFECYCLE EFFECTS", "DECISION BRIEF",
  "DEFERRALS / RISKS / DECISION BRIEF", "ROUTING",
]);
// Directories never searched when a short anchor is resolved outside a Git worktree.
const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "out", "target", "vendor", ".next", ".venv", "__pycache__"]);

// ---------- parsing ----------

function labelOf(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("-")) return null;
  const unheaded = trimmed.replace(/^#{1,6}\s+/, "");
  // `**VERDICT: APPROVE**` is bold as a whole; `**TESTS:** none` closes the bold after the label.
  const wholeBold = /^(\*\*|__)(?:(?!\1).)+\1$/.test(unheaded);
  const line = (wholeBold ? unheaded.slice(0, -2) : unheaded).replace(/^(?:\*\*|__)/, "");
  const m = LABEL_RE.exec(line);
  if (m) return { label: m[1].trim(), rest: m[2].replace(/^(?:\*\*|__)\s*/, "") };
  // `GATE EVIDENCE (tested state: HEAD plus this diff):` keeps the parenthetical as content.
  const noted = LABEL_NOTE_RE.exec(line);
  if (noted && KNOWN_LABELS.has(noted[1].trim())) return { label: noted[1].trim(), rest: `${noted[2]} ${noted[3]}`.trim() };
  const bare = line.replace(/(?:\*\*|__)$/, "").trim();
  return KNOWN_LABELS.has(bare) ? { label: bare, rest: "" } : null;
}

function sections(text) {
  const out = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const m = labelOf(raw);
    if (m) {
      current = m.label;
      out.set(current, out.has(current) ? `${out.get(current)}\n${m.rest}` : m.rest);
      continue;
    }
    if (current !== null) out.set(current, `${out.get(current)}\n${raw}`);
  }
  return out;
}

// URLs are blanked at the same length so every match index is an index into `text`.
function anchorsIn(text) {
  const found = [];
  for (const m of text.replace(URL_RE, (u) => " ".repeat(u.length)).matchAll(ANCHOR_RE)) {
    found.push({
      path: m[1], lo: Number(m[2]), hi: m[3] ? Number(m[3]) : null, raw: m[0],
      index: m.index + m[0].indexOf(m[1]),
    });
  }
  return found;
}

const BULLET_RE = /^(\s*)(?:[-*\u2022]|\d+[.)])\s+(.*)$/;

// One entry per item: a bullet with its wrapped and nested lines. A body without bullets has one
// item per unindented line.
function items(body) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim() && l.trim() !== "none");
  const bulleted = lines.some((l) => BULLET_RE.test(l));
  const out = [];
  let base = null;
  for (const line of lines) {
    const b = BULLET_RE.exec(line);
    if (b && (base === null || b[1].length <= base)) {
      base ??= b[1].length;
      out.push(b[2].trim());
    } else if (out.length && (bulleted || /^\s/.test(line))) {
      out[out.length - 1] += ` ${line.trim()}`;
    } else {
      out.push(line.trim());
    }
  }
  return out;
}

const bullets = (body) =>
  body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== "none");
const isNone = (body) => /^\s*none\b/i.test(body.trim());
const hasNoneExplanation = (body) => {
  const suffix = body.trim().replace(/^none\b/i, "").trim();
  const content = suffix.replace(/^[\s—–:;,.!?-]+/, "").trim();
  return Boolean(content) && !/^(justified|justification|reason|rationale)[\s—–:;,.!?-]*$/i.test(content);
};

// ---------- checks ----------

// Every file under the repo root, repository-relative with forward slashes. Git lists tracked and
// untracked files and honors ignore rules; outside a worktree the tree is walked instead.
function repoFiles(repoRoot) {
  try {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
    return execFileSync("git", ["--no-optional-locks", "-C", repoRoot, "ls-files", "-co", "--exclude-standard", "-z"], {
      encoding: "utf8", env, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024,
    }).split("\0").filter(Boolean);
  } catch {
    const out = [];
    const walk = (dir, rel) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (out.length >= 200_000) return;
        if (e.isDirectory()) {
          if (!SKIP_DIRS.has(e.name)) walk(join(dir, e.name), rel ? `${rel}/${e.name}` : e.name);
        } else if (e.isFile()) out.push(rel ? `${rel}/${e.name}` : e.name);
      }
    };
    walk(repoRoot, "");
    return out;
  }
}

// Checks every anchor and returns the short anchors that resolved, as { anchor, full }.
function checkAnchors(anchors, repoRoot, errors) {
  const lineCounts = new Map();
  const resolved = [];
  let files = null;
  const isFile = (rel) => statSync(join(repoRoot, rel), { throwIfNoEntry: false })?.isFile() ?? false;
  const lineCount = (rel) => {
    if (!lineCounts.has(rel)) {
      const content = readFileSync(join(repoRoot, rel), "utf8");
      lineCounts.set(rel, content.length === 0 ? 0 : content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0));
    }
    return lineCounts.get(rel);
  };
  for (const a of anchors) {
    if (isAbsolute(a.path) || /^[A-Za-z]:[\\/]/.test(a.path) || /^[\\/]/.test(a.path)) {
      errors.push(`anchor is absolute, not repo-relative: ${a.raw}`);
      continue;
    }
    if (a.hi !== null && a.hi < a.lo) errors.push(`anchor has an inverted range: ${a.raw}`);
    if (!repoRoot) continue;
    let rel = a.path;
    const short = !isFile(rel);
    if (short) {
      const want = a.path.replace(/\\/g, "/").replace(/^\.\//, "");
      files ??= repoFiles(repoRoot);
      // Git also lists a file that was deleted and not staged; only an existing file can match.
      const matches = files.filter((f) => (f === want || f.endsWith(`/${want}`)) && isFile(f));
      if (matches.length === 0) {
        if (!want.includes("/") && HOST_RE.test(want)) continue;
        errors.push(`anchor file not found under repo root: ${a.raw}`);
        continue;
      }
      if (matches.length > 1) {
        const shown = matches.slice(0, 4).join(", ");
        errors.push(`short anchor matches ${matches.length} files (${shown}${matches.length > 4 ? ", …" : ""}); write the repository-relative path: ${a.raw}`);
        continue;
      }
      rel = matches[0];
    }
    const n = lineCount(rel);
    const top = a.hi ?? a.lo;
    if (top > n) {
      errors.push(`anchor line ${top} is past the end of ${rel} (${n} lines)${short ? "; if that is not the file you meant, write the repository-relative path" : ""}: ${a.raw}`);
    } else if (short) {
      resolved.push({ anchor: a, full: rel });
    }
  }
  return resolved;
}

// The text with every resolved short anchor replaced by its repository-relative path.
function expandAnchors(text, resolved) {
  let out = text;
  for (const { anchor, full } of [...resolved].sort((x, y) => y.anchor.index - x.anchor.index)) {
    out = `${out.slice(0, anchor.index)}${full}${out.slice(anchor.index + anchor.path.length)}`;
  }
  return out;
}

function requireLabels(sec, labels, errors) {
  for (const l of labels) if (!sec.has(l)) errors.push(`missing label: ${l}:`);
}

function checkMapper(text, sec, errors, warnings) {
  requireLabels(sec, MAPPER_LABELS, errors);
  const symbolAnchors = anchorsIn(sec.get("SYMBOLS") ?? "");
  if (sec.has("SYMBOLS") && symbolAnchors.length === 0)
    errors.push("SYMBOLS carries no file:line anchor");
  const all = anchorsIn(text);
  if (all.length < 3) warnings.push(`thin: ${all.length} anchors in the whole return (expect several per area)`);
  const unc = bullets(sec.get("UNCERTAINTIES") ?? "").length;
  if (unc > 0 && unc >= all.length)
    warnings.push(`soft: ${unc} uncertainty bullets against ${all.length} anchors — consider one targeted follow-up`);
}

function checkReview(sec, errors, warnings, { verdicts, minEvidence, rejecting }) {
  requireLabels(sec, REVIEW_LABELS, errors);
  const verdict = (sec.get("VERDICT") ?? "").trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (sec.has("VERDICT") && !verdicts.includes(verdict))
    errors.push(`VERDICT must be one of ${verdicts.join("|")}, got ${JSON.stringify(verdict)}`);
  const ev = anchorsIn(sec.get("EVIDENCE") ?? "");
  if (sec.has("EVIDENCE") && ev.length === 0) errors.push("EVIDENCE carries no file:line anchor");
  else if (ev.length && ev.length < minEvidence)
    warnings.push(`EVIDENCE has ${ev.length} anchor (template asks at least ${minEvidence})`);
  const findingsBody = sec.get("FINDINGS") ?? "";
  const findings = isNone(findingsBody) ? [] : items(findingsBody);
  if (verdict === rejecting && findings.length === 0)
    errors.push(`VERDICT: ${rejecting} with no findings — a rejection must name at least one anchored finding`);
  if (verdict !== rejecting && verdict && findings.length)
    warnings.push(`VERDICT: ${verdict} but FINDINGS lists ${findings.length} item(s); non-blocking items belong under NOTES`);
  let inference = 0;
  for (const f of findings) {
    if (anchorsIn(f).length === 0) errors.push(`finding without a file:line anchor: ${short(f)}`);
    const tag = EVIDENCE_TAG_RE.exec(f);
    if (!tag) errors.push(`finding without an evidence tag (evidence: test|code|partial|config|inference): ${short(f)}`);
    else if (tag[1].toLowerCase() === "inference") inference += 1;
    if (!TRIGGER_RE.test(f)) errors.push(`finding without a trigger (trigger: <how it is reached> or trigger: static — <rule>): ${short(f)}`);
  }
  if (findings.length && inference === findings.length)
    warnings.push("every finding is evidence: inference — verify against the code before relaying to the implementer");
}

function checkImplementer(sec, errors, warnings) {
  requireLabels(sec, IMPLEMENTER_LABELS, errors);
  const status = (sec.get("STATUS") ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (sec.has("STATUS") && !["complete", "blocked", "decision-needed"].includes(status))
    errors.push(`STATUS must be complete|blocked|decision-needed, got ${JSON.stringify(status)}`);
  checkRetires(sec, errors);
  checkClaims(sec, errors);
  if (sec.has("GATE EVIDENCE") && !(sec.get("GATE EVIDENCE") ?? "").trim())
    errors.push("GATE EVIDENCE is empty");
  if (status === "complete" && /\b(not run|unrun|did not run|skipped)\b/i.test(sec.get("TESTS RUN") ?? ""))
    warnings.push("STATUS: complete but TESTS RUN mentions an unrun or skipped check");
  if (status === "decision-needed" && !sec.has("DECISION BRIEF"))
    errors.push("STATUS: decision-needed without a DECISION BRIEF");
}

function checkRetires(sec, errors) {
  if (!sec.has("RETIRES")) return;
  const retirees = sec.get("RETIRES") ?? "";
  if (!retirees.trim()) errors.push("RETIRES is empty");
  else if (isNone(retirees) && !hasNoneExplanation(retirees))
    errors.push("RETIRES: none requires a concrete explanation, such as additive work with no obsolete artifact or retained compatibility");
}

function checkClaims(sec, errors) {
  const claimsBody = sec.get("CLAIMS") ?? "";
  if (sec.has("CLAIMS") && !isNone(claimsBody)) {
    for (const c of items(claimsBody))
      if (anchorsIn(c).length === 0) errors.push(`CLAIMS line without an anchor: ${short(c)}`);
  }
}

function hasDecisionText(body) {
  const text = body.trim();
  return Boolean(text) && !isNone(text) && /[A-Za-z0-9]/.test(text);
}

function hasCorrectionDecisionBrief(sec) {
  if (hasDecisionText(sec.get("DECISION BRIEF") ?? "")) return true;
  const compact = sec.get("DEFERRALS / RISKS / DECISION BRIEF") ?? "";
  return hasDecisionText(compact) && !/^(?:DEFERRALS?|RISKS?)\s*:/i.test(compact.trim());
}

function checkCorrection(sec, errors, warnings) {
  requireLabels(sec, CORRECTION_LABELS, errors);
  const status = (sec.get("STATUS") ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (sec.has("STATUS") && !["complete", "blocked", "decision-needed"].includes(status))
    errors.push(`STATUS must be complete|blocked|decision-needed, got ${JSON.stringify(status)}`);
  checkRetires(sec, errors);
  checkClaims(sec, errors);
  if (sec.has("GATE EVIDENCE") && !(sec.get("GATE EVIDENCE") ?? "").trim())
    errors.push("GATE EVIDENCE is empty");
  if (status === "complete" && /\b(not run|unrun|did not run|skipped)\b/i.test(sec.get("TESTS RUN") ?? ""))
    warnings.push("STATUS: complete but TESTS RUN mentions an unrun or skipped check");
  if (status === "decision-needed" && !hasCorrectionDecisionBrief(sec))
    errors.push("STATUS: decision-needed without a substantive correction DECISION BRIEF");
}

const short = (s, n = 90) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function validate(text, kind, repoRoot) {
  const errors = [];
  const warnings = [];
  const sec = sections(text);
  switch (kind) {
    case "mapper":
      checkMapper(text, sec, errors, warnings);
      break;
    case "reviewer":
      checkReview(sec, errors, warnings, { verdicts: ["APPROVE", "REJECT"], minEvidence: 2, rejecting: "REJECT" });
      break;
    case "final":
      checkReview(sec, errors, warnings, { verdicts: ["CLEAN", "FINDINGS"], minEvidence: 2, rejecting: "FINDINGS" });
      break;
    case "implementer":
      checkImplementer(sec, errors, warnings);
      break;
    case "correction":
      checkCorrection(sec, errors, warnings);
      break;
    case "anchors":
      break;
    default:
      throw new Error(`unknown kind: ${kind}`);
  }
  const anchors = anchorsIn(text);
  const resolved = checkAnchors(anchors, repoRoot, errors);
  return {
    ok: errors.length === 0,
    kind,
    errors,
    warnings,
    stats: { anchors: anchors.length, short: resolved.length, labels: [...sec.keys()] },
    resolutions: [...new Map(resolved.map((r) => [`${r.anchor.path}\0${r.full}`, { short: r.anchor.path, full: r.full }])).values()],
    fixed: resolved.length ? expandAnchors(text, resolved) : text,
  };
}

// ---------- self-test ----------

function selfTest() {
  const dir = mkdtempSync(join(tmpdir(), "gdi-report-"));
  const assert = (cond, msg) => {
    if (!cond) throw new Error(`self-test: ${msg}`);
  };
  try {
    writeFileSync(join(dir, "a.ts"), "l1\nl2\nl3\nl4\nl5\n");
    writeFileSync(join(dir, "b.md"), "one\ntwo\n");

    const anchorsOnly = validate("see `a.ts:2-4`, b.md:2, missing.ts:1, a.ts:9, https://x.io/y.ts:3 and /abs/a.ts:1", "anchors", dir);
    assert(anchorsOnly.stats.anchors === 5, `anchors counted=${anchorsOnly.stats.anchors}, want 5 (URL skipped)`);
    assert(anchorsOnly.errors.some((e) => e.includes("missing.ts:1")), "missing file reported");
    assert(anchorsOnly.errors.some((e) => e.includes("past the end")), "line past EOF reported");
    assert(anchorsOnly.errors.some((e) => e.includes("absolute")), "absolute path reported");
    assert(anchorsOnly.errors.length === 3, `anchor errors=${anchorsOnly.errors.length}, want 3`);

    const mapperGood = validate(
      ["SYMBOLS: foo at a.ts:1; bar at a.ts:3", "PATTERN: copy b.md:1", "TESTS: none yet",
       "WRITERS: a.ts:5", "COUPLINGS: none", "LIFECYCLE: none", "SIBLINGS: none", "UNCERTAINTIES: none"].join("\n"),
      "mapper", dir);
    assert(mapperGood.ok, `mapper good failed: ${mapperGood.errors}`);
    const mapperBad = validate("SYMBOLS: something somewhere\nPATTERN: x", "mapper", dir);
    assert(!mapperBad.ok && mapperBad.errors.some((e) => e.includes("missing label: TESTS:")), "mapper missing labels");
    assert(mapperBad.errors.some((e) => e.includes("SYMBOLS carries no")), "mapper unanchored SYMBOLS");
    assert(mapperBad.warnings.some((w) => w.startsWith("thin")), "mapper thin warning");

    const reviewerGood = validate(
      "VERDICT: REJECT\nEVIDENCE: a.ts:1 — checked; a.ts:2 — checked\nFINDINGS:\n- a.ts:3 — off by one — trigger: any list with one item — wrong count — fix loop bound — evidence: code\nNOTES: none",
      "reviewer", dir);
    assert(reviewerGood.ok, `reviewer good failed: ${reviewerGood.errors}`);
    const reviewerBad = validate("VERDICT: REJECT\nEVIDENCE: a.ts:1\nFINDINGS: none", "reviewer", dir);
    assert(reviewerBad.errors.some((e) => e.includes("REJECT with no findings")), "reject without findings");
    assert(reviewerBad.warnings.some((w) => w.includes("EVIDENCE has 1")), "evidence count warning");
    const reviewerManyAnchors = validate(
      "VERDICT: APPROVE\nEVIDENCE: a.ts:1, a.ts:2, a.ts:3, a.ts:4, a.ts:5, b.md:1, b.md:2\nFINDINGS: none", "reviewer", dir);
    assert(reviewerManyAnchors.ok && reviewerManyAnchors.warnings.length === 0, "evidence has no upper bound");
    const reviewerUntagged = validate(
      "VERDICT: REJECT\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS:\n- a.ts:3 — issue — impact — fix", "reviewer", dir);
    assert(reviewerUntagged.errors.some((e) => e.includes("evidence tag")), "finding without evidence tag");
    const reviewerInference = validate(
      "VERDICT: REJECT\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS:\n- a.ts:3 — issue — trigger: static — rule — impact — fix — evidence: inference", "reviewer", dir);
    assert(reviewerInference.ok && reviewerInference.warnings.some((w) => w.includes("inference")), "all-inference warning");
    const reviewerNoTrigger = validate(
      "VERDICT: REJECT\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS:\n- a.ts:3 — issue — impact — fix — evidence: code", "reviewer", dir);
    assert(reviewerNoTrigger.errors.some((e) => e.includes("without a trigger")), "finding without trigger");
    const finalNoTrigger = validate(
      "VERDICT: FINDINGS\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS:\n- a.ts:3 — seam — impact — fix — evidence: code", "final", dir);
    assert(finalNoTrigger.errors.some((e) => e.includes("without a trigger")), "final finding without trigger");
    const finalGood = validate("VERDICT: CLEAN\nEVIDENCE: a.ts:1, a.ts:2, b.md:1\nFINDINGS: none\nNOTES: -", "final", dir);
    assert(finalGood.ok, `final good failed: ${finalGood.errors}`);
    const finalBadVerdict = validate("VERDICT: APPROVE\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS: none", "final", dir);
    assert(finalBadVerdict.errors.some((e) => e.includes("VERDICT must be one of CLEAN|FINDINGS")), "final verdict vocabulary");

    const implementerReport = (retires) => [
      "STATUS: complete", "ANCHOR DELTA: none", "DIFF: a.ts — fix", `RETIRES: ${retires}`,
      "CLAIMS: README says X → b.md:1", "CALLS: none", "GATE EVIDENCE: npm test → 3 passed",
      "TESTS RUN: unit; sensitivity check red output pasted", "LIVE FLOW: n/a", "ENV: none",
      "LIFECYCLE EFFECTS: none", "ACCEPTANCE: Goal 1 clause 2", "SIBLINGS: none",
      "DEFERRALS: none", "RISKS: none",
    ].join("\n");
    const implGood = validate(implementerReport("legacy-flag removed from a.ts"), "implementer", dir);
    assert(implGood.ok, `implementer good failed: ${implGood.errors}`);
    const implRetention = validate(
      implementerReport("none — retained compatibility facade still serves legacy callers"),
      "implementer", dir,
    );
    assert(implRetention.ok, `implementer justified retention failed: ${implRetention.errors}`);
    const implAdditive = validate(
      implementerReport("none — additive work leaves no obsolete artifact"),
      "implementer", dir,
    );
    assert(implAdditive.ok, `implementer additive work failed: ${implAdditive.errors}`);
    const implMissingRetires = validate(
      implementerReport("legacy-flag removed from a.ts").replace(/^RETIRES:.*\n/m, ""),
      "implementer", dir,
    );
    assert(implMissingRetires.errors.some((e) => e.includes("missing label: RETIRES:")), "implementer missing RETIRES");
    const implBareNone = validate(implementerReport("none"), "implementer", dir);
    assert(implBareNone.errors.some((e) => e.startsWith("RETIRES: none")), "implementer bare none");
    const implEmptyJustification = validate(implementerReport("none — justified:"), "implementer", dir);
    assert(implEmptyJustification.errors.some((e) => e.startsWith("RETIRES: none")), "implementer empty justification");
    const implPunctuatedJustification = validate(implementerReport("none — justified: —"), "implementer", dir);
    assert(implPunctuatedJustification.errors.some((e) => e.startsWith("RETIRES: none")), "implementer punctuated justification");
    const implDanglingNone = validate(implementerReport("none —"), "implementer", dir);
    assert(implDanglingNone.errors.some((e) => e.startsWith("RETIRES: none")), "implementer dangling none");
    const implBad = validate(
      ["STATUS: decision-needed", "ANCHOR DELTA: none", "DIFF: a.ts", "RETIRES: none — additive work leaves no obsolete artifact",
       "CLAIMS: README says X (no anchor)",
       "CALLS: none", "GATE EVIDENCE:", "TESTS RUN: unit", "ACCEPTANCE: -", "SIBLINGS: none",
       "DEFERRALS: none", "RISKS: none"].join("\n"),
      "implementer", dir);
    assert(implBad.errors.some((e) => e.includes("CLAIMS line without an anchor")), "unanchored claim");
    assert(implBad.errors.some((e) => e.includes("GATE EVIDENCE is empty")), "empty gate evidence");
    assert(implBad.errors.some((e) => e.includes("DECISION BRIEF")), "decision-needed without brief");

    const correctionReport = (retires) => [
      "STATUS: complete", "DIFF: a.ts — remove stale branch", `RETIRES: ${retires}`,
      "FINDINGS RESOLVED: stale branch — a.ts:2", "CLAIMS: none",
      "GATE EVIDENCE: npm test → 3 passed", "TESTS RUN: unit", "EXIT TESTS: n/a",
      "DEFERRALS / RISKS / DECISION BRIEF: none",
    ].join("\n");
    const correctionGood = validate(
      correctionReport("none — compatibility facade remains for a supported reader"),
      "correction", dir,
    );
    assert(correctionGood.ok, `correction good failed: ${correctionGood.errors}`);
    const correctionAdditive = validate(
      correctionReport("none — additive correction leaves no obsolete artifact"),
      "correction", dir,
    );
    assert(correctionAdditive.ok, `correction additive work failed: ${correctionAdditive.errors}`);
    const correctionSeparateFields = validate(
      correctionReport("legacy branch removed").replace(
        "DEFERRALS / RISKS / DECISION BRIEF: none",
        "DEFERRALS: none\nRISKS: none\nDECISION BRIEF: none",
      ),
      "correction", dir,
    );
    assert(correctionSeparateFields.ok, `correction separate fields failed: ${correctionSeparateFields.errors}`);
    const correctionMissingRetires = validate(
      correctionReport("legacy branch removed").replace(/^RETIRES:.*\n/m, ""),
      "correction", dir,
    );
    assert(correctionMissingRetires.errors.some((e) => e.includes("missing label: RETIRES:")), "correction missing RETIRES");
    const correctionBareNone = validate(correctionReport("none"), "correction", dir);
    assert(correctionBareNone.errors.some((e) => e.startsWith("RETIRES: none")), "correction bare none");
    const correctionEmptyJustification = validate(correctionReport("none — justified:"), "correction", dir);
    assert(correctionEmptyJustification.errors.some((e) => e.startsWith("RETIRES: none")), "correction empty justification");
    const correctionDecisionNeeded = (brief) => correctionReport("legacy branch removed")
      .replace("STATUS: complete", "STATUS: decision-needed")
      .replace("DEFERRALS / RISKS / DECISION BRIEF: none", brief);
    const correctionSeparateBrief = validate(
      correctionDecisionNeeded("DECISION BRIEF: Choose the supported routing before installation"),
      "correction", dir,
    );
    assert(correctionSeparateBrief.ok, `correction separate brief failed: ${correctionSeparateBrief.errors}`);
    const correctionCompactBrief = validate(
      correctionDecisionNeeded("DEFERRALS / RISKS / DECISION BRIEF: Choose the supported routing before installation"),
      "correction", dir,
    );
    assert(correctionCompactBrief.ok, `correction compact brief failed: ${correctionCompactBrief.errors}`);
    const correctionMissingBrief = validate(correctionDecisionNeeded(""), "correction", dir);
    assert(correctionMissingBrief.errors.some((e) => e.includes("substantive correction DECISION BRIEF")), "correction missing brief");
    const correctionEmptyBrief = validate(correctionDecisionNeeded("DECISION BRIEF:"), "correction", dir);
    assert(correctionEmptyBrief.errors.some((e) => e.includes("substantive correction DECISION BRIEF")), "correction empty brief");
    const correctionNoneBrief = validate(correctionDecisionNeeded("DECISION BRIEF: none"), "correction", dir);
    assert(correctionNoneBrief.errors.some((e) => e.includes("substantive correction DECISION BRIEF")), "correction none brief");

    const noRoot = validate("VERDICT: APPROVE\nEVIDENCE: nowhere/x.ts:1, y.ts:2\nFINDINGS: none", "reviewer", null);
    assert(noRoot.ok, "without --repo-root, existence is not checked");

    // Short anchors: one matching file resolves; several need the full path cited in the text.
    mkdirSync(join(dir, "src", "billing"), { recursive: true });
    mkdirSync(join(dir, "src", "usage"), { recursive: true });
    mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
    writeFileSync(join(dir, "src", "billing", "hooks.ts"), "h1\nh2\nh3\n");
    writeFileSync(join(dir, "src", "usage", "hooks.ts"), "u1\nu2\n");
    writeFileSync(join(dir, "src", "billing", "meter.use-case.ts"), "m1\nm2\nm3\nm4\n");
    writeFileSync(join(dir, "node_modules", "pkg", "vendored.ts"), "v1\n");
    const shortUnique = validate("see `meter.use-case.ts:3` and billing/meter.use-case.ts:1-2", "anchors", dir);
    assert(shortUnique.ok && shortUnique.stats.short === 2, `unique short anchors resolve: ${shortUnique.errors}`);
    assert(
      shortUnique.fixed === "see `src/billing/meter.use-case.ts:3` and src/billing/meter.use-case.ts:1-2",
      `short anchors expanded: ${shortUnique.fixed}`,
    );
    const shortPastEnd = validate("meter.use-case.ts:9", "anchors", dir);
    assert(shortPastEnd.errors.some((e) => e.includes("past the end of src/billing/meter.use-case.ts")), "resolved anchor keeps the line check");
    const shortAmbiguous = validate("hooks.ts:2", "anchors", dir);
    assert(shortAmbiguous.errors.some((e) => e.includes("matches 2 files")), "ambiguous short anchor is an error");
    const shortCited = validate("The hook lives in `src/billing/hooks.ts`.\nIt reads the balance at hooks.ts:2.", "anchors", dir);
    assert(shortCited.errors.some((e) => e.includes("matches 2 files")), "a full path cited elsewhere does not settle an ambiguous short anchor");
    const shortWrongFile = validate("see meter.use-case.ts:9 and meter.use-case.ts:2", "anchors", dir);
    assert(shortWrongFile.errors.length === 1 && shortWrongFile.fixed === "see meter.use-case.ts:9 and src/billing/meter.use-case.ts:2",
      `an anchor whose line check fails is not expanded: ${shortWrongFile.fixed}`);
    assert(shortUnique.resolutions.length === 2 && shortUnique.resolutions[0].full === "src/billing/meter.use-case.ts", "resolutions are reported");
    const hosts = validate("the pool at 127.0.0.1:5432, api.example.com:443 and db.internal:5432; missing.ts:3", "anchors", dir);
    assert(hosts.errors.length === 1 && hosts.errors[0].includes("missing.ts:3"), `host:port is not an anchor: ${hosts.errors}`);
    writeFileSync(join(dir, "example.com"), "one\n");
    assert(validate("example.com:1", "anchors", dir).ok && validate("example.com:5", "anchors", dir).errors.length === 1, "a file named like a host is still an anchor");
    const shortSkipped = validate("vendored.ts:1", "anchors", dir);
    assert(shortSkipped.errors.some((e) => e.includes("not found")), "ignored directories are not searched");
    const fullUntouched = validate("a.ts:1 and src/usage/hooks.ts:2", "anchors", dir);
    assert(fullUntouched.ok && fullUntouched.stats.short === 0 && fullUntouched.fixed === "a.ts:1 and src/usage/hooks.ts:2", "full anchors are left alone");
    const urlBefore = validate("docs at https://x.io/a/b.ts:3 then meter.use-case.ts:1", "anchors", dir);
    assert(urlBefore.fixed === "docs at https://x.io/a/b.ts:3 then src/billing/meter.use-case.ts:1", `URL keeps offsets: ${urlBefore.fixed}`);

    // In a Git worktree, a file that was deleted and not staged is still listed by Git.
    const repo = join(dir, "repo");
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src", "gone.ts"), "g1\ng2\n");
    writeFileSync(join(repo, "src", "kept.ts"), "k1\n");
    let inGit = true;
    try {
      const run = (...args) => execFileSync("git", ["-C", repo, ...args], { stdio: "ignore" });
      run("init", "-q");
      run("add", "-A");
    } catch {
      inGit = false;
    }
    rmSync(join(repo, "src", "gone.ts"));
    for (const text of ["src/gone.ts:1", "gone.ts:2"]) {
      const gone = validate(text, "anchors", repo);
      assert(gone.errors.length === 1 && gone.errors[0].includes("not found"), `deleted file is reported, not read (git=${inGit}): ${gone.errors}`);
    }
    assert(validate("kept.ts:1", "anchors", repo).ok, "a short anchor resolves through the Git listing");

    // Labels written as Markdown headings or bold lines.
    const mapperMarkdown = validate(
      ["## SYMBOLS", "- foo at a.ts:1", "**PATTERN**", "copy b.md:1", "**TESTS:** none yet", "### WRITERS:", "a.ts:5",
       "**COUPLINGS**: none", "LIFECYCLE", "none", "__SIBLINGS__", "none", "#### UNCERTAINTIES", "none"].join("\n"),
      "mapper", dir);
    assert(mapperMarkdown.ok, `markdown labels failed: ${mapperMarkdown.errors}`);
    const implNoted = validate(
      implementerReport("none — additive work leaves no obsolete artifact").replace(
        "GATE EVIDENCE: npm test → 3 passed", "GATE EVIDENCE (tested state: HEAD plus this diff):\n- npm test → 3 passed",
      ),
      "implementer", dir);
    assert(implNoted.ok, `label with a parenthetical failed: ${implNoted.errors}`);
    const implNotedEmpty = validate(
      implementerReport("none — additive work leaves no obsolete artifact").replace("CLAIMS: README says X → b.md:1", "CLAIMS (none this round):"),
      "implementer", dir);
    assert(implNotedEmpty.errors.some((e) => e.includes("CLAIMS line without an anchor")), "a parenthetical is content, not an exemption");
    const wholeBold = validate("**VERDICT: APPROVE**\n**EVIDENCE:** a.ts:1 — read; a.ts:2 — read\n__FINDINGS: none__", "reviewer", dir);
    assert(wholeBold.ok, `whole-line bold labels failed: ${wholeBold.errors}`);
    const boldTag = validate(
      "VERDICT: REJECT\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS:\n- a.ts:3 — issue — **Trigger:** static — rule — impact — fix — **Evidence:** `code`", "reviewer", dir);
    assert(boldTag.ok, `bold trigger and evidence tags failed: ${boldTag.errors}`);
    const proseNotLabel = validate("SYMBOLS: a.ts:1\nThe TESTS\nPATTERN: x", "mapper", dir);
    assert(proseNotLabel.errors.some((e) => e.includes("missing label: TESTS:")), "a label inside a longer line is not a label");

    // A finding or claim is one bullet with its wrapped and nested lines.
    const reviewerWrapped = validate(
      ["VERDICT: REJECT", "EVIDENCE: a.ts:1, a.ts:2", "FINDINGS:",
       "- a.ts:3 — the page promises a refund that the code never issues",
       "  - the page contradicts itself two paragraphs later",
       "  trigger: static — doc-truth claim — impact: wrong promise — fix the sentence —",
       "  evidence: code",
       "- b.md:2 — stale count — trigger: static — claim — impact — fix — evidence: code",
       "NOTES: none"].join("\n"),
      "reviewer", dir);
    assert(reviewerWrapped.ok, `wrapped finding failed: ${reviewerWrapped.errors}`);
    const reviewerSecondBare = validate(
      "VERDICT: REJECT\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS:\n- a.ts:3 — x — trigger: static — r — i — f — evidence: code\n- second finding with nothing",
      "reviewer", dir);
    assert(reviewerSecondBare.errors.filter((e) => e.startsWith("finding without")).length === 3, "each top-level bullet is checked on its own");
    const claimsWrapped = validate(
      implementerReport("none — additive work leaves no obsolete artifact").replace(
        "CLAIMS: README says X → b.md:1",
        "CLAIMS:\n- The README says the fee is reserved when the order is submitted and returned on\n  failure → b.md:1\n- The card names the month:\n  - en → a.ts:2\n  - pt-BR → `:4`",
      ),
      "implementer", dir);
    assert(claimsWrapped.ok, `wrapped claims failed: ${claimsWrapped.errors}`);
    const claimsUnbulleted = validate(
      implementerReport("none — additive work leaves no obsolete artifact").replace(
        "CLAIMS: README says X → b.md:1", "CLAIMS:\nfirst claim → b.md:1\nsecond claim with no anchor",
      ),
      "implementer", dir);
    assert(claimsUnbulleted.errors.some((e) => e.includes("CLAIMS line without an anchor: second claim")), "unbulleted lines are separate claims");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log("validate-report self-test passed");
}

// ---------- CLI ----------

function main(argv) {
  const args = [...argv];
  if (args.includes("--self-test")) {
    selfTest();
    return 0;
  }
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
  const kind = opt("--kind");
  const inputArg = opt("--input");
  const input = inputArg === "-" ? null : inputArg;
  const repoRootArg = opt("--repo-root");
  const json = args.includes("--json");
  const fix = args.includes("--fix");
  if (!kind || !["mapper", "reviewer", "final", "implementer", "correction", "anchors"].includes(kind)) {
    console.error("usage: validate-report.mjs --kind mapper|reviewer|final|implementer|correction|anchors [--input file] [--repo-root dir] [--fix] [--json] | --self-test");
    return 2;
  }
  if (fix && !input) {
    console.error("--fix rewrites the report file and needs --input <file>");
    return 2;
  }
  let text;
  try {
    text = input ? readFileSync(input, "utf8") : readFileSync(0, "utf8");
  } catch (e) {
    console.error(`error: cannot read input: ${e.message}`);
    return 2;
  }
  if (!text.trim()) {
    console.error("error: empty input");
    return 2;
  }
  let repoRoot = null;
  if (repoRootArg) {
    repoRoot = resolve(repoRootArg);
    if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) {
      console.error(`error: --repo-root ${repoRoot} is not a directory`);
      return 2;
    }
  }
  const { fixed, ...report } = validate(text, kind, repoRoot);
  const expanded = fix && fixed !== text;
  if (expanded) writeFileSync(input, fixed);
  if (json) console.log(JSON.stringify({ ...report, expanded }, null, 2));
  else {
    console.log(report.ok ? `OK (${report.warnings.length} warnings)` : `FAIL (${report.errors.length} errors, ${report.warnings.length} warnings)`);
    for (const e of report.errors) console.log(`  ERROR: ${e}`);
    for (const w of report.warnings) console.log(`  WARN:  ${w}`);
    for (const r of report.resolutions.slice(0, 12)) {
      console.log(`  NOTE:  short anchor ${r.short} taken as ${r.full}; write the full path if another file was meant`);
    }
    if (report.resolutions.length > 12) console.log(`  NOTE:  … and ${report.resolutions.length - 12} more short anchors`);
    const short = report.stats.short
      ? ` (${report.stats.short} short, ${expanded ? "expanded in the file" : "resolved; --fix writes the full paths"})`
      : "";
    console.log(`  anchors: ${report.stats.anchors}${short}; labels: ${report.stats.labels.join(", ") || "none"}`);
  }
  return report.ok ? 0 : 1;
}

// Run the CLI when this file is the entry script, under any name or through a link; an importing
// script gets the exports only.
const entry = process.argv[1] ? resolve(process.argv[1]) : "";
if (entry && [entry, realpathSync(entry)].includes(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)));
}
