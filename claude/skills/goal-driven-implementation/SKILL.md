---
name: goal-driven-implementation
description: Author and execute goal-driven implementation plans with a strict two-tier model split - the main session (Fable-class) acts as orchestrator and reviewer and never writes product code, while Opus subagents implement one plan section at a time. Context aggregation and review fan out in parallel; implementation is strictly sequential. Use when the user asks to (1) create an implementation plan from a roadmap, PRD, or ADRs, (2) execute or resume an existing implementation plan, or (3) orchestrate a multi-section build. Triggers - "implementation plan", "goal-driven plan", "execute the plan", "resume the plan", "orchestrate implementation", "dispatch the next section", "plan topology graph", "draw the plan graph".
---

# Goal-Driven Implementation

Two-tier workflow: the main session plans, dispatches, reviews, and commits; Opus subagents
build. The unit of work is a **section** — one vertical slice with its own goal, gates, and
commit, defined in a plan file that doubles as the progress ledger.

## Role contract (non-negotiable)

| Role | Who | May | Must never |
|---|---|---|---|
| ORCHESTRATOR + REVIEWER | Main session | Read anything; write/update the plan file and ledger; re-run gates to verify; git commit accepted work; spawn subagents | Edit or Write product source code — every code change flows through an implementation agent |
| IMPLEMENTER | One `gdi-implementer` agent per section (pinned opus · xhigh effort) | Write code inside its section's scope; spawn up to 5 read-only subagents of its own | Touch future sections; cross a contract floor without an approved decision brief; delegate code-writing to its subagents |
| AGGREGATORS | `gdi-mapper` agents (pinned opus · medium) | Read-only codebase mapping | Write anything |
| REVIEWERS | `gdi-reviewer` (verify-class, pinned opus · high) · `gdi-convention-reviewer` (convention/scope, pinned opus · medium) | Read-only review of the section diff | Write anything |

Model + effort per role are pinned in the agent definitions (`~/.claude/agents/gdi-*.md`) —
never pass a per-call `model` (it beats frontmatter and defeats the pinning); effort has no
per-call override. Fallback when the `gdi-*` types are not installed: `Explore` for
aggregation, `general-purpose` + `model: "opus"` for implementer and reviewers.

Parallelism rule: **implementation is strictly sequential — exactly one implementer alive at
a time.** Aggregation and review fan out in parallel (multiple Agent calls in one message).

## Mode selection

- User points at an existing plan file, or one already exists for this feature → **EXECUTE**,
  resuming at the first unchecked ledger item.
- No plan yet → **PLAN** first, get user approval, then EXECUTE.

## PLAN mode

1. Read the inputs (roadmap / PRD / ADRs / issues). If the affected code is unfamiliar, fan
   out 2–4 parallel `gdi-mapper` agents to map code, tests, and conventions.
2. Instantiate `assets/plan-template.md` as the plan file. Default location
   `docs/plans/<slug>-plan.md`; follow the host repo's doc conventions (frontmatter, naming)
   when it has them.
3. Fill every part of the template:
   - **Global gate**: a real command. Run it once now to confirm it executes — never write an
     unverified command into the plan.
   - **Lifecycle gate budget**: separate the cheap per-section gate from expensive or
     mutating gates (full acceptance suite, builds, migrations, deploys, live e2e) — planned
     run count per gate plus what invalidates its evidence. Expensive gates run after their
     final invalidating input, not once per section.
   - **Approval-time contract rulings**: pre-rule every ⚠ section's contract decision
     (bounded ruling + what stays out of scope) so the user rules at approval, not
     mid-EXECUTE.
   - **Goals**: observable exit tests, not activities.
   - **Sections**: one vertical slice each, sized so a single Opus agent finishes within one
     context window (S/M, never L — split instead).
   - **Dependency graph** plus a recommended linear order.
   - **Progress ledger**: one checkbox per section.
4. **Draw the topology graph** — fill the mermaid graph in the plan's §2 (skeleton and edge
   conventions live in the template): one stadium node per scope-justifying input (issue /
   PRD section / explicit ask) with provenance edges to the sections that serve it, one node
   per section grouped by phase, solid edges for hard dependencies, dashed for soft, one
   diamond per goal exit test, the final-review gate between the goals and the PR/handoff
   node, and a ⚠ mark on every section that can hit a contract floor.
   Two authoring rules:
   - Every section must sit on a full path input → section → goal diamond. No input edge =
     scope nobody asked for; no goal path = no exit test. Re-scope or cut before presenting.
   - The graph must agree with the DEPENDS ON lines and the ledger. If they diverge, the
     graph is wrong or the plan is — fix before presenting; never let them drift.
