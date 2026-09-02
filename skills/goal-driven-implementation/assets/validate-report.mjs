#!/usr/bin/env node
// Structurally validate an agent's return before the orchestrator acts on it: required labels
// present, verdict well-formed, every file:line anchor resolves to a real file and a line that
// exists. Pattern taken from the aiq-lite code-research subagent validator.
//
//   node validate-report.mjs --kind <mapper|reviewer|final|implementer|anchors>
//                            [--input <file>] [--repo-root <dir>] [--json]
//   <agent output> | node validate-report.mjs --kind reviewer --repo-root .
//   node validate-report.mjs --self-test
//
// Exit 0 = valid (warnings allowed), 1 = hard errors, 2 = usage or IO error.
//
// Kinds (report formats are the ones in references/agent-prompts.md):
//   mapper       SYMBOLS PATTERN TESTS WRITERS COUPLINGS LIFECYCLE SIBLINGS UNCERTAINTIES
//                labels present; SYMBOLS carries at least one anchor. Warns "thin" under three
//                anchors and "soft" when UNCERTAINTIES bullets outnumber anchors.
//   reviewer     VERDICT: APPROVE|REJECT; EVIDENCE with 2–5 anchors; FINDINGS none or one
//                anchored line each carrying an evidence tag (test|code|partial|config|inference).
//                REJECT with FINDINGS: none is an error. All-inference findings are a warning the
//                orchestrator verifies before relaying.
//   final        as reviewer with VERDICT: CLEAN|FINDINGS and 2–8 evidence anchors.
//   implementer  STATUS: complete|blocked|decision-needed; report labels present; every CLAIMS
//                line anchored; GATE EVIDENCE non-empty; decision-needed carries a DECISION BRIEF.
//   anchors      only the anchor check, for any text (a plan file, a brief, a finding list).
//
// An anchor is `path/with.ext:N` or `path/with.ext:N-M`, optionally in backticks. Absolute paths
// are errors; with --repo-root the file must exist and N (and M) must not exceed its line count.

import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";

const ANCHOR_RE =
  /(?<![\w.])`?((?:[A-Za-z]:)?[\\/]?(?:[\w.@+-]+[\\/])*[\w.@+-]+\.[A-Za-z0-9]{1,12}):(\d+)(?:-(\d+))?`?(?![\w:])/g;
const URL_RE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
const EVIDENCE_TAG_RE = /\bevidence:\s*(test|code|partial|config|inference)\b/i;
const LABEL_RE = /^([A-Z][A-Z0-9 /_-]{1,40}):[ \t]*(.*)$/;

const MAPPER_LABELS = ["SYMBOLS", "PATTERN", "TESTS", "WRITERS", "COUPLINGS", "LIFECYCLE", "SIBLINGS", "UNCERTAINTIES"];
const IMPLEMENTER_LABELS = [
  "STATUS", "ANCHOR DELTA", "DIFF", "CLAIMS", "CALLS", "GATE EVIDENCE", "TESTS RUN",
  "ACCEPTANCE", "SIBLINGS", "DEFERRALS", "RISKS",
];
const REVIEW_LABELS = ["VERDICT", "EVIDENCE", "FINDINGS"];

// ---------- parsing ----------

function sections(text) {
  const out = new Map();
  let current = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\*\*|\*\*$/g, "");
    const m = LABEL_RE.exec(line.trim());
    if (m && !line.trim().startsWith("-")) {
      current = m[1].trim();
      out.set(current, out.has(current) ? `${out.get(current)}\n${m[2]}` : m[2]);
      continue;
    }
    if (current !== null) out.set(current, `${out.get(current)}\n${raw}`);
  }
  return out;
}

function anchorsIn(text) {
  const found = [];
  for (const m of text.replace(URL_RE, " ").matchAll(ANCHOR_RE)) {
    found.push({ path: m[1], lo: Number(m[2]), hi: m[3] ? Number(m[3]) : null, raw: m[0] });
  }
  return found;
}

const bullets = (body) =>
  body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && l !== "none");
const isNone = (body) => /^\s*none\b/i.test(body.trim());

// ---------- checks ----------

