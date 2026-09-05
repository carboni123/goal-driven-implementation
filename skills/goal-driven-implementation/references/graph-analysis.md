# Graph Analysis Checklist

Run before presenting a plan and again after any approval-time correction. Each class is either
fixed by restructuring the plan or recorded under `### Graph Findings` as a named accepted risk
with its mitigation. `None` is valid only after every class was checked. At completion, compare
the execution record with this list: confirmed, did not occur, missed.

Each class names the failure it prevents and the run that motivated the check.

Contents: structural classes · scope classes · contract classes · data classes · lifecycle
classes · environment classes · evidence classes.

## Structural classes

- **Orphan section** — no path to any goal diamond → no exit test. Revise its scope or remove it.
- **Unanchored section** — no input justifies it → unrequested scope. Name the input or remove it.
- **Unreachable goal** — a diamond with no incoming edge → the plan cannot finish it. Add the
  section or drop the goal.
- **Gateless handoff** — a goal connected directly to PR/handoff, or code reaching an external or
  mutating gate before the review that could still invalidate it. Insert the final review.
- **Convergence bottleneck** — ≥3 hard edges into one node. Sequence it last, state how its
  inputs are verified independently, account for the combined review work, or split it.
- **Long or false blocking chain** — ≥4 sections in one hard chain, or a preference drawn as a
  hard edge. Change convention-only edges to soft dependencies; name which initial sections are
  useful on their own if execution stops early. _Origin:_ a plan incorrectly claimed that its
  initial sections were independently useful. Tests depended on later sections even though source
  code did not: 58 tests failed across five modules until the middle section was implemented.
- **Cycle** — the section DAG must be acyclic. The only legal cycles are the per-section
  correction loop and the final-review correction loop.
- **Graph/ledger/prose disagreement** — `DEPENDS ON`, the ledger, the recommended order, and
  the graph must agree in meaning. The validator checks membership; you check meaning.

## Scope classes

- **Dropped or partially consumed input** — an input node that reaches no section, _or an input
  whose clauses are only partly served_. Every clause reaches a section or is named in the
  out-of-scope list. _Origin:_ a plan folded one clause of a sibling issue, passed the dropped-input
  check, and left two-thirds of that issue unbuilt; a second plan then repeated the migration,
  build, acceptance run, whole-branch review, and conformance updates across six packages.
- **Sibling surface** — the same job pattern, guard, or resolver exists in another module. Check
  it or exclude it by name. _Origin:_ a submit-retry race fixed in one module remained in another
  module with the same pattern; a customer found it.
- **Class completeness** — a guard that closes one encoding of a bad input while another encoding
  reaches the same state. _Origin:_ a position-validation preflight shipped with a documented
  zero-width/RTL bypass, then a follow-up plan whose fix introduced a quadratic regex reachable by
  any API key.
- **Invariant inversion** — size a section by how many unstated assumptions it falsifies, not by
  diff size. List the **writers** of any state whose invariant changes; readers are usually
  already listed. _Origin:_ retaining a credential broke unwritten assumptions in four places
  across three sections; the three readers named in the plan still worked, and every serious defect
  was in the unlisted writers.
- **Plan as evidence** — every anchor resolves (`validate-report.mjs --kind anchors` over the
  plan file checks file and line mechanically), every named symbol/scope/column/export exists,
  every `DEPENDS ON` edge is buildable. Behavior claims in the plan get the same discipline as
  docs. _Origin:_ a plan prescribed an import direction that was a workspace cycle; another named a
  scope that did not exist; another's IMPLEMENT text asserted a false behavior that was implemented
  and only identified by a reviewer who checked the code.

## Contract classes

- **Unruled floor item** — a `⚠` section with no matching row in Floor rulings. Put the decision
  (options + recommendation) in the table so the user rules once, at approval.
- **Ruling-set completeness** — every `⚠` has a ruling, but the _set_ is incomplete: the plan asks
  a later section for data no earlier section transmits, or an error code the plan will
  need is not named. Check the data flow input → transmitted data → consumer for each ruling.
  _Origin:_ two mid-run escalations in one run, both on decisions the table had not anticipated, one of which
  spawned an unplanned section.
- **Unruled semantics (negative space)** — any section whose verb is enforce, gate, block,
  redact, suspend, or pause must pre-rule what remains available: paths needed to finish or stop
  existing work, reads, and every route whose request body identifies or contains restricted
  resources or operations. _Origin:_ a
  kill-switch plan deferred enforcement decisions until execution; three bypasses were in routes
  that identified the resource in the request body rather than the URL prefix.
- **Recommendation, not just support** — does a user-facing interface now _prioritize_ or
  _recommend_ something, not merely support it? That is a ruling. _Origin:_ a plan pre-ruled the
  contract structure but omitted the recommendation decision, requiring revisions to how six
  interfaces presented the feature.
- **Terminal action** — the plan states its last external action (commit, push, PR, comment,
  deploy, none). _Origin:_ a mid-run amendment only to open a PR.

## Data classes