5. **Run the graph analysis pass** — critique the topology *before* the user sees it. Each
   finding is either fixed by restructuring the plan now, or written into the plan's
   `### Graph Findings` block (template §2) as a named accepted risk with its mitigation —
   never silently noted. Check, at minimum:
   - **Orphan section** — no path to any goal diamond → no exit test; re-scope or cut.
   - **Unanchored section** — no input feeds it → scope nobody asked for; name the input
     that justifies it or cut it.
   - **Unreachable goal** — a diamond with no incoming edge → the plan literally cannot
     finish it; add the missing section or drop the goal.
   - **Dropped input** — an input node that reaches no section → a requirement silently
     not covered; add the section or defer it explicitly in the plan's out-of-scope list.
   - **Gateless PR** — a goal diamond wired straight to the PR/handoff node → the
     whole-branch final review is missing; add the final-review gate (Completion owns
     running it).
   - **Convergence bottleneck** — ≥3 hard edges into one node → that's the integration
     section: sequence it last, expect review pressure there, and state how its inputs get
     verified independently before it starts (or split it).
   - **Unruled contract risk** — a ⚠ node with no matching pre-ruling in the plan's
     Approval-Time Contract Rulings → a mid-run escalation in waiting. Put the decision
     (options + recommendation) into the rulings so the user rules at approval, not
     mid-EXECUTE.
   - **Misplaced verification gate** — a cheap check delayed behind unrelated work, or an
     expensive/mutating gate scheduled before a later input would invalidate it → move cheap
     feedback earlier; move expensive gates after their final invalidating input.
   - **Repeated lifecycle gate** — the order forces avoidable duplicate acceptance runs,
     builds, migrations, or deploys → pick the lowest-run topological order consistent with
     safety and record the counts in the gate budget.
   - **Long blocking chain** — ≥4 sections in a single hard-dependency chain → demote
     convention-only edges to soft, and name which prefix still delivers standalone value
     if the run stalls partway.
   - **Cycle** — the section DAG must be acyclic; the only legal cycles anywhere are the
     capped reject edge of the per-section loop and the capped correction loop on the
     final-review gate.
   For plans over ~8 sections, fan the checklist out to one read-only reviewer agent as a
   second pair of eyes; otherwise the orchestrator runs it inline.
6. Present the plan for approval, **graph first** — and *show* it, don't just write it into
   the plan file. Run the bundled render script:

   ```bash
   node <skill-root>/assets/render-plan-graph.mjs <plan-file>
   ```

   It extracts every mermaid block, the `### Graph Findings` section, and the progress
   ledger into a self-contained HTML page (written to the OS temp dir) and opens it in the
   user's default browser — graph, structural critique, and status land on one page. Mermaid renders
   client-side from CDN — if the session is headless/remote, or the page reports the CDN
   unreachable, publish an Artifact page instead (artifacts render mermaid natively).
   The topology graph is the primary approval surface — the user reviews shape (what depends
   on what, where the gates sit, which sections carry contract risk) before reading section
   prose. Present the Graph Findings with the graph: the user's eval starts where the
   structural critique ended, not from zero. **Do not start EXECUTE without approval** — the
   plan encodes contract decisions and section boundaries the user must own.

## EXECUTE mode — per-section loop

Read `references/agent-prompts.md` before the first dispatch and use its templates verbatim.

**0. Preflight** — read the plan; pick the first unchecked ledger item whose DEPENDS ON are
all checked; confirm the working tree is clean (uncommitted drift → stop and ask the user).

**1. AGGREGATE (parallel)** — skip when the section's CONTEXT TO AGGREGATE items already
carry `file:line` anchors (the norm for plans authored by this skill): the plan's own anchors
ARE the context brief. Dispatch `gdi-mapper` agents (cap 2, one message, aggregator prompt)
only for items that are unanchored or likely stale — the anchored files changed since the
plan was written. Merge any returns into the brief. Rationale: plan-time mapping already
produced the anchors; re-deriving them per section is token waste with no quality role.

**2. IMPLEMENT (sequential)** — one Agent call: `subagent_type: "gdi-implementer"`,
`run_in_background: false` (no per-call `model` — frontmatter pins it), prompt = implementer
template + the section block verbatim + the context brief. Wait for its report before doing
anything else.

**3. ESCALATE when signaled** — if the report is a decision brief (contract floor hit),
sanity-check it, put the options to the user with AskUserQuestion, then send the decision back
to the SAME agent via SendMessage (load it first with ToolSearch `select:SendMessage`) so it
keeps its context. Never respawn a fresh implementer mid-section.