function checkAnchors(anchors, repoRoot, errors) {
  const lineCounts = new Map();
  for (const a of anchors) {
    if (isAbsolute(a.path) || /^[A-Za-z]:[\\/]/.test(a.path) || /^[\\/]/.test(a.path)) {
      errors.push(`anchor is absolute, not repo-relative: ${a.raw}`);
      continue;
    }
    if (a.hi !== null && a.hi < a.lo) errors.push(`anchor has an inverted range: ${a.raw}`);
    if (!repoRoot) continue;
    const abs = join(repoRoot, a.path);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      errors.push(`anchor file not found under repo root: ${a.raw}`);
      continue;
    }
    if (!lineCounts.has(abs)) {
      const content = readFileSync(abs, "utf8");
      const n = content.length === 0 ? 0 : content.split(/\r?\n/).length - (content.endsWith("\n") ? 1 : 0);
      lineCounts.set(abs, n);
    }
    const n = lineCounts.get(abs);
    const top = a.hi ?? a.lo;
    if (top > n) errors.push(`anchor line ${top} is past the end of ${a.path} (${n} lines): ${a.raw}`);
  }
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

function checkReview(sec, errors, warnings, { verdicts, minEvidence, maxEvidence, rejecting }) {
  requireLabels(sec, REVIEW_LABELS, errors);
  const verdict = (sec.get("VERDICT") ?? "").trim().split(/\s+/)[0]?.toUpperCase() ?? "";
  if (sec.has("VERDICT") && !verdicts.includes(verdict))
    errors.push(`VERDICT must be one of ${verdicts.join("|")}, got ${JSON.stringify(verdict)}`);
  const ev = anchorsIn(sec.get("EVIDENCE") ?? "");
  if (sec.has("EVIDENCE") && ev.length === 0) errors.push("EVIDENCE carries no file:line anchor");
  else if (ev.length && (ev.length < minEvidence || ev.length > maxEvidence))
    warnings.push(`EVIDENCE has ${ev.length} anchors (template asks ${minEvidence}–${maxEvidence})`);
  const findingsBody = sec.get("FINDINGS") ?? "";
  const findings = isNone(findingsBody) ? [] : bullets(findingsBody);
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
  }
  if (findings.length && inference === findings.length)
    warnings.push("every finding is evidence: inference — verify against the code before relaying to the implementer");
}

