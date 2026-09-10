---
name: goal-driven-implementation
description: Author, graph-review, and execute goal-driven implementation plans with a two-tier workflow that works in Claude Code and OpenAI Codex. The main session plans, analyzes the dependency, provenance, and lifecycle-gate topology, orchestrates, reviews, verifies, and commits without editing product code; exactly one implementer builds each plan section while read-only mappers and reviewers run in parallel; sections iterate through correction rounds until they converge; a whole-branch final review against current main runs before any expensive or outward gate. Use when the user asks to create an implementation plan from a roadmap, PRD, ADR, or issue; draw or review a plan topology graph; execute or resume a plan; run a /goal; orchestrate a multi-section build; dispatch the next section; or fix an issue end to end.
---

# Goal-Driven Implementation

The plan file is both the implementation contract and the progress ledger. Each section is one
vertical slice with its own goal, gates, acceptance clause, and commit. Every plan includes
`gdi_schema` and `gdi_version` frontmatter; the version is this skill's release
(`assets/VERSION`) so later retrospectives can correlate plan outcomes with skill revisions.
Record the resolved skill root and source revision when available. An installed copy, repository
checkout, and runtime-loaded agent profile may differ; a release label alone cannot identify
unreleased edits. Follow the harness's routing check before attributing a run to a new profile.

## Role contract

| Role                    | Who                            | May                                                                                                                          | Must never                                                                                      |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| PLANNER + ORCHESTRATOR  | Main session                   | Read anything; write the plan and bounded task briefs; direct agents; assess reviews and gate evidence; commit accepted work | Edit product source or product docs — an implementer makes every product change                 |
| IMPLEMENTER             | Exactly one per section        | Write code inside the active section; run gates and tests; spawn read-only helpers only where the harness allows             | Touch future sections; commit; delegate writing; cross a ruling floor without an approved brief |
| MAPPER                  | Read-only agent                | Map code, tests, conventions, lifecycle couplings                                                                            | Write files                                                                                     |
| REVIEWER                | Read-only agent, one lens each | Review implemented code within one dimension with `file:line` evidence                                                       | Write files; design or approve plans                                                             |

The main-session planner owns structural and visual graph review. Code reviewers may use its
inspected graph as context for tracing implementation paths; a diagram is not implementation evidence.

Implementation is strictly sequential: only one implementer agent may exist at a time. Mappers and reviewers
run in parallel within the harness thread cap.

**Harness routing.** Model, effort, and dispatch mechanics differ per harness and are defined in one
reference each — read the one for the harness you are running in before the first dispatch:

- Claude Code: `references/routing-claude.md` (pinned `gdi-*` agent definitions, `SendMessage`
  for follow-ups, implementer may spawn read-only helpers).
- Codex CLI: `references/routing-codex.md` (`goal-*` custom agents, `followup_task`, routing
  attestation; ordinary workers do not spawn, with a bounded delegated-orchestrator exception).

Resolve every role during preflight, **before** preparing the plan for approval, and record
`requested / role-confirmed / model-confirmed` per role in the plan. If the reviewer role cannot be
dispatched, use a generic read-only agent at the reviewer's effort. Main-session review of the
orchestrator's own dispatch is a last resort: record it as `review: self (<reason>)` in the ledger
and as an accepted risk in Graph Findings, and the whole-branch final review must then run with an
independent agent. If no independent reviewer can be obtained at all, stop and say so.

The planner owns decomposition and resolves ambiguity before dispatch. A bounded brief names the
allowed files, observed mechanism, existing exemplar, invariants, acceptance checks, exclusions,
and applicable rulings; use the existing section fields rather than another planning document.
Include only context needed for that assignment. A detailed brief can still be wrong: workers
report contradicted premises, and reviewers independently trace the changed behavior. When a
worker struggles, diagnose the missing fact or narrow the assignment within the approved section
before considering a different model; follow the harness routing and convergence rules.

## Ruling floor

A human ruling is required only when a change alters what users pay for, what external parties
integrate against, or what happens irreversibly outside the repository. The default floor below
is written for a product with paying users and a public API; a library, a CLI, an internal tool,
or an infrastructure repository has a different one. If the host repository declares its own floor
(an ADR, an AGENTS.md rule, a dedicated escalation file), that declaration applies and the default is
not consulted. Default floor:

1. **Commercial terms** — anything that changes what users are charged or entitled to: prices,
   plan limits, quotas, thresholds and their semantics. Empty in a repository with no commercial terms.
