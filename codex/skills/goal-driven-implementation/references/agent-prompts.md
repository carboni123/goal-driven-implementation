# Codex Agent Prompt Templates

Substitute `{...}` placeholders and preserve the constraints. Use Codex collaboration controls:
spawn agents for new work, wait for results, and resume the same implementer for decisions or
fixes.

Templates:

1. Explorer
2. Section implementer
3. Focused section or whole-branch reviewer
4. Rejection follow-up
5. Decision relay
6. Plan topology reviewer
7. Whole-branch correction implementer

When per-agent routing is available (see `references/model-routing.md`), spawn each role with
`agent_type` and a bounded fork — `fork_turns: "none"` by default, or a small integer when the
most recent turns genuinely matter. Every template below is self-contained, so `"none"` is
normally correct. A full-history fork (`fork_turns: "all"`) cannot carry routing overrides and
inherits the parent model; never combine it with `agent_type`.

Every spawned role receives a `ROUTING REQUEST` and begins its final report with this exact form:

```text
ROUTING: requested=<role/model/effort>; attestation=<profile literal or none>; runtime=<tool-exposed role/model/effort or unknown>
```

Do not include the expected profile attestation literal in the task prompt. Never infer the runtime
model or effort from a prompt, role TOML, attestation, or child self-description; only tool/runtime
metadata can confirm them.

## 1. Explorer

Prefer the built-in `explorer` role or the bundled `goal-explorer` profile.

```text
Perform read-only codebase exploration for one implementation section. Do not modify files,
run destructive commands, or delegate.

AREA: {one CONTEXT TO AGGREGATE item}
SECTION GOAL: {one-line section goal}
ROUTING REQUEST: {requested role/model/effort}

Return exactly these fields, densely:
ROUTING: requested=<...>; attestation=<profile literal or none>; runtime=<tool-exposed role/model/effort or unknown>
SYMBOLS: relevant symbols with file:line anchors
PATTERNS: existing convention to copy and its exemplar file
TESTS: existing tests to extend and exact commands that run them
COUPLINGS: flags, config, migrations, generated code, or runtime dependencies
LIFECYCLE: artifacts/config/credentials produced; build-time vs runtime binding; startup-only
prerequisites that can be invoked separately; build/deploy/bootstrap gates affected; prior evidence
invalidated; external mutation or repetition cost
UNCERTAINTIES: items that require implementer verification
```

Merge explorer results into a deduplicated context brief before implementation.

## 2. Implementer

Use `goal-implementer-terra` at `xhigh`. Exactly one implementer may be active. Never use an
inherited Sol route; stop before product edits when the Terra route cannot be selected and
confirmed.

```text
Act as the sole implementation agent for ONE section of a goal-driven implementation plan.
You may write product code only inside this section. Do not commit and do not spawn subagents.

ROUTING REQUEST: {requested role/model/effort, or explicitly authorized inherited fallback}

=== SECTION (verbatim from the approved plan) ===
{full section block}

=== CONTEXT BRIEF ===
{merged explorer output, or "none — inspect what you need directly"}

=== WORKING-TREE BASELINE ===
{pre-existing changed/untracked files that must be preserved and excluded}

=== GLOBAL GATE ===
{verified gate command from the plan}

=== EXECUTION-ENVIRONMENT PREFLIGHT ===
{status, checked time, baseline SHA, execution realm, capability evidence, and any known baseline red}

RULES
- Read applicable AGENTS.md and repository convention files first.
- Implement exactly the section's IMPLEMENT list. Do not touch future sections, perform
  drive-by refactors, or fix unrelated issues; report unrelated findings under RISKS.
- Preserve all baseline user changes. Stop if safe isolation becomes impossible.
- If work would cross CONTRACT DECISION — ESCALATE, stop before that change and return a
  decision brief with STATUS: decision-needed. Do not create a temporary workaround.
- Run the global gate, subsystem tests, and specified live/end-to-end flow. Include concise,
  real command evidence. Never report an unrun check as successful.
- Treat a changed or contradicted preflight assumption as a blocker; report it without improvising
  a different database, network realm, credential, or lifecycle path.
- Do not edit the plan ledger; the orchestrator owns it.

Return exactly:
ROUTING: requested=<...>; attestation=<profile literal or none>; runtime=<tool-exposed role/model/effort or unknown>
STATUS: complete | blocked | decision-needed
DIFF: one line per changed file — what and why
GATE EVIDENCE: command plus decisive trailing output
TESTS RUN: suites and results
LIVE FLOW: steps and observed result
LIFECYCLE EFFECTS: produced/invalidated gate inputs and whether the plan prediction held
ACCEPTANCE: exact plan exit-test clause satisfied
DEFERRALS: omitted work and why deferral is safe
RISKS: reviewer focus areas and unrelated issues noticed
DECISION BRIEF: product effect; 2-4 options; consequences; recommendation; evidence (only when needed)
```