function checkImplementer(sec, errors, warnings) {
  requireLabels(sec, IMPLEMENTER_LABELS, errors);
  const status = (sec.get("STATUS") ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (sec.has("STATUS") && !["complete", "blocked", "decision-needed"].includes(status))
    errors.push(`STATUS must be complete|blocked|decision-needed, got ${JSON.stringify(status)}`);
  const claimsBody = sec.get("CLAIMS") ?? "";
  if (sec.has("CLAIMS") && !isNone(claimsBody)) {
    for (const c of bullets(claimsBody))
      if (anchorsIn(c).length === 0) errors.push(`CLAIMS line without an anchor: ${short(c)}`);
  }
  if (sec.has("GATE EVIDENCE") && !(sec.get("GATE EVIDENCE") ?? "").trim())
    errors.push("GATE EVIDENCE is empty");
  if (status === "complete" && /\b(not run|unrun|did not run|skipped)\b/i.test(sec.get("TESTS RUN") ?? ""))
    warnings.push("STATUS: complete but TESTS RUN mentions an unrun or skipped check");
  if (status === "decision-needed" && !sec.has("DECISION BRIEF"))
    errors.push("STATUS: decision-needed without a DECISION BRIEF");
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
      checkReview(sec, errors, warnings, { verdicts: ["APPROVE", "REJECT"], minEvidence: 2, maxEvidence: 5, rejecting: "REJECT" });
      break;
    case "final":
      checkReview(sec, errors, warnings, { verdicts: ["CLEAN", "FINDINGS"], minEvidence: 2, maxEvidence: 8, rejecting: "FINDINGS" });
      break;
    case "implementer":
      checkImplementer(sec, errors, warnings);
      break;
    case "anchors":
      break;
    default:
      throw new Error(`unknown kind: ${kind}`);
  }
  const anchors = anchorsIn(text);
  checkAnchors(anchors, repoRoot, errors);
  return {
    ok: errors.length === 0,
    kind,
    errors,
    warnings,
    stats: { anchors: anchors.length, labels: [...sec.keys()] },
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
      "VERDICT: REJECT\nEVIDENCE: a.ts:1 — checked; a.ts:2 — checked\nFINDINGS:\n- a.ts:3 — off by one — wrong count — fix loop bound — evidence: code\nNOTES: none",
      "reviewer", dir);
    assert(reviewerGood.ok, `reviewer good failed: ${reviewerGood.errors}`);
    const reviewerBad = validate("VERDICT: REJECT\nEVIDENCE: a.ts:1\nFINDINGS: none", "reviewer", dir);
    assert(reviewerBad.errors.some((e) => e.includes("REJECT with no findings")), "reject without findings");
    assert(reviewerBad.warnings.some((w) => w.includes("EVIDENCE has 1")), "evidence count warning");
    const reviewerUntagged = validate(
      "VERDICT: REJECT\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS:\n- a.ts:3 — issue — impact — fix", "reviewer", dir);
    assert(reviewerUntagged.errors.some((e) => e.includes("evidence tag")), "finding without evidence tag");
    const reviewerInference = validate(
      "VERDICT: REJECT\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS:\n- a.ts:3 — issue — impact — fix — evidence: inference", "reviewer", dir);
    assert(reviewerInference.ok && reviewerInference.warnings.some((w) => w.includes("inference")), "all-inference warning");
    const finalGood = validate("VERDICT: CLEAN\nEVIDENCE: a.ts:1, a.ts:2, b.md:1\nFINDINGS: none\nNOTES: -", "final", dir);
    assert(finalGood.ok, `final good failed: ${finalGood.errors}`);
    const finalBadVerdict = validate("VERDICT: APPROVE\nEVIDENCE: a.ts:1, a.ts:2\nFINDINGS: none", "final", dir);
    assert(finalBadVerdict.errors.some((e) => e.includes("VERDICT must be one of CLEAN|FINDINGS")), "final verdict vocabulary");

    const implGood = validate(
      ["STATUS: complete", "ANCHOR DELTA: none", "DIFF: a.ts — fix", "CLAIMS: README says X → b.md:1",
       "CALLS: none", "GATE EVIDENCE: npm test → 3 passed", "TESTS RUN: unit; sensitivity check red output pasted",
       "LIVE FLOW: n/a", "ENV: none", "LIFECYCLE EFFECTS: none", "ACCEPTANCE: Goal 1 clause 2",
       "SIBLINGS: none", "DEFERRALS: none", "RISKS: none"].join("\n"),
      "implementer", dir);
    assert(implGood.ok, `implementer good failed: ${implGood.errors}`);
    const implBad = validate(
      ["STATUS: decision-needed", "ANCHOR DELTA: none", "DIFF: a.ts", "CLAIMS: README says X (no anchor)",
       "CALLS: none", "GATE EVIDENCE:", "TESTS RUN: unit", "ACCEPTANCE: -", "SIBLINGS: none",
       "DEFERRALS: none", "RISKS: none"].join("\n"),
      "implementer", dir);
    assert(implBad.errors.some((e) => e.includes("CLAIMS line without an anchor")), "unanchored claim");
    assert(implBad.errors.some((e) => e.includes("GATE EVIDENCE is empty")), "empty gate evidence");
    assert(implBad.errors.some((e) => e.includes("DECISION BRIEF")), "decision-needed without brief");

    const noRoot = validate("VERDICT: APPROVE\nEVIDENCE: nowhere/x.ts:1, y.ts:2\nFINDINGS: none", "reviewer", null);
    assert(noRoot.ok, "without --repo-root, existence is not checked");
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
  const input = opt("--input");
  const repoRootArg = opt("--repo-root");
  const json = args.includes("--json");
  if (!kind || !["mapper", "reviewer", "final", "implementer", "anchors"].includes(kind)) {
    console.error("usage: validate-report.mjs --kind mapper|reviewer|final|implementer|anchors [--input file] [--repo-root dir] [--json] | --self-test");
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
  const report = validate(text, kind, repoRoot);
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(report.ok ? `OK (${report.warnings.length} warnings)` : `FAIL (${report.errors.length} errors, ${report.warnings.length} warnings)`);
    for (const e of report.errors) console.log(`  ERROR: ${e}`);
    for (const w of report.warnings) console.log(`  WARN:  ${w}`);
    console.log(`  anchors: ${report.stats.anchors}; labels: ${report.stats.labels.join(", ") || "none"}`);
  }
  return report.ok ? 0 : 1;
}

if (process.argv[1] && basename(process.argv[1]) === "validate-report.mjs") {
  process.exit(main(process.argv.slice(2)));
}