- **Reader sweep** — a section writes a new value into a shared column, enum, event type, or
  registry. Enumerate every reader in the repository and prove each handles it or is unaffected —
  especially fail-closed registries and reports in _other_ packages. Record the sweep in Graph
  Findings. _Origin:_ a promotion credit added `provider = promotion` to a shared table; the fiscal
  report summed it as cash and the analytics funnel counted promo-only orgs as paying, four days
  after the plan reported clean. Separately, five new event types in one week shipped without a
  row in another module's fail-closed retention snapshot because the section gate ran only the
  owning module's tests.
- **Constraint admissibility** — widening an enum, status, or kind: enumerate every CHECK
  constraint, trigger, and allowlist that filters that column, including historical migrations for
  other tables. _Origin:_ a CHECK constraint from an old migration rejected an already-public enum
  value in production; every section's tests passed.
- **Data-path reachability** — for any plan-data change, ask what writes it in production. A dev
  seed is not a rollout; `migrate deploy` runs, the seed does not. _Origin:_ new plan caps that
  would never have reached production without a backfill migration the final review demanded.
- **Rollout window** — during replacement the old binary runs against the new schema. Does
  either side write a state the other cannot interpret; can the old worker spend or clear
  something before its first write against the new columns. _Origin:_ an old worker could clear only
  the public half of a two-marker stamp during the replacement window, and a baseline worker could
  spend a platform credential before its first database write.

## Lifecycle classes

- **Misplaced verification gate** — a cheap check delayed behind unrelated work, or an expensive
  or mutating gate scheduled before a later input invalidates it. Run inexpensive checks early;
  run expensive gates after the last change that can invalidate their inputs.
- **Repeated lifecycle gate** — the order forces avoidable duplicate builds, migrations,
  deploys, or live runs. Pick the lowest-run safe order; record planned counts; record actuals
  at completion and name any `>1.5×` overrun as a miss.
- **Cheapest real-client probe** — a browser page load, one user-flow step, one live HTTP burst,
  scheduled _before_ the first image build. _Origin:_ four of ten plans in one week had their real
  defects detected only by the most expensive gate in the budget.
- **Co-tenant load** — a section re-scopes a shared limiter, queue, or table. Name every existing
  legitimate client of the governed surface, including the product's own first-party traffic, and
  its per-interaction demand. Pair every rejection exit test with an admission exit test measured
  on real client behavior. _Origin:_ a public rate limiter whose exit tests were all "excess gets
  429"; one page view of the product's own docs site issued 77 prefetch requests against a burst of
  60, a P1 in production two days after a clean final review.
- **Wrong invalidation boundary / implicit startup coupling / conflated rollout dependency** —
  runtime env mistaken for an image input; a migration hidden inside service startup; a section
  `DEPENDS ON` that is really a deploy prerequisite. Correct the edge; model the gate separately.
- **Base drift** — a long run on a moving `main`, or a stacked predecessor that may merge.
  Declare when to re-baseline and what happens on a squash-merge. _Origin:_ 29 textual conflicts and
  two extra whole-branch rounds in one plan; two human authorizations in another; two plans in the
  same week shipping contradictory semantics for one subsystem, noticed only by a human at merge.

## Environment classes

- **Known blockers** — list every host or environment condition that has blocked this
  repository's gates before, with pre-approved handling. Encountering one is an `⚙` retry, not a
  rejection and not a decision. _Origin:_ the same failed development migration blocked six plans in
  one week; the plan that approved the runbook in advance needed no additional handling, while
  another escalated it to the user.
- **Gate environment preflight** — smoke-run each budgeted expensive gate's environment path once
  (network realm, ports, database-name suffix restrictions, writable caches, inherited environment),
  or mark it `unproven`. _Origin:_ an acceptance gate that took five environment retries with no product
  change while the preflight table said "ready".
- **Stale running stack** — live or browser evidence is valid only if the running image or
  process is at or ahead of the section's HEAD. _Origin:_ a stale workers image produced a false
  "300 delivered unpaced" signal that cost a live investigation.

## Evidence classes

- **Evaluator soundness** — a passing user-flow test counts only after fault injection makes it fail; a
  crash before the first check must not write a pass artifact; timestamps written before the work
  make evaluators vacuous. _Origin:_ four journey sections, four rejections, all defects in the
  proof rather than the product.
- **Test sensitivity** — every regression test and every mocked or fault-injected test is shown
  to fail with the fix temporarily disabled: a local stash or one-line edit, restored at once,
  never a revert of committed work, a rebuild, or a rollback of applied state. Tests of
  once-applied state (migrations, deployed state) use a disposable fixture instead. _Origin:_ race
  tests that injected the failure before the transaction callback and proved nothing; four fixtures
  whose mock predated the refactor and still passed. _Narrowed in 0.2.1:_ the unscoped
  "revert the fix" wording sent implementers into rebuilding a separate candidate version of a
  one-line change.
- **Claim decay** — a claim true when its section was committed and false at branch end; a correction in
  one section re-emerging in later sections' prose. Broadcast accepted corrections into later
  briefs; re-verify at final review. _Origin:_ the most frequent rejection class across 90 plans
  and the most frequent finding class in final review.
- **Reviewer unavailability** — if the reviewer role cannot dispatch, record `review: self` and
  an accepted risk; the final review must be independent. _Origin:_ a plan whose five sections were
  all self-reviewed after the reviewer route failed silently had the most defects found in live
  gates and used three times its planned build budget.