## 3. Focused section or whole-branch reviewer

Prefer the bundled `goal-reviewer` profile. Spawn only after the relevant section implementer
finishes, or after all sections when running the whole-branch final-review gate.

```text
Perform one focused, read-only review of an implementation-plan section or assembled branch. Do
not modify files, delegate, or review outside the named dimension.

DIMENSION: {dimension}
REVIEW TARGET: {one-line section goal or whole-branch integration lens}
DIFF SCOPE: {changed files or commit range}
BASELINE EXCLUSIONS: {pre-existing user changes}
CHECK FOR: {dimension checklist}
ROUTING REQUEST: {requested role/model/effort}

Read the diff and enough surrounding code to judge it in context. Findings must be concrete,
actionable, inside the declared diff and plan scope, and supported by file:line evidence. One
shared exception to the dimension boundary — doc truth: a README/doc/comment claim the diff
introduces or makes stale is in scope for every dimension, and an over-claim (docs promising what
the code does not do) is a REJECT finding. APPROVE when no concrete blocking issue exists.

Return exactly:
ROUTING: requested=<...>; attestation=<profile literal or none>; runtime=<tool-exposed role/model/effort or unknown>
VERDICT: APPROVE | REJECT
EVIDENCE: 2-5 file:line anchors — what each anchor establishes, including on approval
FINDINGS: none | file:line — issue — impact — required correction
NOTES: non-blocking observations
```

Dimension checklists:

1. **Security/authz**: authorization on every new path; validation at trust boundaries; no
   secrets in code/logs; injection resistance; server-side enforcement.
2. **Data/migration correctness**: additive/reversible migration; existing-row behavior;
   constraints and indexes; rollback/data-loss risk.
3. **Contract/API compatibility**: public routes, payloads, config, and storage formats remain
   compatible unless approved; versioning and old-client/data behavior.
4. **Failure-mode/reliability**: sane error states; timeouts/retries; partial failure;
   idempotency; cache/orphan cleanup.
5. **Convention/scope**: naming, layering, test placement, generated files, section boundary,
   no drive-by changes or dead code; documentation claims in the diff match the code they
   describe.

## 4. Rejection follow-up

Resume the same implementer agent; do not spawn a replacement.

```text
REVIEW RESULT: rejected. Fix exactly the gaps below and nothing else, then return the complete
implementer report again.

1. {file:line — gap — required fix}
2. {...}

Re-run the global gate and all affected tests. Paste fresh evidence; prior evidence is void.
Preserve the original working-tree baseline.
```

Treat approval of EXECUTE, the active section, or an active Codex `/goal` as authorization for all
routine in-contract correction rounds. After every rejection, record the findings, strengthen the
brief or focused coverage as needed, and resume the same implementer until reviewers approve and
the gates pass. Never stop merely because a round count or token threshold was reached.

Stop for user input only when the correction crosses a CONTRACT DECISION — ESCALATE floor,
materially changes approved scope or intent, requires new external authority or an irreversible
action, cannot be isolated safely, or cannot use the required Terra route. Honor per-round gating
only when the user or approved plan explicitly requires it.

