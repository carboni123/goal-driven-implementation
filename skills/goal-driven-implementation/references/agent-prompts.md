# Agent Prompt Templates

Substitute `{...}` placeholders and keep everything else intact. Dispatch mechanics (agent
names, model/effort, follow-up calls, routing evidence) are harness-specific — read
`references/routing-claude.md` or `references/routing-codex.md` and use its dispatch wrapper
around these bodies. For Codex, prepend its prompt wrapper on initial dispatches, corrections,
and follow-ups. Where a harness exposes routing metadata, begin the report with its specified
`ROUTING` header (Codex: `requested`, `attestation`, `runtime`); omit it where it does not.

Contents:

1. [Mapper](#1-mapper)
2. [Implementer](#2-implementer)
3. [Section reviewer + lens checklists](#3-section-reviewer)
4. [Final-review reviewer (whole branch)](#4-final-review-reviewer)
5. [Rejection follow-up](#5-rejection-follow-up)
6. [Decision relay](#6-decision-relay)
7. [Correction implementer](#7-correction-implementer)
8. [Plan topology reviewer](#8-plan-topology-reviewer)

---

## 1. Mapper

Read-only. Dispatch only for context items that lack `file:line` anchors or whose anchored files
changed since the plan was written. Cap 2 per section; all in one message. In PLAN mode, one
mapper per unit the inputs touch, named from the feature map.

```text
Map one area of this codebase for an upcoming implementation section. Read-only — do not modify
anything, do not delegate.

AREA: {context item}
SECTION GOAL: {one-line goal}
FEATURE MAP: {path to the scout map, or "none — flat repository"}
UNIT: {unit name and path from the map that owns this area, or "n/a"}

If a feature map is given, read it first: confirm which unit owns the area, use the map's names
for units, and report under UNCERTAINTIES any way the area's framing disagrees with the map.
Verify every anchor by opening the file at that line before reporting it. Anchors are
repository-relative `path:line`. Return, densely:
SYMBOLS: relevant symbols with file:line anchors
PATTERN: the existing convention to copy and its exemplar file
TESTS: existing tests to extend and the exact command that runs them
WRITERS: every writer of the state this section changes (not only readers)
COUPLINGS: flags, config, migrations, generated code, fail-closed registries in other packages
LIFECYCLE: artifacts/config/credentials produced; build-time vs runtime binding; gates affected
SIBLINGS: other modules/routes implementing the same pattern (job, guard, resolver)
UNCERTAINTIES: claims you could not verify, stated as such
```

Validate every return before merging:

```bash
node <skill-root>/assets/validate-report.mjs --kind mapper --repo-root <repo> --input <return.md>
```

A hard error (missing label, unanchored SYMBOLS, an anchor whose file or line does not exist)
goes back to the **same** mapper once with the error list pasted; a second failure is recorded
under **Premise corrections** as an unmapped area; do not retry again. A `thin` or `soft` warning
allows at most one targeted follow-up per section: a narrower AREA limited to symbols with
insufficient evidence. Record any remaining evidence gaps as an accepted risk in Graph Findings.

Merge returns into one deduplicated brief. Record any correction to the plan's premise under
**Premise corrections**.

---

## 2. Implementer

Only one implementer agent may exist at a time. Keep its handle; every follow-up resumes that agent.

```text
You are the sole implementation agent for ONE section of a goal-driven implementation plan. No
other agent writes code for this section. Do not delegate writing.

=== SECTION (verbatim from the plan) ===
{full section block}

=== CONTEXT BRIEF ===
{merged mapper output, or "none — the plan's anchors are the brief"}

=== CORRECTIONS IN FORCE ===
{every factual correction accepted in earlier sections of this plan, or "none yet"}

=== WORKING-TREE BASELINE ===
{pre-existing changed/untracked files to preserve and exclude}

=== GLOBAL GATE ===
{final verification command and scheduled stage; existing valid evidence, if any}

=== EXECUTION-ENVIRONMENT PREFLIGHT ===
{status, baseline SHA, realm, known blockers with pre-approved handling}

RULES
- Read the repository instruction files and every touched module's README first.
- Implement exactly the IMPLEMENT list — one vertical slice. No future sections, no unrelated
  refactors, no unrelated fixes; report unrelated findings under RISKS.
- Before your first edit, re-run the section's defining search (the symbols in CONTEXT and
  WRITERS) and report any delta from the plan's anchors under ANCHOR DELTA.
- The plan's behavior claims are hypotheses. If one does not resolve against the code, report the
  correction instead of implementing the wording.
- RULING FLOOR: if the work requires an unruled change on the floor named in CONTRACT DECISION —
  ESCALATE, stop before writing that code and return STATUS: decision-needed with a brief. Do not
  implement a temporary version. Anything not on the floor: decide, note it under CALLS, continue.
- For every error path you add or touch, name the related unhandled case — raw/non-domain throw past
  an instanceof gate, timeout, partial write, crash between two writes, replay, concurrent
  writer, the same defect in the next operation — and handle it or list it under RISKS.
- After fixing a defect, search for the same defect pattern elsewhere in the repository; report hits under
  SIBLINGS (do not fix outside your section).
- Every prose claim you write or change (README, comment, docs page, OpenAPI description,
  evidence row, UI copy) must be true at THIS commit, not at branch end. Absolute words
  ("every", "always", "no longer", "only") need an anchor. Fix or flag any existing sentence
  your diff makes false, including ones you did not write.
- Extend existing tests and fixtures; each addition needs a distinct behavior or failure mode.
  For a defect fix, obtain a focused failure before and pass after when practical; an existing
  observed reproduction counts. Group assertions for the same mechanism. Record any obstacle to
  before evidence and the alternative evidence; do not create infrastructure just for the report.
- Add a sensitivity check for a concrete risk of a bypassed path, vacuous assertion, or misplaced
  fault injection; using a mock alone is not a trigger. Confirm the expected behavioral failure.
  Use a local temporary edit or disposable fixture, never a rollback of applied state, a revert
  of committed work, or a separate rebuild/deploy solely to manufacture failing output.
- Run the section's focused checks and any host-required checks due now; broader and live/e2e
  gates run at their scheduled stage. Reuse valid evidence and rerun only missing or invalidated
  checks or a targeted probe needed to resolve a finding. Preserve checks for auth/tenancy,
  persistence, concurrency, and public contracts where required. Confirm the running stack
  includes the tested changes and matching relevant inputs before trusting live evidence.
  Paste real output and identify the tested state; pending gates are not successes.
- Treat a contradicted preflight assumption as a blocker; do not improvise a different database,
  network realm, credential, or lifecycle path. Known blockers have pre-approved handling; use it
  and record it under ENV.
- Do not commit. Do not edit the plan ledger.

Your final message is exactly this report:
STATUS: complete | blocked | decision-needed
ANCHOR DELTA: anchors that moved or symbols that did not exist, or "none"
DIFF: one line per changed file — what and why
RETIRES: actual files/exports/flags removed, or none — justified: additive work leaves no obsolete artifact,
  retained compatibility, or another concrete reason
CLAIMS: one line per prose claim added or changed — claim → file:line that makes it true
CALLS: non-floor decisions you made, one line each with rationale
GATE EVIDENCE: command + decisive output + tested state; reused evidence reference or pending stage
TESTS RUN: suites and results; defect reproduction evidence; targeted sensitivity checks if needed
LIVE FLOW: steps, tested stack, observed result; or not required / scheduled stage
ENV: known-blocker handling used, or "none"
LIFECYCLE EFFECTS: produced/invalidated gate inputs; did the plan's prediction hold
ACCEPTANCE: the exit-test clause this satisfies
SIBLINGS: matching implementation patterns elsewhere, or "none"
DEFERRALS: omitted work and why deferral is safe
RISKS: what a reviewer should scrutinize; unrelated issues noticed
DECISION BRIEF: product effect; 2–4 options; consequences; recommendation; evidence (only if needed)
```

Validate the report before any reviewer is dispatched:

```bash
node <skill-root>/assets/validate-report.mjs --kind implementer --repo-root <repo> --input <report.md>
```

A hard error (missing label, bare or unexplained `RETIRES: none`, a CLAIMS line without an anchor,
an anchor that does not resolve, empty GATE EVIDENCE, `decision-needed` without a brief) goes back
to the same implementer once as a rejection with the error list; reviewers see only a report that
validates.

---

## 3. Section reviewer

Read-only, one lens each, all applicable lenses launched in one message after the implementer
reports. Never fewer than three lenses outside the bounded-fix lane, which runs exactly
convention/scope and doc-truth. `⚠` sections get the full set. Security stays whenever tenancy,
auth, limits, resolvers, or hooks are touched. Doc-truth always runs.

```text
You are a focused, read-only reviewer for one section of an implementation plan. Do not modify
files, do not delegate, do not review outside your lens.

LENS: {lens name}
SECTION GOAL: {one-line goal}
DIFF SCOPE: {changed files or commit range}
BASELINE EXCLUSIONS: {pre-existing changes}
CHECK FOR: {lens checklist}
IMPLEMENTER REPORT: {validated section report}

Read the report, diff, and enough surrounding code to judge them in context. `RETIRES` must name
artifacts actually removed, or explain why none was retired — for example, additive work leaves no
obsolete artifact or a compatibility facade remains. Do not require deletion merely to fill the
field. Reject a missing, bare, empty, or unsupported entry. The validator checks the field's shape
only — the reviewer judges whether its rationale is true. Review supplied verification evidence
before running checks. Run a targeted probe for a concrete gap or uncertain validity; do not
repeat valid runs solely for independent review. Never modify the tree. A finding must be concrete
and anchored; default to APPROVE when no concrete issue is found. Approvals cite anchors too.

Final message:
VERDICT: APPROVE | REJECT
EVIDENCE: 2–5 file:line anchors — what each establishes
FINDINGS: none | one line each: file:line — issue — impact — required correction — evidence: test|code|partial|config|inference
NOTES: non-blocking observations
```

Evidence tags, strongest first: `test` a test asserts the behavior or its absence; `code`
readable from the cited implementation; `partial` the happy path was read, the edge not traced;
`config` supported by a flag, environment value, or stub rather than runtime code; `inference`
deduced from naming, structure, or pattern. Validate each return:

```bash
node <skill-root>/assets/validate-report.mjs --kind reviewer --repo-root <repo> --input <return.md>
```

A hard error (REJECT with no findings, a finding without an anchor or tag, a dead anchor) goes
back to the same reviewer once. A REJECT whose findings are all `evidence: inference` does not
reach the implementer as-is: the orchestrator verifies each against the code and either upgrades
the tag with its own anchor or refutes it on the record.

Lens checklists:

1. **Security/authz** — authz on every new path; validation at trust boundaries; secrets never in
   code or logs; injection surfaces; **every restriction the client enforces is also enforced
   server-side**; tenant or ownership scoping on every raw read where the repository has such a
   boundary; restricted resources or operations identified or included in request bodies, inline
   media, links, headers, and nested payloads, not only the route prefix.
2. **Data/migration correctness** — additive and reversible; existing rows and legacy branches;
   constraints and indexes; **existing CHECKs, triggers, and allowlists admit any widened value**;
   **what writes this data in production** (a seed is not a rollout); rollback compatibility with
   the currently deployed binary.
3. **Contract/API compatibility** — public data structures unchanged unless ruled; old clients and data;
   **every new value written into a shared enum, column, event type, or registry has every reader
   enumerated and handled** (search the whole repository); update every affected artifact for
   SDK-visible changes (type mirror, parity test, CHANGELOG, README example, conformance row, OpenAPI).
4. **Failure-mode/reliability** — sane error states; timeouts and retries on external calls;
   partial failure and idempotency; races between the writers listed in the section; **who else
   already traverses any shared limiter, queue, or table this change re-scopes, and their
   per-interaction demand**; no orphaned state on the unhappy path.
5. **Convention/scope** — naming, layering, test placement; change stays inside the section; no
   dead code or unrelated changes; **test doubles use the current row structure**, not a legacy
   structure; defect reproduction and any needed sensitivity checks address the actual mechanism,
   with obstacles and alternative evidence stated. Require a concrete coverage gap before asking
   for more tests or fixtures; mocks alone do not justify mutation checks. No proof reverts
   committed or applied state; **no unjustified configuration key** — a new environment variable
   or other host-set key is a finding unless the
   section names who sets it, on which host, and what breaks at the default (numeric parameters are
   named constants in the owning module, runtime-changed values are config rows, env is for
   secrets, endpoints, and per-host selectors; a Zod default is not a justification); compare
   **RETIRES** against the diff and reject a missing or unsupported retirement rationale.
6. **Doc-truth** — for every claim in the CLAIMS block and every sentence the diff touches or
   makes stale (README, PRD, overview, docs page, OpenAPI description, conformance row, comment,
   UI copy): locate the code that makes it true at HEAD or REJECT with the anchor. An over-claim is
   a REJECT. A count, version, route list, evidence claim, or RETIRES rationale must trace to a
   serialized artifact or the diff.
7. **Capacity/false-positive** — run only when the diff touches a limiter, quota, timeout, or
   admission policy. Enumerate every legitimate client of the governed surface, including the
   product's own first-party traffic, and its highest per-interaction request count you can find in
   the repository (prefetch requests, polling cadence, batch sizes). Prove one legitimate interaction is
   admitted; an arbitrary "under-limit" count is not evidence.
8. **Evaluator soundness** — run only for journey/proof sections. New or changed evaluators must
   detect the relevant failure; inject a targeted fault when detection is uncertain. Reuse valid
   soundness evidence for unchanged evaluators. A crash before the first check must not write a
   pass artifact; timestamps written before the work cannot prove completion; recipients and
   identifiers are distinct per run.

---

## 4. Final-review reviewer

Dispatched at completion, 2–3 in one message, over the branch **merged onto current
`origin/main`**. Integration lenses, not section lenses.

```text
You are a read-only whole-branch reviewer for a completed goal-driven implementation plan. Do
not modify files or delegate.

LENS: {one of a–f below}
BRANCH: {merged tree / commit range}
PLAN: {plan path}
BASELINE EXCLUSIONS: {pre-existing changes}
CORRECTION REPORTS: {validated correction reports, or "none"}

Read the correction reports, whole branch, and enough of the repository to judge them in context.
For each correction report, accept a concrete no-retirement reason when additive work leaves no
obsolete artifact or a compatibility facade remains; do not require deletion merely to fill the
field. Reject a missing, bare, empty, or unsupported RETIRES entry. The validator checks its shape
only, not whether the rationale is true. Findings must be concrete and anchored. Approvals cite
anchors. Review supplied verification evidence first; run targeted checks for concrete gaps or
uncertain validity, not to repeat valid evidence solely for independent review. Final gates
scheduled after this review remain pending; they must pass before plan completion.

Final message:
VERDICT: CLEAN | FINDINGS
EVIDENCE: 2–8 anchors — what each establishes
FINDINGS: none | one line each: file:line — issue — impact — required correction — evidence: test|code|partial|config|inference
NOTES: non-blocking observations
```

Validate each return with `validate-report.mjs --kind final --repo-root <repo>`; the same
re-prompt-once and all-inference rules as the section reviewer apply.

Lenses:

- **(a) Seams and late obligations** — state one section writes and another consumes: races,
  double handling, dropped obligations. For every seam a later section introduced (trace
  propagation, an idempotency check, a release marker), enumerate all call sites across the branch
  and prove each satisfies it; a partial rollout is a finding.
- **(b) Whole-surface contract and conformance coherence** — consistency across routes, error
  codes, SDK, OpenAPI, documentation, and conformance table.
- **(c) Plan conformance, deferrals, debris** — deferrals really deferred and still reachable;
  work assigned to later sections completed; no scaffolding, stray files, or violations of plan rules
  (commit subjects, ids, naming).
- **(d) Reader sweep of the diff's complement** — every value this branch writes into a shared
  column, enum, event type, or registry, checked against every reader in the repository,
  especially fail-closed registries and reports in other packages. This lens reads files the diff
  did not touch.
- **(e) Claim decay** — every claim written by an earlier section re-verified at HEAD, including
  adjacent pre-existing sentences and comments in files changed by earlier sections.
- **(f) Rollout window** — during replacement, the old binary runs against the new schema and the
  new binary may see old rows: does either write a state the other cannot interpret; does a
  migration backfill run before the old worker is gone.

---

## 5. Rejection follow-up

Resume the same implementer. Record `R<n> <class>: <one line>` in the ledger before sending.

```text
REVIEW RESULT: rejected. Fix exactly these gaps — nothing else — then send the full report again
in the same format:

1. {file:line — gap — required fix}
2. {...}

Identify which check inputs this correction changes. Run missing or invalidated checks and any
targeted probe needed for the findings; retain valid results with their evidence references.
Do not rerun the global gate solely because this is a rejection; keep broader gates at their
scheduled stage unless a concrete risk or host rule requires them now.
Preserve the working-tree baseline.
Return the full report with RETIRES; explain any `none` entry, including additive work with no
obsolete artifact where applicable.
```

Convergence rule: rounds continue while unresolved findings decrease. Stop and report to the user when a
round identifies a floor item, repeats a class the previous round was told to fix, or breaks the
section boundary. Never stop over a round count or token threshold.

---

## 6. Decision relay

After a ruling (user for floor items; orchestrator for non-floor items, recorded with `⇢`):

```text
DECISION on your brief: {chosen option, verbatim constraints}

Proceed under this decision. It covers exactly this change; anything else on the ruling floor
still requires a new brief. Return the full report when finished.
```

---

## 7. Correction implementer

One agent, scoped to the final-review findings. Same rules as the implementer.

```text
You are the sole correction implementer for findings from a whole-branch final review. You may
change product code only for the listed findings. Do not commit, edit the plan, or clean up
unrelated code.

=== APPROVED PLAN ===
{path + relevant rulings}

=== FINDINGS (verbatim) ===
{anchored findings}

=== BRANCH AND BASELINE ===
{merged tree; pre-existing changes to preserve}

=== REQUIRED GATES ===
{affected checks, scheduled final gates, reusable evidence with tested state}

RULES
- Fix exactly the listed findings; do not redesign accepted sections or cross the ruling floor.
- A correction that needs an unruled floor change stops with STATUS: decision-needed.
- Every prose claim you touch follows the CLAIMS requirements. Apply the implementer's focused
  reproduction and targeted sensitivity rules; extend existing tests and fixtures first.
- Identify invalidated evidence, run the affected checks due now, and cite valid reused results.
  Keep broader gates at their scheduled stage; paste real output and identify the tested state.

Return:
STATUS: complete | blocked | decision-needed
DIFF: one line per file
RETIRES: actual files/exports/flags removed, or none — justified: additive work leaves no obsolete artifact,
  retained compatibility, or another concrete reason
FINDINGS RESOLVED: finding — evidence
CLAIMS: claim → anchor
GATE EVIDENCE: command + output + tested state; reused evidence reference or pending stage
TESTS RUN: suites, results, defect reproduction; targeted sensitivity checks if needed
EXIT TESTS: steps and observed results
DEFERRALS / RISKS / DECISION BRIEF: as applicable
```

Use the compact combined field above, or separate applicable `DEFERRALS`, `RISKS`, and
`DECISION BRIEF` labels.

For `STATUS: decision-needed`, provide a substantive decision brief either in a separate
`DECISION BRIEF` field or in the compact field; an empty or `none` brief is invalid. A complete
correction need not include a decision brief.

Validate the correction report before re-running final review:

```bash
node <skill-root>/assets/validate-report.mjs --kind correction --repo-root <repo> --input <report.md>
```

---

## 8. Plan topology reviewer

For plans over ~8 sections, or whenever the plan includes a data migration, a numbering or
identifier scheme, an external-world premise, or a limiter/quota change. Read-only, one agent.

```text
Perform a read-only structural and premise review of a goal-driven implementation plan. Do not
modify files, delegate, or review implementation code.

PLAN FILE: {path}

Read the plan's sources, topology, DEPENDS ON clauses, goals, rulings tables, gate budget,
preflight, known blockers, section blocks, and ledger. Check every class in
references/graph-analysis.md, and additionally:
- every file:line anchor resolves (run `node <skill-root>/assets/validate-report.mjs --kind
  anchors --repo-root <repo> --input <plan>` and read the errors); every named symbol, scope,
  column, or export exists as claimed
- every DEPENDS ON edge is buildable (no workspace cycle, no import in an impossible direction)
- every input clause reaches a section or the out-of-scope list
- every enforce/gate/block/redact section has a negative-space ruling
- every rejection exit test has a paired admission exit test measured on real client behavior
- every section that writes a new shared value has a reader-sweep entry
- the focused baseline has observed evidence; any broader baseline has a concrete risk or host
  requirement; final gates are explicitly scheduled and not misreported as already passed
- no section is L-sized; the invariant-inversion count justifies each section's size

Return:
VERDICT: APPROVE | REJECT
EVIDENCE: 2–8 plan anchors or graph node/edge ids — what each establishes
FINDINGS: none | class — node(s) — impact — required correction or mitigation
```