2. **The public integration contract** — public endpoints added, renamed, or removed; public
   request/response shapes; stable error codes; signature or authentication schemes third parties
   implement; the published SDK, CLI, or library surface; documented externally visible semantics.
   Closing an enforcement gap so behavior matches the documented promise is _not_ floor.
3. **Irreversible outward actions** — anything that reaches a real user or third party, publishes
   to a public surface, spends real money, or mutates production data.

Explicitly **not** floor, decide and record the rationale: internal schema and additive
migrations, internal state machines, module boundaries and checks that enforce them, observability names and
metric labels, code comments, internal UI or backend-for-frontend surfaces outside the public
contract, development-database targets, rollout ordering the repository's deploy automation
already guarantees, agent routing fallbacks, PR structure, opening a PR. Record each orchestrator
decision with `⇢` and a one-line rationale in the plan's Recorded calls table.

## Select a mode

- Existing plan for this feature → **EXECUTE**, resuming at the first eligible unchecked item.
- No plan → **PLAN**. Decide the lane first (**Bounded-fix lane** below) and record it in the
  plan; the full loop is the default.
- **Approval.** A plan whose analysis pass finds a floor item (any `⚠` section, any ruling in the
  floor table) waits for the user to rule on exactly those rulings. A plan with no floor item, in a
  repository that declares its ruling floor, starts EXECUTE immediately and posts the rendered graph
  and Graph Findings as its notification; the user can stop it at any section. In a repository with
  no declared floor, wait for approval.

Before resuming an older plan that lacks `gdi_schema: 2` fields, add the plan-only fields
(frontmatter, preflight, gate budget, rulings split, ledger schema, deferrals table) without
changing approved scope, contracts, or completed history, validate, and continue.

### Plan lifecycle

`status` is exactly one of `draft`, `approved`, `executing`, `implemented`, `verified`,
`shipped`, `verification_blocked`, `externally_deferred`, `superseded`, `abandoned`. Update it
when the transition occurs. Every intentionally remaining item is a typed deferral row (class,
risk, owner, **tracking issue or machine-checkable re-entry gate**, milestone it blocks).

## Proportionate verification

- Define the defect mechanism and acceptance criteria before choosing tests. Extend existing
  suites and fixtures first. Each added test must establish a distinct behavior or failure mode;
  additional test infrastructure needs a concrete coverage gap, not a report-format obligation.
- For a defect fix, demonstrate a focused failure before the correction and a pass afterward
  when practical. An existing observed reproduction counts as before evidence. One reproduction
  can support several assertions about the same mechanism. If before evidence is impractical,
  record the reason and the alternative evidence; do not claim an unobserved failure.
- A mock or fake alone does not require a sensitivity check. Add one when there is a concrete
  concern that the double bypasses the changed path, an assertion is vacuous, or fault injection
  misses the intended boundary. Check for the expected behavioral failure, not a setup crash.
  Inject the relevant defect at the implementation boundary; making a test expectation wrong or
  adding an unconditional test failure does not demonstrate sensitivity to that defect.
  Use a local temporary edit or disposable fixture; never roll back applied state, revert
  committed work, or rebuild/redeploy a separate candidate solely to manufacture failing output.
- Run focused checks during implementation and the required broader checks against the final
  reviewed candidate. Preserve checks for auth/tenancy, persistence, concurrency, and public
  contracts where those guarantees depend on them. Explicit user and host-repository checks
  still apply at their required stage.
- Share evidence across implementer, reviewers, and orchestrator: command, result, tested
  source/worktree state, and relevant environment. Review that evidence before repeating work.
  A correction invalidates only checks whose source, tests, configuration, dependencies, or
  environment inputs changed. If validity is uncertain or a finding needs a probe, rerun the
  affected check. A new agent, report edit, or commit SHA alone does not invalidate evidence.
- For new or changed journey evaluators, verify that the relevant failure cannot produce a pass;
  target a faulty boundary when its detection is uncertain. Reuse valid evaluator evidence when
  exercising an unchanged harness; do not fault-inject every journey execution by default.

Apply this policy to unchecked work in older plans, preserving completed evidence and explicit
user or host requirements. Keep report labels and plan schema unchanged.

## Bounded-fix lane

The full workflow provides checks for multi-section work and changes to shared state. An isolated
change can use the shorter workflow below. Eligibility depends on what the change affects, never
its line count: the reader-sweep class in `references/graph-analysis.md` was added after small
diffs changed shared state without accounting for its readers.

