---
name: goal-driven-implementation
description: Author, graph-review, and execute goal-driven implementation plans with a two-tier workflow that works in Claude Code and OpenAI Codex. The main session plans, analyzes the dependency, provenance, and lifecycle-gate topology, orchestrates, reviews, verifies, and commits without editing product code; exactly one implementer builds each plan section while read-only mappers and reviewers run in parallel; sections iterate through correction rounds until they converge; a whole-branch final review against current main runs before any expensive or outward gate. Use when the user asks to create an implementation plan from a roadmap, PRD, ADR, or issue; draw or review a plan topology graph; execute or resume a plan; run a /goal; orchestrate a multi-section build; dispatch the next section; or fix an issue end to end.
---

# Goal-Driven Implementation

The plan file is both the implementation contract and the progress ledger. Each section is one
vertical slice with its own goal, gates, acceptance clause, and commit. Every plan carries
`gdi_schema` and `gdi_version` frontmatter; the version is this skill's release
(`assets/VERSION`) so later retrospectives can correlate plan outcomes with skill revisions.

## Role contract

| Role                    | Who                            | May                                                                                                              | Must never                                                                                      |
| ----------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ORCHESTRATOR + REVIEWER | Main session                   | Read anything; write the plan and ledger; spawn and steer agents; re-run gates; commit accepted work             | Edit product source or product docs — every product change flows through an implementer         |
| IMPLEMENTER             | Exactly one per section        | Write code inside the active section; run gates and tests; spawn read-only helpers only where the harness allows | Touch future sections; commit; delegate writing; cross a ruling floor without an approved brief |
| MAPPER                  | Read-only agent                | Map code, tests, conventions, lifecycle couplings                                                                | Write files                                                                                     |
| REVIEWER                | Read-only agent, one lens each | Review one dimension with `file:line` evidence                                                                   | Write files                                                                                     |

Implementation is strictly sequential: one implementer alive at a time. Mapping and review fan
out in parallel within the harness thread cap.

**Harness routing.** Model, effort, and dispatch mechanics differ per harness and live in one
reference each — read the one for the harness you are running in before the first dispatch:

- Claude Code: `references/routing-claude.md` (pinned `gdi-*` agent definitions, `SendMessage`
  for follow-ups, implementer may spawn read-only helpers).
- Codex CLI: `references/routing-codex.md` (`goal-*` custom agents, `followup_task`, routing
  attestation, no nested spawns).

Resolve every role during preflight, **before** the approval surface is built, and record
`requested / role-confirmed / model-confirmed` per role in the plan. If the reviewer role cannot be
dispatched, use a generic read-only agent at the reviewer's effort. Main-session review of the
orchestrator's own dispatch is a last resort: record it as `review: self (<reason>)` in the ledger
and as an accepted risk in Graph Findings, and the whole-branch final review must then run with an
independent agent. If no independent reviewer can be obtained at all, stop and say so.

## Ruling floor

A human ruling is required only when a change alters what users pay for, what external parties
integrate against, or what happens irreversibly outside the repository. The default floor below
is written for a product with paying users and a public API; a library, a CLI, an internal tool,
or an infrastructure repository has a different one. If the host repository declares its own floor
(an ADR, an AGENTS.md rule, a dedicated escalation file), that declaration wins and the default is
not consulted. Default floor:

1. **Commercial terms** — anything that changes what users are charged or entitled to: prices,
   plan limits, quotas, thresholds and their semantics. Empty in a repository with no such surface.
2. **The public integration contract** — public endpoints added, renamed, or removed; public
   request/response shapes; stable error codes; signature or authentication schemes third parties
   implement; the published SDK, CLI, or library surface; documented externally visible semantics.
   Closing an enforcement gap so behavior matches the documented promise is _not_ floor.
3. **Irreversible outward actions** — anything that reaches a real user or third party, publishes
   to a public surface, spends real money, or mutates production data.

Explicitly **not** floor, decide and record the rationale: internal schema and additive
migrations, internal state machines, module boundaries and fences, observability names and
metric labels, code comments, internal UI or backend-for-frontend surfaces outside the public
contract, development-database targets, rollout ordering the repository's deploy automation
already guarantees, agent routing fallbacks, PR shape, opening a PR. A silent decision is the
violation, not an autonomous one: record orchestrator rulings with `⇢` and a one-line rationale
where the next reader will find them.

