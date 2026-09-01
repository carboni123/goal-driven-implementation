---
name: goal-driven-implementation
description: Author, graph-review, and autonomously execute goal-driven implementation plans with a Codex-native two-tier workflow. The main session plans, analyzes dependency, provenance, and build/deployment-invalidation topology, orchestrates, reviews, verifies, and commits without editing product code; one sequential worker implements each plan section while read-only explorers and reviewers may run in parallel, and approved sections iterate through correction rounds until acceptance. Use when the user asks to create an implementation plan from a roadmap, PRD, ADR, or issue; draw or review a plan topology graph; execute or resume a plan; run a Codex /goal; orchestrate a multi-section build; or dispatch the next section.
---

# Goal-Driven Implementation

Use a plan file as both the implementation contract and progress ledger. Define each section
as one vertical slice with its own goal, gates, acceptance clause, and commit.

## Role contract

| Role | Codex agent | May | Must never |
|---|---|---|---|
| ORCHESTRATOR + REVIEWER | Main session; prefer `gpt-5.6-sol` at `max` | Read anything; write the plan and ledger; spawn/steer agents; re-run gates; commit accepted work | Edit product source code |
| IMPLEMENTER | Exactly one worker or custom implementer agent per section | Write code within the active section; run gates and tests | Touch future sections; commit; spawn subagents; cross a contract floor without approval |
| EXPLORER | Built-in `explorer` or equivalent read-only agent | Map code, tests, and conventions | Write files |
| FOCUSED REVIEWER | Read-only reviewer agent | Review one risk dimension with `file:line` evidence | Write files |

Implementation is strictly sequential: exactly one implementer may be active. Run independent
exploration and review tasks in parallel only when agent slots permit. Respect the runtime's
thread cap; the root session consumes one slot.

Keep the main Sol session as the sole orchestrator by default. Do not spawn a Sol peer merely to
plan, reason, or review. Permit a delegated Sol orchestrator only when the runtime explicitly
confirms that child can spawn and steer its own Terra subagents, the plan assigns it a bounded
multi-section subtree, and agent slots support the nested fan-out. It must not edit product code,
accept sections, or commit; final acceptance remains with the main session.

## Model routing

Read `references/model-routing.md` when configuring agents or choosing the implementer profile.

- Keep `gpt-5.6-sol` at `max` for the main planning/orchestration session; it is not a spawned
  worker.
- Route every implementation section through `goal-implementer-terra` using `gpt-5.6-terra` at
  `xhigh`. Do not dispatch a Sol implementation agent.
- Prefer Terra at `medium` for exploration and Terra at `high` for focused review.
- Keep every ordinary spawned role on Terra. The sole Sol-child exception is a genuine delegated
  orchestrator satisfying the role contract above; never use one as an implementer or reviewer.
  If a section is too ambiguous or risky for the Terra implementer, narrow the section or stop for
  a user decision instead of escalating to a Sol worker.
- Keep requested routing, confirmed role, and confirmed model/effort as separate facts. Confirm a
  role only from declared spawn parameters plus tool/runtime metadata or a profile-only
  attestation. Confirm model/effort only from tool/runtime metadata. A successful spawn, task name,
  or child self-description is not sufficient evidence.

### Routing mechanics

Spawned agents are forks of the parent session and inherit its model and reasoning effort unless a
declared override is actually honored. Registered-role routing requires all of:

1. The `multi_agent_v2` feature enabled in `~/.codex/config.toml`.
2. Each role registered there under `[agents.<name>]` with `config_file` pointing at its role
   TOML (templates in `assets/codex-agents/`; on Codex 0.144.6 role files must define non-empty
   `name` and `description` values plus config-style keys).
3. Dispatching with `agent_type: "<role>"` and a bounded fork (`fork_turns: "none"` or a small
   integer). Do not use a full-history fork for a spawned role: `fork_turns: "all"` inherits the
   Sol main-session route and cannot carry routing overrides.

Use the verification protocol in `references/model-routing.md` before the first production
dispatch. Never send routing keys absent from the current spawn schema; a client may ignore unknown
keys while still returning success. If feature or role configuration changed after the session
started, reload the session and inspect the new schema.