Eligible when every check holds after the orchestrator has read the code. Record the checks as
a Recorded call (`lane: bounded`, `⇢`) and put `lane: bounded` on the ledger row:

- One section, one vertical slice, one commit.
- Nothing on the ruling floor, default or declared.
- No new or widened value written into a shared column, enum, event type, registry, or any
  value read outside the owning package — no cross-package reader check is needed. Structural evidence:
  `scout-repo.mjs <repo> --classify <paths the section will touch>` reports one owning unit and
  no shared kernel. Re-run it over `git diff --name-only` at accept time; a shared kernel or a
  second unit in the diff is a disqualifier.
- No migration; no auth, tenancy, or input-validation path; no limiter, quota, timeout, or
  admission policy; no public contract surface; no enforce, gate, block, or redact verb.
- The goal is provable with the owning package's tests: no image build, deploy, or live run in
  the gate budget.

Any check failing, or any doubt, means the full loop. A disqualifier found mid-lane (an
implementer's WRITERS, SIBLINGS, or RISKS line, a reviewer finding) ends the lane: record it,
keep every accepted artifact, and continue under the full loop from the current state. Nothing
is redone.

Inside the lane:

- **PLAN.** The plan file is still written from the template: it is the ledger and the record a
  retrospective reads. One section, one goal. Skip mapper dispatch when the orchestrator can
  anchor every context item itself in one read. The graph is the minimal
  input → section → goal → PR chain. Graph analysis still runs; classes that cannot apply are
  recorded as `None` in one line each. Validate. Rendering is optional; the raw Mermaid in the
  message is enough.
- **EXECUTE.** No aggregation step. One implementer with the standard template. Two review
  lenses: convention/scope and doc-truth. The orchestrator verifies the affected test evidence
  named in the gate budget, reads the full diff, and applies the same seven checks and the same
  convergence rule.
- **COMPLETE.** The section review is the final review; no separate whole-branch review. Re-baseline on
  `origin/main` and verify the global gate (owning package's full suite plus affected dependents)
  against the merged tree, reusing evidence only if its inputs remain valid. Annotate, report.

## PLAN mode

1. Read the inputs (roadmap, PRD, ADRs, issues) and the repository instruction files. Treat
   input claims as hypotheses: an issue's proposed fix, field names, and "already reverted" claims
   are verified against the tree during mapping, and corrections are recorded at the top of the
   plan under **Premise corrections**.
2. Scout the repository first — no LLM call, one tree walk:
   `node <skill-root>/assets/scout-repo.mjs <repo> --out <plan-dir>/<slug>-feature-map.yml`.
   The map lists apps, feature slices, and shared kernels with the description each unit's own
   README gives it. Read it before mapping: it is the repository's vocabulary and its ownership
   structure. Then, if the code is unfamiliar, dispatch 2–4 read-only mappers (mapper template),
   one per unit the inputs touch, named from the map, and validate each return with
   `validate-report.mjs --kind mapper` before merging. A flat repository (`features: 0`) maps as
   one unit. The map is a working file: list it under baseline exclusions unless host conventions
   keep generated plan artifacts.
3. Instantiate `assets/plan-template.md` at `docs/plans/<slug>-plan.md` (follow host conventions).
   Fill every field. In particular:
   - **Global gate**: name the final verification command: the owning package's _full_ suite
     plus affected dependents, including fail-closed registries in other packages. Establish a
     focused baseline or reproduction, reusing valid evidence when available; run a broader
     baseline only for a concrete risk or host rule. Record the baseline's scope separately
     from the scheduled final gate.
   - **Execution-environment preflight**: probe every capability _and_ smoke-run the environment
     path of every budgeted expensive gate once, or classify that gate `unproven`. Fill the
     **Known blockers** rows: every host/environment condition that has blocked this repository's
     gates before, with its pre-approved handling (runbook, container recipe, inherited
     environment variables, ports).
     Use a cheap representative command in the actual gate realm with its canonical cwd, mounts,
     cache paths, dependency outputs, and environment mode. A host-level tool/version check does
     not establish that a container or another shell can run the gate. Record setup failures
     separately from behavioral failures and do not count zero collected tests as coverage.
   - **Lifecycle gate budget**: columns `consumes / invalidated by`, `planned runs`
     (assign each run to an executor; no duplicate run solely for another role), `actual runs`
     (filled at completion), `preflight`. Schedule the **cheapest real-client probe** (a browser
     page load, one user-flow step, one live HTTP burst) before the first expensive gate
     (image build, deploy), not after.
     Name tracked generated artifacts and their canonical refresh/check commands, including
     graphs that index test imports and inventories affected by file moves. Schedule refresh
     after their last invalidating edit and before the review and broad gate that consume them.
   - **Rulings**: two tables. _Floor rulings_ the user owns (options + recommendation), including
     any new stable error code by exact string (or "none — reuse `<family>`"), and the **terminal
     action** (commit / push / PR / comment / deploy / none). _Recorded calls_ the orchestrator
     rules under the floor with rationale, user-vetoable. For any section whose verb is enforce,
     gate, block, redact, suspend, or pause, pre-rule the **negative space**: operations that must
     remain available, paths needed to finish or stop existing work, and routes whose request
     bodies identify or contain restricted resources or operations.
   - **Goals**: observable exit tests. Every clause that asserts something is _rejected_ gets a
     paired clause asserting legitimate use is _admitted_, measured on real client behavior (one
     page view, one legitimate request burst), never an arbitrary count. A plan that changes a
     user-facing flow gets one goal whose exit test is a scripted end-to-end walkthrough at the
     final-review gate.
     For consolidation or reduction work, name what will be retired, which callers adopt the
     replacement, and what must remain. Measure the same inventory before and after, separating
     product changes from tests, plans, and generated output. Adding a shared helper is an
     intermediate result when the requested outcome is removal of duplication. Preserve distinct
     behavior checks; a shared fixture does not prove that each caller uses it correctly.
   - **Sections**: one S/M vertical slice each. Size by invariant inversion — how many unstated
     assumptions the change falsifies — not by diff size. For any invariant a section changes,
     list its **writers** as well as its readers. TARGET names the owning unit from the
     feature map; a section that writes into a shared kernel says so there.
   - **Base drift policy**: when to re-baseline on `origin/main` and what happens if a stacked
     predecessor merges.
4. Draw the topology graph (conventions in the template). Every section sits on a full
   input → section → goal path; every input reaches a section; the graph, `DEPENDS ON`, ledger,
   and linear order agree.
5. Run the graph analysis pass — the full checklist with worked examples is in
   `references/graph-analysis.md`; read it. Fix what can be fixed by restructuring; record the rest
   under `### Graph Findings` as named accepted risks with mitigations. The classes that most often
   went unchecked in practice: **reader sweep** (a widened shared value, enum, event type, or
   registry — enumerate every reader), **co-tenant load** (a re-scoped limiter, queue, or table —
   name every existing client and its per-interaction request count), **partially consumed input**
   (every clause of an input reaches a section or the out-of-scope list), **unruled semantics**
   (enforce/gate verbs without a negative-space ruling), **data-path reachability** (what writes
   this data in production — a seed is not a rollout), **constraint admissibility** (which CHECKs,
   triggers, allowlists filter a widened column), **rollout window** (old binary × new schema during
   replacement), **plan as evidence** (every anchor resolves — run
   `validate-report.mjs --kind anchors --input <plan-file> --repo-root <repo>` — every named
   symbol exists and is exported, every `DEPENDS ON` edge is buildable), **known blockers**.
   The planner checks this analysis against the rendered graph in step 8.
6. Validate: `node <skill-root>/assets/validate-plan.mjs <plan-file>`. Fix errors; never waive
   them in prose.
7. Render the generated Mermaid: `node <skill-root>/assets/render-plan-graph.mjs <plan-file>
   --no-open`. Open the resulting HTML with an available browser tool, wait for Mermaid to finish,
   and capture readable screenshots of every graph. The script generates HTML, not screenshots.
   Keep renders and images outside tracked plan files. Follow **Rendered graph inspection** in
   `references/graph-analysis.md` for capture, the visual checklist, and unavailable-tool handling.
8. The main-session planner visually inspects the rendered graphs before presenting the plan.
   Actually open the screenshots with image-viewing tools or supported image input, examine the
   visible paths and layout, then compare them with the Mermaid and plan. Follow **Rendered graph
   inspection** in `references/graph-analysis.md`; source review alone cannot complete this step.
   This is planner work, not a `gdi-reviewer`/`goal-reviewer` dispatch or a new planner child.
   Fix concrete findings, update Graph Findings, and re-validate, re-render, and re-inspect affected
   graphs after corrections.
   Record unavailable visual inspection explicitly; never turn missing images into an approval.
9. Present the inspected graph and Graph Findings. If rendering is unavailable, show raw Mermaid
   and the inspection limitation; raw code is not visual evidence.
   Apply the approval rule from **Select a mode**. On approval or auto-start, set `status`,
   record the approval evidence, and re-validate.

## EXECUTE mode — per-section loop

Read `references/agent-prompts.md` before the first dispatch; use its templates verbatim.

**0. Preflight.** Validate the plan. Re-run affected environment probes when their worktree,
realm, service, credential, or toolchain inputs changed; record presence, never secret values.
Resolve roles per the harness reference and record the evidence. Set `status: executing` before
the first dispatch. Capture `git status` as the baseline; preserve unrelated changes. Pick the first
unchecked section whose `DEPENDS ON` are all checked. Confirm no implementer agent exists.

**1. Aggregate.** Skip when the section's context items have verified anchors and the relevant
symbols and behavior have not changed since mapping. `validate-report.mjs --kind anchors` checks
file and line existence only; re-read changed context and its defining search before reusing it.
Otherwise dispatch ≤2 mappers for the unanchored or stale items, validate each return, apply the
follow-up rule from the prompts reference, and merge.

**2. Implement.** Check that the bounded brief above is actionable. Send one implementer the
section block verbatim, context brief, global gate, preflight,
baseline, and the **Corrections in force** block (every factual correction accepted in earlier
sections of this plan). Keep its handle; all follow-ups resume the same agent. The implementer's
report includes a **CLAIMS** block: every prose assertion it added or changed (README, comment,
docs, OpenAPI description, evidence row) with the anchor that makes it true _at this commit_, and
a **RETIRES** block that names artifacts removed or explains why none was retired, such as
additive work with no obsolete artifact or retained compatibility. Validate the report
(`validate-report.mjs --kind implementer --repo-root <repo>`) before any reviewer is dispatched;
a hard error goes back to the same agent once.

**3. Decisions.** `STATUS: decision-needed` with a brief that names a floor item → put the
options to the user, relay the ruling to the same agent. A brief that names a non-floor item →
rule it yourself, record `⇢` with rationale, relay. Never respawn an implementer mid-section; if
the agent is lost, record it and resume with a new one given the full prior report.

**4. Review.** Launch the applicable lenses in one message (templates in the prompts reference):
security/authz · data/migration · contract/API · failure-mode/reliability · convention/scope ·
**doc-truth** (every claim in the diff traced to code) · **capacity/false-positive** (only when the
diff touches a limiter, quota, timeout, or admission policy) · **evaluator soundness** (only for
journey/proof sections, using the proportionate-verification policy). Rules: never fewer
than three lenses outside the bounded-fix lane (which runs convention/scope and doc-truth); `⚠`
sections get the full set; keep security whenever tenancy, auth, limits, resolvers, or hooks are
touched; doc-truth always. Each returns APPROVE or REJECT with anchors and an evidence tag per
finding; approvals cite 2–5 anchors too. Validate each return (`--kind reviewer`). A reviewer can
be wrong — refute a finding against the code and record the refutation rather than implementing
it; a REJECT whose findings are all `evidence: inference` is verified by the orchestrator first
and reaches the implementer only with an upgraded tag or not at all.
For section or final reviews where cross-section dependencies, shared-state paths, or integration
gates matter, include a relevant part of the planner-inspected graph as optional context using the
review prompt's GRAPH CONTEXT field. Reuse the existing images; do not require a new render or a
diagram for every review. Findings still need code/test evidence within the assigned lens.

**5. Verify evidence.** Review the section's commands, results, tested worktree state, and relevant
environment. Run missing or invalidated section checks; do not repeat valid runs because another
agent executed them. New or changed tests due at this stage must actually run. Later-stage tests
and broader gates stay pending until due and block plan completion until passed. Before trusting
live or browser evidence, confirm the running stack includes the tested changes and matching
relevant inputs. Read the full
diff: scope, dead code, test placement, claims. After any defect fix, search for the same defect
pattern elsewhere in the repository and record hits under RISKS or as a filed issue.

**6. Accept or reject.** All seven checks: section gate evidence valid and passing · required section
DB / integration / e2e tests actually ran · no floor crossed without a ruling · acceptance maps to an
exit test · scope stayed inside the section · conventions followed · deferrals explicit, safe, and
tracked. Reject → resume the same implementer with exact gaps. **Convergence rule:** in-contract
rounds continue while unresolved findings decrease; stop and report when a round identifies a
floor item, repeats a class the previous round was told to fix, or breaks the section boundary.
Record environment retries separately (`⚙×n`); they never count as rounds. Accept → append the
ledger record (schema in the template: sha, `rounds: n` with one `R<n> <class>: <reason>` line
per round, `review:`, `routing:`, `cost:`), stage the section diff **and** the ledger change
together, commit with the section's message. Add any accepted factual correction to
**Corrections in force**. Loop to step 0.

## Complete the plan

When every section is checked:

1. **Re-baseline.** Merge or rebase onto current `origin/main` per the plan's base-drift policy.
   The final review reads the merged tree, not `base...HEAD` alone.
2. **Final review** — 2–3 read-only reviewers in one message over the full branch, integration
   lenses: (a) cross-section seams and late obligations — for every seam a later section
   introduced, enumerate all call sites and prove each satisfies it; (b) whole-surface contract and
   conformance coherence; (c) plan conformance, deferral validation (each deferral still reachable
   and still needed), debris; (d) **reader sweep of the diff's complement** — every value this
   branch writes into a shared column, enum, event type, or registry, checked against every reader
   in the repository; (e) **claim decay** — every claim written by an earlier section re-verified
   at HEAD, including adjacent pre-existing sentences; (f) **rollout window** —
   old binary × new schema during replacement. Validate each return (`--kind final`). Findings go
   to one correction implementer scoped to the findings; validate its report with
   `validate-report.mjs --kind correction --repo-root <repo>` before re-running final review; commit
   additively; repeat until clean under the convergence rule. In the
   bounded-fix lane the section review already served as the final review: skip the separate review.
3. **Final gates** — establish passing global and budgeted gate evidence for the reviewed candidate
   in the budgeted order. Reuse valid results; run missing or invalidated checks once and record
   `actual runs`. Record any `>1.5×` overrun as a missed finding in Graph
   Findings.
4. **Deferrals** — file the tracking issue for every deferral row that has none (`gh issue
create` or the host's equivalent) or give it a machine-checkable re-entry gate. A deferral with
   neither is a validation error.
5. **Status** — `verified`, `shipped`, `verification_blocked`, or `externally_deferred`.
6. **Annotate the graph from the ledger** — the validator refuses a graph whose marks disagree
   with the ledger. Marks: `✅` accepted · `🔁×n` rounds · `⚠→` a brief reached a human (note the
   ruling) · `⇢` orchestrator-ruled inside the floor · `⚙×n` environment retries · `✎` goal or scope
   amended at completion. Re-render and show it.
7. **Report** — sections and commits, planned vs actual per gate, available usage per section, Graph
   Findings confirmed / did not occur / missed, deferrals with issue numbers, exit-test evidence.
   Attribute available usage to planning/mapping/implementation/review and correction rounds;
   include main-session overhead. Use `unknown` for unavailable counters or prices. Tokens alone
   do not establish monetary cost across models; compare total cost per accepted section together
   with rework and escaped defects before claiming a routing improvement paid off.

## Resources

- `assets/plan-template.md` — plan skeleton (`gdi_schema: 2`).
- `assets/validate-plan.mjs` — strict structural validation; `--self-test`.
- `assets/render-plan-graph.mjs` — renders graphs, findings, budget, and ledger to HTML.
- `assets/scout-repo.mjs` — feature map of a repository (apps, features, shared kernels) with no
  LLM call; `--classify` maps changed paths to owning units; `--self-test`.
- `assets/validate-report.mjs` — structural check of mapper, reviewer, final-review, implementer,
  and correction returns, and of anchors in any text; `--self-test`.
- `assets/VERSION` — the skill release stamped into `gdi_version`.
- `assets/agents/claude/` and `assets/agents/codex/` — role definitions the harness references
  install.
- `assets/agents/codex/goal-implementer.toml` — Codex implementation role; model and effort are
  configuration, independent of its name.
- `references/agent-prompts.md` — mapper, implementer, reviewer lenses, final-review, rejection,
  decision relay, and correction implementer templates; optional graph context for code review.
- `references/graph-analysis.md` — structural and rendered-image inspection checklists, capture
  and correction procedure, and the failure each class prevented.
- `references/routing-claude.md`, `references/routing-codex.md` — per-harness role resolution.