## 5. Decision relay

After the user decides, resume the same implementer agent.

```text
DECISION: {chosen option and verbatim user constraints}

Continue this section under that decision. Approval covers only the identified contract floor;
all other items under CONTRACT DECISION — ESCALATE still require a new decision brief. Return
the full implementer report when finished.
```

## 6. Plan topology reviewer

For a plan with more than about eight sections, spawn one read-only `goal-reviewer` at `high` as a
second graph-analysis pass. The main session remains responsible for reconciling the report and
presenting the corrected plan.

```text
Perform a read-only structural review of a goal-driven implementation plan. Do not modify files,
delegate, or review implementation code.

PLAN FILE: {path}
ROUTING REQUEST: {requested role/model/effort}

Read the plan sources named in the file, the Mermaid topology, section DEPENDS ON clauses, goal
exit tests, decision table, lifecycle gate budget, recommended order, and progress ledger. Check for:
- orphan or unanchored sections
- unreachable goals or dropped inputs
- graph/prose/ledger/order mismatches
- goals or handoff paths that bypass required review gates
- convergence bottlenecks with at least three incoming hard edges
- contract-risk nodes without a matching pre-ruling
- cheap/local verification delayed behind unrelated work
- rebuild/deploy/live verification scheduled before its last invalidating input
- avoidable repeated builds, migrations, credential/bootstrap actions, deployments, or live runs
- runtime env/config incorrectly modeled as an image-build input, or the reverse
- migration/bootstrap prerequisites hidden inside service startup instead of explicit safe gates
- section dependencies that conflate implementation prerequisites with rollout prerequisites
- preference-only edges encoded as hard dependencies
- hard chains of at least four sections without an independently verifiable prefix
- dependency cycles outside the in-contract correction loops

Return exactly:
ROUTING: requested=<...>; attestation=<profile literal or none>; runtime=<tool-exposed role/model/effort or unknown>
VERDICT: APPROVE | REJECT
EVIDENCE: 2-8 plan file:line anchors or graph node/edge IDs — what each establishes
FINDINGS: none | class — node(s) — structural impact — required correction or mitigation
```

## 7. Whole-branch correction implementer

Use after the completion final-review gate reports findings. Spawn exactly one
`goal-implementer-terra` at `xhigh`; never inherit the Sol route.

```text
Act as the sole correction implementer for findings from a goal-driven plan's whole-branch final
review. You may write product code only for the listed findings. Do not commit, edit the plan
ledger, spawn subagents, or perform unrelated cleanup.

ROUTING REQUEST: {requested role/model/effort}

=== APPROVED PLAN ===
{plan path and relevant approved contract clauses}

=== FINAL-REVIEW FINDINGS (verbatim) ===
{evidence-bearing findings}

=== BRANCH DIFF AND BASELINE ===
{base...HEAD range; pre-existing changed/untracked files to preserve and exclude}

=== REQUIRED GATES ===
{global gate, affected subsystem tests, goal exit tests}

RULES
- Read applicable AGENTS.md and repository convention files first.
- Fix exactly the listed findings without redesigning completed sections or crossing a contract
  floor.
- If a correction requires an unapproved contract, scope, trust-boundary, irreversible, or
  external-authority change, stop first with STATUS: decision-needed and a decision brief.
- Run every required gate and return concise real output. Never claim an unrun check.

Return exactly:
ROUTING: requested=<...>; attestation=<profile literal or none>; runtime=<tool-exposed role/model/effort or unknown>
STATUS: complete | blocked | decision-needed
DIFF: one line per changed file — what and why
FINDINGS RESOLVED: finding — evidence
GATE EVIDENCE: command plus decisive trailing output
TESTS RUN: suites and results
EXIT TESTS: steps and observed results
DEFERRALS: omitted work and why it is safe
RISKS: remaining reviewer focus
DECISION BRIEF: product effect; 2-4 options; consequences; recommendation; evidence (only when needed)
```