Fallback ladder — use the first declared and verified level the surface supports. Record the
requested route plus separate role/model evidence and the fallback actually used in the progress
ledger:

1. `agent_type` referencing the registered Terra role.
2. Direct `model: "gpt-5.6-terra"` + `reasoning_effort` override at the role's required effort.

If neither Terra route is available, stop before spawning. Do not inherit the Sol main-session
model as a fallback. The main session may perform read-only exploration or review locally while
routing is unavailable, but it must not edit product code.

Before resuming an older approved plan, replace only unchecked `goal-implementer-sol` assignments
with `goal-implementer-terra` at `xhigh`. Preserve completed historical routing entries and do not
change section scope or acceptance criteria.

Do not install or overwrite the user's agent configuration without permission.

## Select a mode

- Existing plan for the feature: **EXECUTE**, starting at the first eligible unchecked item.
- No plan: **PLAN**, obtain user approval, then execute only after approval.

Before resuming an older approved plan that lacks the topology graph, Graph Findings, lifecycle
gate budget, whole-branch final-review gate, or `gdi_schema: 1` control frontmatter, add those
plan-only surfaces without changing its approved scope, contracts, completed history, or section
acceptance clauses. Classify its current lifecycle state and existing deferrals, validate it with
`assets/validate-plan.mjs`, then analyze and present the migrated topology for user approval before
the next product-code dispatch. Do not rewrite completed historical plans merely to make the
corpus uniform.

### Plan lifecycle

Every new or resumed plan uses `gdi_schema: 1` frontmatter and exactly one status:

- `draft`: still being authored; approval may remain pending.
- `approved`: the user approved the contract, but implementation has not started.
- `executing`: at least one section is in flight or accepted and more source work remains.
- `implemented`: every implementation section is accepted, but required approved-scope gates remain.
- `verified`: every approved-scope goal exit test is green; shipping was not in scope or is separate.
- `shipped`: approved deployment and post-deploy/live exit tests are complete.
- `verification_blocked`: implementation is accepted but a required verification gate cannot run
  because the execution environment is invalid or unavailable.
- `externally_deferred`: a remaining approved goal needs separate authority or external-state change.
- `superseded` or `abandoned`: terminal disposition with the reason recorded in `## Deferrals`.

Update the status when the transition occurs, not retrospectively at handoff. An unchecked item is
not self-explanatory: every intentionally remaining item must have a typed deferral with class
(`coverage`, `environment`, `external-authority`, or `product-scope`), risk, owner or issue, re-entry
gate, and the milestone it blocks (`implemented`, `verified`, `shipped`, or `none`).

## PLAN mode

1. Read the roadmap, PRD, ADRs, issues, and applicable `AGENTS.md` files.
2. If the affected code is unfamiliar, spawn 2-4 independent read-only explorers, bounded by
   available slots. Wait for them and merge their results.
3. Instantiate `assets/plan-template.md` at `docs/plans/<slug>-plan.md`, following repository
   documentation conventions when present.
4. Fill every field, including `gdi_schema`, lifecycle status, approval, the execution-environment
   preflight, approval-time contract rulings for every `⚠` section, and deferrals. Define observable goals, S/M vertical sections, dependencies, the
   Terra implementer profile per section, a checkbox ledger, and a budget for expensive or mutating
   lifecycle gates. Choose a real global gate and run it once before recording it. Classify the
   preflight as `ready`, `known-baseline-red`, or `invalid-environment`; record `pending` only while
   authoring. A known baseline red is usable only when it is reproducible, unrelated to the planned
   diff, and paired with a narrower real green global gate.
