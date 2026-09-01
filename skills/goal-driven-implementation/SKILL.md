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

A human ruling is required only when a change alters what a customer buys, integrates against,
or irreversibly receives. If the host repository declares its own floor (an ADR, a
`.ontology/escalate-floor.md`, an AGENTS.md rule), that declaration wins. Default floor:

1. **Money customers pay** — prices, rate cards, plan limits and quotas, credit thresholds and
   their semantics.
2. **The public integration contract** — public endpoints added, renamed, or removed; public
   request/response shapes; stable error codes; webhook signature schemes; the published SDK
   surface; documented customer-visible semantics. Closing an enforcement gap so behavior matches
   the documented promise is _not_ floor.
3. **Irreversible outward actions** — anything that reaches a real customer, publishes to a
   public surface, spends real money, or mutates production data.

Explicitly **not** floor, decide and record the rationale: internal schema and additive
migrations, internal state machines, module boundaries and fences, observability names and
metric labels, code comments, dashboard/BFF surfaces outside the public contract, dev-database
targets, rollout ordering the repository's deploy automation already guarantees, agent routing
fallbacks, PR shape, opening a PR. A silent decision is the violation, not an autonomous one:
record orchestrator rulings with `⇢` and a one-line rationale where the next reader will find them.

## Select a mode

- Existing plan for this feature → **EXECUTE**, resuming at the first eligible unchecked item.
- No plan → **PLAN**.
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

## PLAN mode

1. Read the inputs (roadmap, PRD, ADRs, issues) and the repository instruction files. Treat
   input claims as hypotheses: an issue's proposed fix, field names, and "already reverted" claims
   are verified against the tree during mapping, and corrections are recorded at the top of the
   plan under **Premise corrections**.
2. If the code is unfamiliar, fan out 2–4 read-only mappers (mapper template) and merge their
   returns. Mappers verify every anchor they report.
3. Instantiate `assets/plan-template.md` at `docs/plans/<slug>-plan.md` (follow host conventions).
   Fill every field. In particular:
   - **Global gate**: a real command, run once now. Default to the owning package's _full_ suite
     plus affected dependents (for example `turbo run test --affected`), never the section's own
     test subset — fail-closed registries in sibling packages are where post-merge fixes come from.
   - **Execution-environment preflight**: probe every capability _and_ smoke-run the environment
     path of every budgeted expensive gate once, or classify that gate `unproven`. Fill the
     **Known blockers** rows: every host/environment condition that has blocked this repository's
     gates before, with its pre-approved handling (runbook, container recipe, `NODE_ENV`, ports).
   - **Lifecycle gate budget**: columns `consumes / invalidated by`, `planned runs`
     (implementer and orchestrator counted separately), `actual runs` (filled at completion),
     `preflight`. Schedule the **cheapest real-client probe** (a browser page load, one journey leg,
     one live HTTP burst) before the first image build, not after.
   - **Rulings**: two tables. _Floor rulings_ the user owns (options + recommendation), including
     any new stable error code by exact string (or "none — reuse `<family>`"), and the **terminal
     action** (commit / push / PR / comment / deploy / none). _Recorded calls_ the orchestrator
     rules under the floor with rationale, user-vetoable. For any section whose verb is enforce,
     gate, block, redact, suspend, or pause, pre-rule the **negative space**: what must stay open,
     which wind-down paths stay reachable, which body-keyed surfaces carry the gated thing.
   - **Goals**: observable exit tests. Every clause that asserts something is _rejected_ gets a
     paired clause asserting legitimate use is _admitted_, measured on real client behavior (one
     page view, one honest burst), never a hand-picked count. A plan that changes a customer-facing
     flow gets one goal whose exit test is a scripted end-to-end walkthrough at the final-review gate.
   - **Sections**: one S/M vertical slice each. Size by invariant inversion — how many unstated
     assumptions the change falsifies — not by diff size. For any invariant a section changes,
     list its **writers** as deliberately as its readers.
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
   replacement), **plan as evidence** (every anchor resolves, every named symbol exists and is
   exported, every `DEPENDS ON` edge is buildable), **known blockers**. For plans over ~8 sections,
   fan the checklist out to one read-only reviewer as a second pair of eyes.
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
still resolve. Otherwise dispatch ≤2 mappers for the unanchored or stale items and merge.

**2. Implement.** One implementer, section block verbatim, context brief, global gate, preflight,
baseline, and the **Corrections in force** block (every factual correction accepted in earlier
sections of this plan). Keep its handle; all follow-ups resume the same agent. The implementer's
report carries a **CLAIMS** block: every prose assertion it added or changed (README, comment,
docs, OpenAPI description, evidence row) with the anchor that makes it true _at this commit_.

**3. Decisions.** `STATUS: decision-needed` with a brief that names a floor item → put the
options to the user, relay the ruling to the same agent. A brief that names a non-floor item →
rule it yourself, record `⇢` with rationale, relay. Never respawn an implementer mid-section; if
the agent is lost, record it and resume with a fresh one carrying the full prior report.

**4. Review.** Launch the applicable lenses in one message (templates in the prompts reference):
security/authz · data/migration · contract/API · failure-mode/reliability · convention/scope ·
**doc-truth** (every claim in the diff traced to code) · **capacity/false-positive** (only when the
diff touches a limiter, quota, timeout, or admission policy) · **evaluator soundness** (only for
journey/proof sections: a green run counts after fault injection turns it red). Rules: never fewer
than three lenses; `⚠` sections get the full set; keep security whenever tenancy, auth, limits,
resolvers, or hooks are touched; doc-truth always. Each returns APPROVE or REJECT with anchors;
approvals cite 2–5 anchors too. A reviewer can be wrong — refute a finding against the code and
record the refutation rather than implementing it.

**5. Verify yourself.** Re-run the global gate in the main session (owning package's full suite
plus affected dependents). A test the implementer authored but did not execute blocks acceptance.
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
   old binary × new schema during replacement. Findings go to one correction implementer scoped to
   the findings; commit additively; repeat until clean under the convergence rule.
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
- `assets/VERSION` — the skill release stamped into `gdi_version`.
- `assets/agents/claude/` and `assets/agents/codex/` — role definitions the harness references
  install.
- `references/agent-prompts.md` — mapper, implementer, reviewer lenses, final-review, rejection,
  decision relay, correction implementer, topology reviewer templates.
- `references/graph-analysis.md` — the full analysis checklist with the failure each class
  prevented.
- `references/routing-claude.md`, `references/routing-codex.md` — per-harness role resolution.
