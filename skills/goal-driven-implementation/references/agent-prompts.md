# Dispatch Reference

Each role's rules and report format are in a prompt file under `assets/prompts/`. The role reads
that file itself. A dispatch message is a short stub: it names the files to read and carries the
fields only the orchestrator knows. Name a file instead of pasting it: do not put a prompt file, a
section block, or another agent's report into a dispatch message.

Substitute `{...}` placeholders and keep everything else intact. Dispatch mechanics (agent names,
model and effort, follow-up calls, routing evidence, where the run directory lives) are
harness-specific: read `references/routing-claude.md` or `references/routing-codex.md`. For
Codex, prepend its prompt wrapper on initial dispatches, corrections, and follow-ups. Where a
harness exposes routing metadata, a report begins with its `ROUTING` header (Codex: `requested`,
`attestation`, `runtime`).

Contents:

- [Run directory and reports](#run-directory-and-reports)
- [0. Planner](#0-planner)
- [1. Mapper](#1-mapper)
- [2. Implementer](#2-implementer)
- [3. Section reviewer](#3-section-reviewer)
- [4. Final-review reviewer](#4-final-review-reviewer)
- [5. Rejection follow-up](#5-rejection-follow-up)
- [6. Decision relay](#6-decision-relay)
- [7. Correction implementer](#7-correction-implementer)

| Prompt file                         | Read by                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| `assets/prompts/planner.md`         | plan author                                               |
| `assets/prompts/mapper.md`          | mapper                                                    |
| `assets/prompts/implementer.md`     | section implementer, first dispatch and correction rounds |
| `assets/prompts/reviewer.md`        | section reviewer; holds the eight lens checklists         |
| `assets/prompts/final-reviewer.md`  | whole-branch reviewer; holds lenses a–f                   |
| `assets/prompts/correction.md`      | final-review correction implementer                       |

---

## Run directory and reports

**Run directory.** One directory per plan, outside the repository, that the session and its
agents can write. The harness routing reference says where it goes. It holds `baseline.txt`, one
`<ID>.assignment.md` per section, and every agent report. Record its path in the plan header. A
later session reuses it while it exists; a report that is missing from it is a lost return.

**Assignment file.** `assets/section-brief.mjs` writes `<run-dir>/<ID>.assignment.md` from the
plan: the section block verbatim, the rulings that apply to it, Corrections in force, the global
gate, the preflight with known blockers, the PARALLEL BATCH block, and the working-tree baseline.
It also prints the implementer and reviewer stubs for that section with every path filled in.
Run it again before dispatching the section's reviewers and before a fresh correction carrier, so
the file carries any ruling, recorded call, write-set change, correction in force, or batch state
recorded since the implementer was dispatched.

**Report delivery.** Where the harness lets a role write to the run directory, the stub names a
`REPORT FILE` and the `VALIDATE` command. The agent writes its report there, runs the validator,
corrects what it prints, and returns a pointer of two or three lines. Where it does not, the stub
says `REPORT FILE: none` and has no `VALIDATE` line, the agent's final message is the report, and
the orchestrator saves that message to the run directory before validating it.

| Report                                     | File name in the run directory                    | `--kind`      |
| ------------------------------------------ | ------------------------------------------------- | ------------- |
| Mapper                                     | `map-<area>.md`                                   | `mapper`      |
| Section implementer, first report          | `<ID>-impl.md`                                    | `implementer` |
| Section implementer, correction round n    | `<ID>-impl-r<n>.md`                               | `implementer` |
| Section reviewer; its re-review, round n   | `<ID>-rev-<lens>.md`; `<ID>-rev-<lens>-r<n>.md`   | `reviewer`    |
| Final reviewer; its re-review, round n     | `final-<lenses>.md`; `final-<lenses>-r<n>.md`     | `final`       |
| Final-review correction, round n           | `final-correction-r<n>.md`                        | `correction`  |

In a file name, `<lens>` is the lens name in lowercase with every run of other characters
replaced by `-` (`contract/API` → `contract-api`), `<lenses>` is the final reviewer's lens
letters (`final-ab.md`), and `<area>` is a short slug of the mapper's AREA that no other report in
the run directory uses.

**Validation.** The agent's `VALIDATION` line is a claim. Before acting on any report, run

```bash
node <skill-root>/assets/validate-report.mjs --kind <kind> --repo-root <repo> --input <report file> --fix
```

and then read the report file. `--fix` rewrites a short anchor such as `meter.ts:42` to the
repository-relative path when exactly one file matches. A hard error goes back to the **same**
agent once, with the error list pasted and the same `REPORT FILE`; reviewers and the planner see
only a report that validates. Hard errors: a missing label, an anchor whose file or line does not
exist, a short anchor that matches several files, SYMBOLS with no anchor, a CLAIMS item or a
finding without an anchor, a finding without an evidence tag or a `trigger:`, a REJECT with no
findings, a bare or unexplained `RETIRES: none`, empty GATE EVIDENCE, `decision-needed` without a
brief.

---

## 0. Planner

One plan author may write the assigned plan and graph artifacts at a time. Dispatch it only after
the required PLAN-mode mapper returns validate (`gdi-planner` in Claude Code, `goal-planner` in
Codex; a harness fallback is recorded, never silent). It runs in a fresh context and does not
delegate.

```text
Read {skill-root}/assets/prompts/planner.md in full before anything else. It holds your rules and
the handoff format.

PLAN ARTIFACT: {plan path}
GRAPH ARTIFACTS: {render or image paths, or "none"}
MAPPED CONTEXT: {the validated mapper report files in the run directory, or verified orchestrator
anchors under the mapping exception}
OPEN QUESTIONS: {unresolved facts and the owner of each answer}
SCOPE AND SOURCES: {allowed plan inputs, exclusions, and source paths}
RULINGS: {existing floor rulings and recorded calls}
WORKFLOW AND RESOURCES: {absolute paths to SKILL.md, plan-template.md, graph-analysis.md, and validators}
SKILL ROOT AND PROVENANCE: {resolved skill root, source revision/release, installed or repository copy}
PREFLIGHT AND GATES: {status, baseline SHA, scheduled gates, and valid evidence}
COMPLETION: {plan validation, structural/visual graph checks, and handoff criteria}
```

The planner returns a free-form handoff. Its claims about validation are checked by running the
plan validator and the anchors check yourself.

---

## 1. Mapper

Read-only. Dispatch only for context items that lack `file:line` anchors or whose anchored files
changed since the plan was written. Cap 2 per section; all in one message. In PLAN mode, one
mapper per unit the inputs touch, named from the feature map.

```text
Read {skill-root}/assets/prompts/mapper.md in full before anything else. It holds your rules and
report format.

AREA: {context item}
SECTION GOAL: {one-line goal}
FEATURE MAP: {path to the scout map, or "none — flat repository"}
UNIT: {unit name and path from the map that owns this area, or "n/a"}
BOUNDARY: {specific questions, relevant paths, and exclusions}
REPORT FILE: {run-dir}/map-{area}.md   (or "none — return the report as your final message", without the next line)
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind mapper --repo-root {repo} --input {report file} --fix
```

Validate every return before using it. A second hard error from the same mapper is recorded
under **Premise corrections** as an unmapped area; do not retry again. A `thin` or `soft` warning
allows at most one targeted follow-up per section: a narrower AREA limited to symbols with
insufficient evidence. Record any remaining evidence gaps as an accepted risk in Graph Findings.

Give the planner the validated mapper report files to filter into per-section context. On an
EXECUTE refresh without a replan, the orchestrator filters the new evidence into the current
section's ADDITIONAL CONTEXT. Record any correction to the plan's premise under **Premise
corrections**.

---

## 2. Implementer

A section has one implementer at a time, and only members of one parallel batch run at the same
time. Keep each handle: decision relays (§6) and report-validation errors resume that agent; a
rejection goes to the correction carrier (§5).

Write the assignment file and get the stubs:

```bash
node <skill-root>/assets/section-brief.mjs <plan-file> <ID> --run-dir <run-dir> --repo-root <repo>
```

Send the IMPLEMENTER stub it prints as the dispatch message:

```text
Read {skill-root}/assets/prompts/implementer.md and {run-dir}/{ID}.assignment.md in full before anything else.
The first holds your rules and report format. The second is your assignment.
REPORT FILE: {run-dir}/{ID}-impl.md
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind implementer --repo-root {repo} --input {run-dir}/{ID}-impl.md --fix
ADDITIONAL CONTEXT: {facts verified after the plan was written: an EXECUTE-time mapper refresh,
a decision made since, a sibling surface the previous section reported; or "none"}
```

The first call stores the uncommitted paths in `<run-dir>/baseline.txt`, and later calls read
that file. The script captures nothing when section work may already be in the tree, which is at
a correction round or while a ledger row carries batch state: it prints `NOT CAPTURED`, and you
write to `baseline.txt` the `git status --porcelain` lines that are not plan work (an empty file
when there are none) and run it again. Edit the file the same way when unrelated changes appear
in the checkout later.

For a parallel batch, write every picked member's state on its ledger row before generating any
member's assignment: the PARALLEL BATCH block lists the other sections whose unchecked rows
carry batch state. Check the `parallel batch:` line the script prints.

---

## 3. Section reviewer

Read-only, one lens each, all applicable lenses launched in one message after the implementer's
report validates. Never fewer than three lenses outside the bounded-fix lane, which runs exactly
convention/scope and doc-truth. `⚠` sections get the full set. Security stays whenever tenancy,
auth, limits, resolvers, or hooks are touched. Doc-truth always runs. The lens names are
security/authz, data/migration, contract/API, failure-mode/reliability, convention/scope,
doc-truth, capacity/false-positive, and evaluator soundness; their checklists are in
`assets/prompts/reviewer.md`.

Run `section-brief.mjs` again for the section, then send the REVIEWER stub it prints, once per
lens:

```text
Read {skill-root}/assets/prompts/reviewer.md, {run-dir}/{ID}.assignment.md, and the implementer report {run-dir}/{ID}-impl.md in full before anything else.
LENS: {lens name}
DIFF SCOPE: {the uncommitted changes the report's DIFF lists, or a commit range; in a parallel
batch, the member's paths from the --write-sets listing}
GRAPH CONTEXT: {planner-inspected image/crop + relevant node IDs + plan state, or "none"}
REPORT FILE: {run-dir}/{ID}-rev-{lens}.md
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind reviewer --repo-root {repo} --input {run-dir}/{ID}-rev-{lens}.md --fix
```

Graph context is optional for section and final reviews: include an existing planner-inspected
image or relevant crop only when it clarifies cross-section dependencies, shared-state paths, or
integration gates inside the lens. Label the relevant nodes and matching plan state; use `none`
for a local review that gains nothing from a diagram. The plan-authoring planner owns graph
inspection; missing graph context does not block code review.

The direct lane has no plan and no assignment file. It runs one reviewer with both checklists and
gives the fields in the message:

```text
Read {skill-root}/assets/prompts/reviewer.md in full before anything else.
LENS: doc-truth and convention/scope
SECTION GOAL: {one-line goal}
ACCEPTANCE AND INVARIANTS: {what the change must state or preserve}
DIFF SCOPE: {changed files}
WRITE SET: none declared
BASELINE EXCLUSIONS: {pre-existing changes}
IMPLEMENTER REPORT: {the orchestrator's change summary and CLAIMS block: every assertion the diff
adds, with its anchor}
GRAPH CONTEXT: none
REPORT FILE: {a path outside the repository, or "none — return the report as your final message", without the next line}
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind reviewer --repo-root {repo} --input {report file} --fix
```

After validation, two more checks apply to a REJECT before it reaches the implementer:

- A REJECT whose findings are all `evidence: inference` does not reach the implementer as-is: the
  orchestrator verifies each against the code and either upgrades the tag with its own anchor or
  refutes it on the record.
- A finding whose named trigger does not exist in the repository or deployment (no such caller,
  writer, or client request) is refuted on the record as `unreachable` and is not relayed.

---

## 4. Final-review reviewer

Dispatched at completion, 2–3 in one message, over the branch **merged onto current
`origin/main`**. Integration lenses, not section lenses; they are defined in
`assets/prompts/final-reviewer.md`: (a) seams and late obligations, (b) whole-surface contract and
conformance coherence, (c) plan conformance, deferrals, debris, (d) reader sweep of the diff's
complement, (e) claim decay, (f) rollout window.

```text
Read {skill-root}/assets/prompts/final-reviewer.md in full before anything else. It holds your
rules, the lens definitions, and the report format.

LENS: {one or more of a–f, by letter and name}
BRANCH: {merged tree / commit range}
PLAN: {plan path}
BASELINE EXCLUSIONS: {pre-existing changes}
CORRECTION REPORTS: {validated correction report files, or "none"}
GRAPH CONTEXT: {planner-inspected image/crop + relevant node IDs + plan state, or "none"}
REPORT FILE: {run-dir}/final-{lenses}.md   (or "none — return the report as your final message", without the next line)
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind final --repo-root {repo} --input {report file} --fix
```

The same re-prompt-once, all-inference, and unreachable-trigger rules as the section reviewer
apply.

---

## 5. Rejection follow-up

Record `R<n> <class>: <one line>` in the ledger before sending. Pick the **correction carrier**
first, using the carrier rule in the harness routing reference; a harness whose reference states no
rule always uses the same implementer.

- **Same implementer (default).** Resume it with the first body below.
- **Fresh section-correction implementer.** When the carrier rule applies, dispatch a new
  implementer and never message the first handle again in this section: a section has one
  implementer at a time. Append `(carrier: fresh)` to the round line. The validated prior report
  and the uncommitted section diff are the whole handoff, so the stub names the prior report's
  file; a paraphrase drops the CALLS and CLAIMS the new agent must honor.

Decision relays (§6) and report-validation errors always resume the same agent. They arrive
before a validated report exists, when that agent's context is the only record of the section's
work.

Same implementer:

```text
REVIEW RESULT: rejected. Apply CORRECTION ROUND in your rules file. Fix exactly these gaps,
nothing else:

1. {file:line — gap — required fix}
2. {...}

REPORT FILE: {run-dir}/{ID}-impl-r{n}.md   (or "none — return the full report as your final message", without the next line)
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind implementer --repo-root {repo} --input {run-dir}/{ID}-impl-r{n}.md --fix
```

Fresh section-correction implementer: run `section-brief.mjs <plan-file> <ID> --run-dir
<run-dir> --repo-root <repo> --round <n>` and send the FRESH CORRECTION CARRIER stub it prints,
with the gaps filled in:

```text
Read {skill-root}/assets/prompts/implementer.md and {run-dir}/{ID}.assignment.md in full before anything else.
You take over this section at a correction round: follow CORRECTION ROUND in the rules file.
PRIOR REPORT: {run-dir}/{the latest validated report of this section}
REVIEW RESULT: rejected. Fix exactly these gaps, nothing else:
1. {file:line — gap — required fix}
REPORT FILE: {run-dir}/{ID}-impl-r{n}.md
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind implementer --repo-root {repo} --input {run-dir}/{ID}-impl-r{n}.md --fix
```

**Re-review.** After the correction report validates, resume each reviewer that rejected with the
body below. Resume a reviewer that approved only when the correction changed code in its lens.
Dispatch a fresh reviewer only when the first one is lost: use the §3 stub with the correction
report in place of the implementer report (for a final review, the §4 stub with it under
CORRECTION REPORTS), and add the first and third fields below. Validate the return with `--kind
reviewer`. A final-review correction (§7) is re-reviewed the same way by the reviewers that
reported findings, with the final reviewer's file name and `--kind final`; its CHANGED IN THIS
ROUND is the correction report's DIFF.

```text
RE-REVIEW of the same scope and lens after a correction. Apply RE-REVIEW in your rules file.

YOUR FINDINGS SENT FOR CORRECTION: {each finding as relayed; mark any the orchestrator refuted,
with the reason}
CORRECTION REPORT: {the validated correction report file}
CHANGED IN THIS ROUND: {the DIFF lines the correction report marks `(changed this round)`}
REPORT FILE: {run-dir}/{the re-review file name: {ID}-rev-{lens}-r{n}.md, or final-{lenses}-r{n}.md}   (or "none — return the report as your final message", without the next line)
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind {reviewer, or final for a final review} --repo-root {repo} --input {report file} --fix
```

Convergence rule: rounds continue while unresolved findings decrease. An unruled floor item goes
to the user. A repeated defect mechanism or findings that stop decreasing enters orchestrator
sign-off mode (`SKILL.md` step 6). The orchestrator supplies missing facts, requests a bounded
replan if the commit boundary no longer holds, and gives each finding an evidenced disposition.
Send only required corrections to the implementer at its usual route; the orchestrator then
rechecks and accepts without requiring further reviewer agreement. Known defects, failed required
gates, and unruled floor items still block acceptance. Preserve finding history through a split;
never stop over a round count or token threshold. The carrier threshold only selects which agent
receives a round. This rule also applies to final-review corrections (§7).

---

## 6. Decision relay

After a ruling (user for floor items; orchestrator for non-floor items, recorded with `⇢`):

```text
DECISION on your brief: {chosen option, verbatim constraints}

Proceed under this decision. It covers exactly this change; anything else on the ruling floor
still requires a new brief. Deliver the full report as before when finished.
```

Write-set relay, after the orchestrator amends a `WRITE SET` for a member that returned
`STATUS: blocked` on a path. It resumes the same agent, like a decision relay:

```text
WRITE SET amended: {paths added}. You may now edit them.

PARALLEL BATCH: {the current block}

Finish the section under the amended WRITE SET and deliver the full report as before.
```

---

## 7. Correction implementer

One agent, scoped to the final-review findings.

```text
Read {skill-root}/assets/prompts/correction.md in full before anything else. It holds your rules
and report format.

APPROVED PLAN: {path + relevant rulings}
FINDINGS: {the validated final-review report files, with any finding the orchestrator refuted
quoted and marked "refuted — do not fix"; or the anchored findings verbatim}
BRANCH AND BASELINE: {merged tree; pre-existing changes to preserve}
TASK BOUNDARY: {files needed for the findings; mechanism and invariants; relevant exemplars and
rulings; excluded work — preserve accepted behavior beyond the listed corrections}
REQUIRED GATES: {affected checks, scheduled final gates, reusable evidence with tested state}
REPORT FILE: {run-dir}/final-correction-r{n}.md   (or "none — return the report as your final message", without the next line)
VALIDATE: node {skill-root}/assets/validate-report.mjs --kind correction --repo-root {repo} --input {report file} --fix
```

Validate the correction report before the re-review (§5). A later round resumes the same agent
with the remaining findings and a new REPORT FILE.