5. Draw the Mermaid topology graph in the plan:
   - Create one stadium node per scope-justifying input (issue, PRD clause, or explicit request)
     and connect it by dashed provenance edges to the sections that serve it.
   - Create one node per section, grouped by phase. Use solid edges for hard dependencies and
     dashed edges for soft ordering. Suffix `⚠` on sections likely to cross a contract floor.
   - Create explicit nodes for lifecycle outputs and gates whose repetition matters: generated
     credentials/config, schema migration, package/image build, deployment, destructive bootstrap,
     and live end-to-end verification. Connect every producer or invalidator to the gate it affects
     and label the intended run count, such as `build/deploy ×1`.
   - Classify each config or credential as a build input, runtime/container input, or external-state
     prerequisite. Do not turn a container recreation into an image-rebuild edge. If startup
     normally performs a prerequisite such as migration, model that prerequisite as its own gate
     when the approved operations contract permits running it separately.
   - Distinguish cheap/local verification from expensive, externally mutating, or
     invalidation-sensitive verification. Run cheap gates when ready; place a lifecycle gate only
     after every input that would force it to run again, unless an earlier run has an explicit
     risk-reduction justification in the gate budget.
   - Create one diamond per goal exit-test gate. Put the whole-branch source/diff review on every
     path to PR/handoff and before any external or mutating lifecycle gate that its corrections
     would invalidate. Put live goal gates after the deployment they observe.
   - Put every section on a complete input → section → goal path. Every input must reach a section,
     and every goal must have an incoming implementation or verification path.
   - Keep the graph, `DEPENDS ON` clauses, goal checkboxes, ledger, and recommended linear order
     identical in meaning. The linear order must be a valid topological order that also honors the
     lifecycle gate budget, not merely a section list.
6. Analyze the graph before presenting it. Fix the topology now or record the finding and
   mitigation in `### Graph Findings`; record resolved findings too so the review is auditable.
   Check at least:
   - **Orphan section**: no path to a goal; re-scope or remove it.
   - **Unanchored section**: no input feeds it; name the requirement or remove it.
   - **Unreachable goal**: no incoming path; add missing work or remove the goal.
   - **Dropped input**: reaches no section; cover it or defer it explicitly.
   - **Gateless handoff or lifecycle mutation**: a path reaches PR/handoff without whole-branch
     review, or code reaches an external/mutating gate before a review that can still invalidate it.
   - **Convergence bottleneck**: at least three hard edges enter one node; sequence it after its
     independently verified inputs, describe integration pressure, or split it.
   - **Unruled contract risk**: a `⚠` section lacks a matching pre-ruling in the plan's
     approval-time contract rulings (its decision table).
   - **Misplaced verification gate**: a cheap/local check is delayed behind unrelated work, or an
     expensive/mutating check runs before a later input will invalidate it. Move cheap feedback
     earlier and move rebuild/deploy/live gates after their final invalidating input.
   - **Repeated lifecycle gate**: the order causes avoidable duplicate builds, migrations,
     credential rotations, deployments, external calls, or live end-to-end runs. Add the missing
     producer → gate edges and choose the lowest-run topological order consistent with safety.
   - **Wrong invalidation boundary**: runtime env/config is mistaken for an image build input, or a
     build artifact is mistaken for runtime-only state. Correct the edge and distinguish build,
     container recreation/deployment, and live evidence.
   - **Implicit startup coupling**: a migration or bootstrap prerequisite is hidden inside service
     startup, making a preliminary deployment appear necessary. Extract and order that gate
     separately when repository operations and rollback contracts allow it.
   - **Conflated implementation and rollout dependency**: a section-level `DEPENDS ON` claims code
     cannot be implemented until another section, when only its deployment/bootstrap action has
     that prerequisite. Split the implementation output from the rollout gate so safe work can be
     ordered without manufacturing extra deployments.
   - **False or long blocking chain**: a preference is drawn as a hard edge, or at least four
     sections form one hard chain. Demote preference-only edges and identify the earliest prefix
     that still delivers independently verifiable value.
   - **Cycle**: section dependencies must be acyclic. Only the in-contract per-section correction
     loop and whole-branch final-review correction loop may cycle.
   For plans with more than about eight sections, give the graph and plan to one read-only reviewer
   agent using the plan-topology template in `references/agent-prompts.md`; the main session still
   owns the final analysis.
7. Validate the plan before presenting it and again after any approval-time correction:

   ```bash
   node <skill-root>/assets/validate-plan.mjs <plan-file>
   ```

   The validator is strict for `gdi_schema: 1` plans: it checks required control surfaces,
   section/ledger/dependency parity, dependency cycles, graph membership, preflight classification,
   and lifecycle-state consistency. Fix validation errors; never waive them in prose.