## Select a mode

- Existing plan for this feature → **EXECUTE**, resuming at the first eligible unchecked item.
- No plan → **PLAN**. Decide the lane first (**Bounded-fix lane** below) and record it in the
  plan; the full loop is the default.
- **Approval.** A plan whose analysis pass finds a floor item (any `⚠` section, any ruling in the
  floor table) waits for the user to rule on exactly those rulings. A plan with no floor item, in a
  repository that declares its ruling floor, starts EXECUTE immediately and posts the rendered graph
  and Graph Findings as its notification; the user can stop it at any section. In a repository with
  no declared floor, wait for approval.

Before resuming an older plan that lacks `gdi_schema: 2` surfaces, add the plan-only surfaces
(frontmatter, preflight, gate budget, rulings split, ledger schema, deferrals table) without
changing approved scope, contracts, or completed history, validate, and continue.

### Plan lifecycle

`status` is exactly one of `draft`, `approved`, `executing`, `implemented`, `verified`,
`shipped`, `verification_blocked`, `externally_deferred`, `superseded`, `abandoned`. Update it
when the transition occurs. Every intentionally remaining item is a typed deferral row (class,
risk, owner, **tracking issue or machine-checkable re-entry gate**, milestone it blocks).

## Bounded-fix lane

Most of this loop's cost is earned by multi-section work that writes into shared state. A change
that does none of that runs a proportionate loop instead. Eligibility is decided by what the
change touches, never by its line count: the reader-sweep class in
`references/graph-analysis.md` originated in small diffs into shared surfaces.

Eligible when every check holds after the orchestrator has read the code. Record the checks as
a Recorded call (`lane: bounded`, `⇢`) and put `lane: bounded` on the ledger row:

- One section, one vertical slice, one commit.
- Nothing on the ruling floor, default or declared.
- No new or widened value written into a shared column, enum, event type, registry, or any
  value read outside the owning package — nothing to reader-sweep. Structural evidence:
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
  retrospective reads. One section, one goal. Skip the mapper fan-out when the orchestrator can
  anchor every context item itself in one read. The graph is the minimal
  input → section → goal → PR chain. Graph analysis still runs; classes that cannot apply are
  recorded as `None` in one line each. Validate. Rendering is optional; the raw Mermaid in the
  message is enough.
- **EXECUTE.** No aggregation step. One implementer with the standard template. Two review
  lenses: convention/scope and doc-truth. The orchestrator re-runs the affected test subset named
  in the gate budget, reads the full diff, and applies the same seven checks and the same
  convergence rule.