**4. REVIEW (parallel)** — launch the focused reviewers in one message using the reviewer
templates: security/authz, data/migration, contract/API, failure-mode/reliability (all
`gdi-reviewer`), convention/scope (`gdi-convention-reviewer`). For small low-risk diffs
collapse to two (contract + convention/scope). Each returns APPROVE/REJECT with `file:line`
evidence.

**5. VERIFY YOURSELF** — re-run the global gate in the main session (the cheap per-section
gate only — budgeted expensive/mutating gates run at their planned slot, per the plan's
Lifecycle Gate Budget). Trust no gate that
was neither re-run nor evidenced by pasted real output. No unrun gate may be reported as
success. Then read the full section diff before accepting — scope drift, dead code, test
placement, README/doc accuracy. The orchestrator signs the commit, so it reads what it
ships; the implementer's report is not a substitute for the diff.

**6. ACCEPT / REJECT** — apply the review protocol below.
- Reject → SendMessage the exact gaps to the same implementer (rejection template). Max 2
  rejection rounds per section; after that, stop and report to the user.
- Accept → commit with the section's COMMIT message, tick the ledger checkbox in the plan
  file, post a brief status to the user, loop to step 0.

## Review protocol — all seven before accepting

Points 5 and 6 are judged against the full section diff read in step 5, never against the
implementer's report alone.

1. Gate evidence is shown and green (re-run, not just claimed).
2. Required DB / integration / e2e tests were actually run.
3. No contract floor was crossed without an approved decision brief.
4. ACCEPTANCE maps to a milestone exit test in the plan.
5. Scope stayed inside the section — no future-section drift.
6. Repo conventions were followed.
7. Deferrals are explicit and safe.

## Completion

When every ledger checkbox is ticked, verify each goal's exit test end-to-end (spawn read-only
verifiers if needed).

**FINAL REVIEW — the whole-branch gate before the PR.** Per-section review sees each slice in
isolation, against the tree as it stood at dispatch; it structurally cannot see cross-section
seams, drift introduced by later sections, or the assembled public surface. Run it before
any budgeted expensive/mutating gate its corrections could invalidate; the expensive gates
then run once against the reviewed candidate. Before opening (or handing off) the PR:

1. Fan out 2–3 `gdi-reviewer` agents in one message over the **full branch diff** (`git diff
   <base>...HEAD`) with integration lenses, not section lenses: (a) cross-section seams —
   state one section writes and another consumes: races, double-handling, dropped
   inter-section obligations; (b) whole-surface contract/conformance coherence; (c) plan
   conformance + debris — deferrals really deferred, no leftover scaffolding.
2. Findings go through a correction round: dispatch one implementation agent scoped to
   exactly the findings (the orchestrator still writes no product code), re-run the global
   gate, commit additively. Max 2 rounds, then stop and report.
3. Annotate the graph's final-review gate node like any section: `✅` clean, or `🔁×n` plus
   the fix-commit count.

This gate exists because it provably catches what section review misses — its origin run had
five clean per-section reviews and the whole-PR review still surfaced a credential race, a
narrowed public contract, and unsurfaced error paths.

Then report: sections completed, commits made (including correction commits), deferrals
outstanding, and the exit-test evidence.

**Annotate the graph as-executed** — once, at completion, never per-section: update each
section node in the plan's topology graph with how it actually went — `✅` clean accept,
`🔁×n` for n rejection rounds, `⚠→` if it escalated a decision brief (note the ruling).
The approved graph is the spec; the annotated graph is the trace. Divergence between them
(unplanned escalations, repeated rejections in one region) is signal for the final report,
not something to smooth over. Check the trace against §2's Graph Findings: predictions
confirmed, accepted risks that never fired, and failures the analysis missed all belong in
the final report — they are how the next plan's analysis pass gets sharper. Re-run
`assets/render-plan-graph.mjs` on the annotated plan so the user sees the trace rendered,
same as at approval.

## Resources

- `assets/plan-template.md` — plan skeleton instantiated in PLAN mode.
- `assets/render-plan-graph.mjs` — extracts a plan's mermaid graphs, `### Graph Findings`
  section, and ledger into a self-contained HTML page and opens it in the user's browser.
  Run at approval (step 6) and again at completion with the as-executed annotations.
  `--no-open` / `--out <file>` flags for headless use.
- `references/agent-prompts.md` — verbatim prompt templates: aggregator, implementer, the five
  reviewers, rejection follow-up. Read before dispatching any agent.