8. Present the plan for approval graph-first. Run:

   ```bash
   node <skill-root>/assets/render-plan-graph.mjs <plan-file>
   ```

   This renders every Mermaid block, the lifecycle gate budget, Graph Findings, and ledger into one
   HTML page and attempts to open it. In a headless or remote session use `--no-open`, provide a
   clickable link to the HTML, and include the topology Mermaid block, lifecycle gate budget, and
   Graph Findings directly in the approval response. If the Mermaid CDN is unavailable, show the
   raw Mermaid block rather than hiding the graph. The user must review the lifecycle status,
   preflight classification, topology, findings, lifecycle gate budget, contract risks, section
   boundaries, and model-routing policy. On approval, record the approval evidence, set status to
   `approved`, and re-run validation. Do not begin EXECUTE until they approve.

## EXECUTE mode

Read `references/agent-prompts.md` before the first dispatch and use its templates.

### 0. Preflight

1. Read the plan and applicable repository instructions, then run
   `node <skill-root>/assets/validate-plan.mjs <plan-file>`. Stop before product edits on any
   validation error.
2. Re-run the plan's execution-environment probes when the candidate SHA, worktree, execution realm,
   required services, credentials, or toolchain changed. Record only presence/reachability, never
   secret values. Dispatch is allowed only for `ready`, or for `known-baseline-red` under its
   recorded narrower-green-gate condition. `pending` or `invalid-environment` stops dispatch.
3. Set the plan status to `executing` immediately before the first implementation dispatch. Pick the
   first unchecked section whose dependencies are checked.
4. Inspect `git status` and capture a baseline. Preserve unrelated user changes. Stop only when
   existing changes overlap the section or prevent an unambiguous review/commit.
5. Confirm no other implementation agent is active.
6. Resolve `goal-implementer-terra` at `xhigh`. Migrate an unchecked legacy Sol assignment as
   described above. Record requested routing, role-confirmation evidence, and model/effort-
   confirmation evidence separately. Stop before product edits when the Terra route is unconfirmed.

### 1. Aggregate

Spawn one read-only explorer per independent `CONTEXT TO AGGREGATE` item when useful. Use as
many parallel agents as available slots permit and batch the rest. Wait for all explorers,
then merge their results into one deduplicated context brief with `file:line` anchors. Skip
this step for trivial sections.

### 2. Implement