- **COMPLETE.** The section review is the final review; no whole-branch fan-out. Re-baseline on
  `origin/main` and run the global gate (owning package's full suite plus affected dependents)
  once against the merged tree. Annotate, report.

## PLAN mode

1. Read the inputs (roadmap, PRD, ADRs, issues) and the repository instruction files. Treat
   input claims as hypotheses: an issue's proposed fix, field names, and "already reverted" claims
   are verified against the tree during mapping, and corrections are recorded at the top of the
   plan under **Premise corrections**.
2. Scout the repository first — no LLM call, one tree walk:
   `node <skill-root>/assets/scout-repo.mjs <repo> --out <plan-dir>/<slug>-feature-map.yml`.
   The map lists apps, feature slices, and shared kernels with the description each unit's own
   README gives it. Read it before mapping: it is the repository's vocabulary and its ownership
   structure. Then, if the code is unfamiliar, fan out 2–4 read-only mappers (mapper template),
   one per unit the inputs touch, named from the map, and validate each return with
   `validate-report.mjs --kind mapper` before merging. A flat repository (`features: 0`) maps as
   one unit. The map is a working file: list it under baseline exclusions unless host conventions
   keep generated plan artifacts.
3. Instantiate `assets/plan-template.md` at `docs/plans/<slug>-plan.md` (follow host conventions).
   Fill every field. In particular:
   - **Global gate**: a real command, run once now. Default to the owning package's _full_ suite
     plus affected dependents (the host's affected-tests command, whatever its toolchain), never
     the section's own test subset — fail-closed registries in sibling packages are where
     post-merge fixes come from.
   - **Execution-environment preflight**: probe every capability _and_ smoke-run the environment
     path of every budgeted expensive gate once, or classify that gate `unproven`. Fill the
     **Known blockers** rows: every host/environment condition that has blocked this repository's
     gates before, with its pre-approved handling (runbook, container recipe, inherited
     environment variables, ports).
   - **Lifecycle gate budget**: columns `consumes / invalidated by`, `planned runs`
     (implementer and orchestrator counted separately), `actual runs` (filled at completion),
     `preflight`. Schedule the **cheapest real-client probe** (a browser page load, one journey leg,
     one live HTTP burst) before the first expensive gate (image build, deploy), not after.
   - **Rulings**: two tables. _Floor rulings_ the user owns (options + recommendation), including
     any new stable error code by exact string (or "none — reuse `<family>`"), and the **terminal
     action** (commit / push / PR / comment / deploy / none). _Recorded calls_ the orchestrator
     rules under the floor with rationale, user-vetoable. For any section whose verb is enforce,
     gate, block, redact, suspend, or pause, pre-rule the **negative space**: what must stay open,
     which wind-down paths stay reachable, which body-keyed surfaces carry the gated thing.
   - **Goals**: observable exit tests. Every clause that asserts something is _rejected_ gets a
     paired clause asserting legitimate use is _admitted_, measured on real client behavior (one
     page view, one honest burst), never a hand-picked count. A plan that changes a user-facing
     flow gets one goal whose exit test is a scripted end-to-end walkthrough at the final-review gate.
   - **Sections**: one S/M vertical slice each. Size by invariant inversion — how many unstated
     assumptions the change falsifies — not by diff size. For any invariant a section changes,
     list its **writers** as deliberately as its readers. TARGET names the owning unit from the
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
   symbol exists and is exported, every `DEPENDS ON` edge is buildable), **known blockers**. For
   plans over ~8 sections, fan the checklist out to one read-only reviewer as a second pair of
   eyes.
6. Validate: `node <skill-root>/assets/validate-plan.mjs <plan-file>`. Fix errors; never waive
   them in prose.
7. Present graph-first: `node <skill-root>/assets/render-plan-graph.mjs <plan-file>`
   (`--no-open` when headless; the raw Mermaid goes in the message if the CDN is unreachable).
   Apply the approval rule from **Select a mode**. On approval or auto-start, set `status`,
   record the approval evidence, and re-validate.

## EXECUTE mode — per-section loop

Read `references/agent-prompts.md` before the first dispatch; use its templates verbatim.

**0. Preflight.** Validate the plan. Re-run environment probes when the SHA, worktree, realm,
services, credentials, or toolchain changed; record presence, never secret values. Resolve roles
per the harness reference and record the evidence. Set `status: executing` before the first
dispatch. Capture `git status` as the baseline; preserve unrelated changes. Pick the first
unchecked section whose `DEPENDS ON` are all checked. Confirm no implementer is alive.

**1. Aggregate.** Skip when the section's context items already carry `file:line` anchors that
still resolve (`validate-report.mjs --kind anchors` over the section block says so mechanically).
Otherwise dispatch ≤2 mappers for the unanchored or stale items, validate each return, apply the
follow-up rule from the prompts reference, and merge.

**2. Implement.** One implementer, section block verbatim, context brief, global gate, preflight,
baseline, and the **Corrections in force** block (every factual correction accepted in earlier
sections of this plan). Keep its handle; all follow-ups resume the same agent. The implementer's
report carries a **CLAIMS** block: every prose assertion it added or changed (README, comment,
docs, OpenAPI description, evidence row) with the anchor that makes it true _at this commit_.
Validate the report (`validate-report.mjs --kind implementer --repo-root <repo>`) before any
reviewer is dispatched; a hard error goes back to the same agent once.

**3. Decisions.** `STATUS: decision-needed` with a brief that names a floor item → put the
options to the user, relay the ruling to the same agent. A brief that names a non-floor item →
rule it yourself, record `⇢` with rationale, relay. Never respawn an implementer mid-section; if
the agent is lost, record it and resume with a fresh one carrying the full prior report.

**4. Review.** Launch the applicable lenses in one message (templates in the prompts reference):
security/authz · data/migration · contract/API · failure-mode/reliability · convention/scope ·
**doc-truth** (every claim in the diff traced to code) · **capacity/false-positive** (only when the
diff touches a limiter, quota, timeout, or admission policy) · **evaluator soundness** (only for
journey/proof sections: a green run counts after fault injection turns it red). Rules: never fewer
than three lenses outside the bounded-fix lane (which runs convention/scope and doc-truth); `⚠`
sections get the full set; keep security whenever tenancy, auth, limits, resolvers, or hooks are
touched; doc-truth always. Each returns APPROVE or REJECT with anchors and an evidence tag per
finding; approvals cite 2–5 anchors too. Validate each return (`--kind reviewer`). A reviewer can
be wrong — refute a finding against the code and record the refutation rather than implementing
it; a REJECT whose findings are all `evidence: inference` is verified by the orchestrator first
and reaches the implementer only with an upgraded tag or not at all.

**5. Verify yourself.** Re-run the global gate in the main session (owning package's full suite
plus affected dependents; in the bounded-fix lane, the affected subset named in the gate budget).
A test the implementer authored but did not execute blocks acceptance. A sensitivity check the
implementer reported is accepted on its pasted red output; do not repeat it.
Before trusting live or browser evidence, confirm the running stack is at or ahead of the section's
HEAD; a stale image invalidates the evidence, not the product. Read the full diff: scope, dead
code, test placement, claims. After any defect fix, grep for the same shape on sibling surfaces
and record hits under RISKS or as a filed issue.

**6. Accept or reject.** All seven checks: gate evidence re-run and green · required DB /
integration / e2e tests actually ran · no floor crossed without a ruling · acceptance maps to an
exit test · scope stayed inside the section · conventions followed · deferrals explicit, safe, and
tracked. Reject → resume the same implementer with exact gaps. **Convergence rule, not a round
cap:** in-contract rounds continue while findings shrink; stop and report when a round surfaces a
floor item, repeats a class the previous round was told to fix, or breaks the section boundary.
Environment retries are a separate lane (`⚙×n`) and never count as rounds. Accept → append the
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
   at HEAD, including pre-existing sentences the new claims sit beside; (f) **rollout window** —
   old binary × new schema during replacement. Validate each return (`--kind final`). Findings go
   to one correction implementer scoped to the findings; commit additively; repeat until clean
   under the convergence rule. In the
   bounded-fix lane the section review already served as the final review: skip the fan-out and
   run the global gate once against the merged tree.
3. **Expensive gates** — run each budgeted gate once against the reviewed candidate, in the
   budgeted order; record `actual runs`. A `>1.5×` overrun is a Graph Findings miss to name.
4. **Deferrals** — file the tracking issue for every deferral row that has none (`gh issue
create` or the host's equivalent) or give it a machine-checkable re-entry gate. A deferral with
   neither is a validation error.
5. **Status** — `verified`, `shipped`, `verification_blocked`, or `externally_deferred`.
6. **Annotate the graph from the ledger** — the validator refuses a graph whose marks disagree
   with the ledger. Marks: `✅` accepted · `🔁×n` rounds · `⚠→` a brief reached a human (note the
   ruling) · `⇢` orchestrator-ruled inside the floor · `⚙×n` environment retries · `✎` goal or scope
   amended at completion. Re-render and show it.
7. **Report** — sections and commits, planned vs actual per gate, tokens per section, Graph
   Findings confirmed / never fired / missed, deferrals with issue numbers, exit-test evidence.

## Resources

- `assets/plan-template.md` — plan skeleton (`gdi_schema: 2`).
- `assets/validate-plan.mjs` — strict structural validation; `--self-test`.
- `assets/render-plan-graph.mjs` — renders graphs, findings, budget, and ledger to HTML.
- `assets/scout-repo.mjs` — feature map of a repository (apps, features, shared kernels) with no
  LLM call; `--classify` maps changed paths to owning units; `--self-test`.
- `assets/validate-report.mjs` — structural check of mapper, reviewer, final-review, and
  implementer returns, and of anchors in any text; `--self-test`.
- `assets/VERSION` — the skill release stamped into `gdi_version`.
- `assets/agents/claude/` and `assets/agents/codex/` — role definitions the harness references
  install.
- `references/agent-prompts.md` — mapper, implementer, reviewer lenses, final-review, rejection,
  decision relay, correction implementer, topology reviewer templates.
- `references/graph-analysis.md` — the full analysis checklist with the failure each class
  prevented.
- `references/routing-claude.md`, `references/routing-codex.md` — per-harness role resolution.