Spawn exactly one implementer for the section, using the section's verified implementer profile via
a declared `agent_type` with `fork_turns: "none"`, or an explicitly authorized fallback (see
Routing mechanics). Pass the section block verbatim, the merged context brief, the global gate, the
execution-environment preflight, the baseline, and the implementer template. Keep its agent ID;
all decision relays and rejection fixes must resume that same agent with `followup_task` (or the
surface's equivalent). Wait for its report before reviewing. The implementer must not spawn
nested agents.

### 3. Resolve decisions

If the implementer returns `STATUS: decision-needed`, sanity-check the decision brief and ask
the user for the material contract/product choice. End the turn if input is blocking. Resume
the same implementer after the user decides; never replace it mid-section.

### 4. Review

After implementation ends, spawn applicable read-only reviewers for security/authz,
data/migration, contract/API, failure-mode/reliability, and convention/scope. For small,
low-risk diffs, use contract/API and convention/scope only. Run independent reviewers in
parallel within the thread cap. Each must return APPROVE or REJECT with concrete evidence.
An approval is evidence-bearing too: require 2-5 concrete `file:line` anchors explaining what was
checked and what each anchor establishes.

### 5. Verify independently

Re-run the global gate in the main session plus every required DB, integration, end-to-end, or
subsystem test. A gate is successful only when the main session ran it and observed green output.

### 6. Accept or reject

Apply all seven checks:

1. Re-run gate evidence is green.
2. Required DB, integration, and end-to-end tests actually ran.
3. No contract floor was crossed without user approval.
4. Acceptance maps to a plan exit test.
5. The diff stays within the section and excludes baseline user changes.
6. Repository conventions were followed.
7. Deferrals are explicit and safe.

On rejection, resume the same implementer with exact `file:line` gaps and re-run affected reviews
and gates. Approval of EXECUTE, an approved section, or an active Codex `/goal` authorizes every
routine correction round needed to converge inside that section's existing contract. Do not pause
for user authorization because of a round count, token usage, or reviewer rejection. Record each
round's findings and outcome in the ledger and continue until the section is accepted.

Pause only for a genuine decision or blocker: a correction would cross a CONTRACT DECISION —
ESCALATE floor, materially change approved scope or intent, require new external authority or an
irreversible action, make safe isolation impossible, or leave the required Terra route unavailable.
A repeated defect is not itself a decision boundary: improve the correction brief, add focused
diagnostic coverage, and resume the same implementer. Honor per-round approval only when the user
explicitly requests it or the approved plan contains an explicit correction cap.

On acceptance, normally update the plan ledger, stage only the accepted section and ledger change,
and commit them together with the section's commit message. When the ledger must record post-push
CI evidence for the exact product commit SHA, use a two-phase acceptance: commit and push only the
accepted product change, observe the required exact-SHA CI, then commit and push a ledger-only
evidence update and verify its required CI. Never amend an already pushed product commit. The
section is accepted only after the ledger records the exact evidence and its required gate is green.
Never sweep unrelated working-tree changes into either commit. Report the section status, then run
newly ready cheap/local gates. Hold rebuild, migration, credential/bootstrap, deployment, external,
and live end-to-end gates until all declared producers and invalidators are accepted, following the
approved lifecycle gate budget. Do not add an early deployment merely to verify an intermediate
slice when a later section will require another deployment. When the final implementation section
is accepted, set status to `implemented`; otherwise keep `executing`. Then repeat preflight.

## Complete the plan

When every implementation section is checked, run the graph's whole-branch final-review gate
before the first external or mutating lifecycle action that its findings could invalidate:

1. Spawn 2-3 read-only `goal-reviewer` agents in parallel over the full branch diff
   (`git diff <base>...HEAD`) with integration lenses: cross-section producer/consumer seams and
   failure states; whole-surface contract/conformance coherence; and plan conformance, deferrals,
   and leftover scaffolding. Require evidence-bearing APPROVE or REJECT reports.
2. Route findings through exactly one `goal-implementer-terra` correction agent at `xhigh`, scoped
   only to those findings. The main session still does not edit product code. Re-run affected
   focused reviews, the global gate, and exit tests, then commit accepted corrections additively.
   Repeat routine in-contract correction rounds until clean; stop only at the existing decision
   boundaries.
3. Mark the final-review node `✅` when clean or `🔁×n` with the accepted correction-commit count.

Build/deploy only the reviewed exact candidate, then run live goal gates. At completion, re-run
non-mutating exit tests against that candidate. Reuse recorded evidence for mutating lifecycle
gates when their inputs and observed target are unchanged; do not rebuild, redeploy, migrate, or
rotate credentials merely to repeat a completion checkbox. Repeat a lifecycle gate only when an
input changed, its evidence is stale, or the approved safety contract explicitly requires it. Use
read-only verifier agents only when they materially improve coverage.

Set status to `verified` when all approved-scope exit tests pass, or `shipped` when the approved
scope also includes deployment and post-deploy/live exits and they pass. If implementation is
accepted but a required gate cannot run, use `verification_blocked` for an invalid execution
environment or `externally_deferred` for missing authority/external state, and record the typed
deferral. Never label a plan complete solely because all source sections are committed.

Annotate the topology once at completion: `✅` for a clean section acceptance, `🔁×n` for rejection
rounds, and `⚠→` for an escalated decision with its ruling. Treat the approved graph as the spec and
the annotated graph as the trace. Compare the trace with Graph Findings and report confirmed risks,
risks that did not fire, unpredicted trouble spots, completed sections, commits, routing fallbacks,
deferrals, and observed exit-test evidence. Re-run `assets/render-plan-graph.mjs` and show the
annotated graph at handoff.

## Resources

- `assets/plan-template.md`: plan skeleton for PLAN mode.
- `assets/validate-plan.mjs`: validates `gdi_schema: 1` plan structure, topology/ledger parity,
  preflight classification, and lifecycle consistency before approval and dispatch.
- `assets/render-plan-graph.mjs`: renders plan graphs, lifecycle gate budget, findings, and ledger
  for approval and completion; supports `--no-open` and `--out <file>`.
- `assets/codex-agents/*.toml`: optional Codex custom-agent profiles.
- `references/agent-prompts.md`: dispatch, review, rejection, and decision templates.
- `references/model-routing.md`: current model evidence and selection policy.
