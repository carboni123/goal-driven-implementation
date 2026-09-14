# Routing — Claude Code

## Roles

| Role                                                                                                                | `subagent_type`           | Pinned model · effort | Notes                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Plan author                                                                                                         | `gdi-planner`             | inherit · session     | Fresh context after validated PLAN-mode mapping; writes only plan/graph artifacts; no delegation |
| Implementer                                                                                                         | `gdi-implementer`         | opus · high           | One writer per section; may spawn ≤5 read-only helpers via the Agent tool                        |
| Mapper                                                                                                              | `gdi-mapper`              | sonnet · medium       | Read-only; verifies anchors before reporting; no delegation                                      |
| Verify-class reviewer (security, data, contract, failure-mode, doc-truth, capacity, evaluator, final-review lenses) | `gdi-reviewer`            | opus · high           | Read-only; may run tests and probes to verify; no delegation                                     |
| Convention/scope reviewer                                                                                           | `gdi-convention-reviewer` | opus · medium         | Read-only; no delegation                                                                         |

Model and effort pins are set in the agent definitions' frontmatter. **Never pass a per-call
`model`** to these types: it overrides the pinned model. Effort has no per-call override. If
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set in the environment, the harness ignores every
definition's `model`; check it in preflight and, when set, record its value as the effective model
of every role.

The planner runs on `model: inherit` with no `effort` key: it uses the main session's model and
effort, so plan quality tracks the session the user selected and no new economics pin is
introduced. The role's value is a fresh context that holds only the validated mapper brief,
rulings, and open questions, and an author that is not the session which approves, reviews, and
commits. A stronger planner pin is a role-economics change under the repository's ruling floor;
make it in the frontmatter, never per call.

## Installing the roles

The definitions are included at `assets/agents/claude/gdi-*.md`. Claude Code loads agents
from `~/.claude/agents/` (user scope) or `.claude/agents/` (project scope); on a name clash the
project copy wins. If a `gdi-*` type is not listed in the session's available agents, copy the
five files there and start a new session:

```bash
cp <skill-root>/assets/agents/claude/gdi-*.md ~/.claude/agents/
```

Do this in PLAN mode preflight, before preparing the plan for approval. Record the outcome in the
plan's Harness routing table.

## Verification protocol (before the first dispatch)

Keep three facts distinct and record them per role in the plan's Harness routing table:

- **Requested** — the `subagent_type`, and the model and effort in
  `<skill-root>/assets/agents/claude/<type>.md`.
- **Role-confirmed** — the type is listed in the session's available agents, the dispatch names
  it, **and** the loaded definition is current. Listing alone is not enough: `diff` the installed
  file (`.claude/agents/` in the project when present, else `~/.claude/agents/`) against the
  skill's copy. A differing file is a stale role: reinstall and start a new session, or record
  `role-confirmed: stale (<what differs>)` and treat the standing contract as absent, so the
  dispatch prompt must carry every rule. _Origin:_ on 2026-09-13 the installed
  `gdi-implementer.md` on the maintainer's machine predated 0.4.0 and lacked the RETIRES,
  sensitivity, and evidence-reuse rules the source definition carries; every Claude run since had
  dispatched to the older contract while its plan recorded the current release.
- **Model-confirmed** — the Agent tool result reports neither the model nor the effort that ran.
  The user can read the model on the agent's row in `/tasks` (and the effort when the definition
  pins one); record that when they report it. Otherwise record
  `definition: <model/effort>; runtime: unknown`. A subagent's self-description is not evidence.

A first real bounded mapper dispatch serves as role preflight; do not run a throwaway dispatch.
Reuse the routing record while the definition files and environment are unchanged.

## Fallback (recorded, never silent)

- Plan author: the main session authors the plan under the same §0 contract. It is the model the
  user selected, so this is not a downgrade, but the author and the approver are then the same
  session; record `fallback: main-session planner` in the routing table and name that risk in
  Graph Findings.
- Mapper → `Explore` (read-only by construction).
- Implementer and reviewers → `general-purpose` with `model: "opus"` per call. Effort cannot be
  set per call and runs at the session default. A generic child has no standing contract and can
  write files: the dispatch template is its only contract, so send the full RULES and, for a
  reviewer or mapper, an explicit read-only instruction. Record `fallback: general-purpose+opus`
  in the routing table and on every affected ledger row.
- If no read-only reviewer can be dispatched at all, the orchestrator may review a section itself
  only with `review: self (<reason>)` on the row and an accepted risk in Graph Findings; the final
  review must then run with an independent agent, or the run stops.

## Dispatch mechanics

- Parallel dispatch = multiple `Agent` calls in one message. Sequential implementer = one call,
  `run_in_background: false`, wait for the report.
- Never pass `isolation` to a `gdi-*` dispatch. A worktree child branches from the default branch,
  not the current HEAD, and its edits land in another checkout: the orchestrator's `git diff`,
  the reviewers, and the section commit would all miss the work.
- Planner: one `Agent` call with the §0 body after the PLAN-mode mapper returns validate (or with
  the verified orchestrator anchors under the mapping exception). When it returns, run
  `git status --porcelain`: only the plan path, plus the feature map and render output already
  listed under baseline exclusions, may have changed. Any other path is a boundary violation:
  restore it, record it in Graph Findings, and re-issue the handoff. Run `validate-plan.mjs` and
  the anchors check yourself; the planner's report is a claim, not the evidence. If the planner
  reports missing browser or image tools, capture the rendered graphs with the orchestrator's
  tools and send the image paths to the **same** planner for the visual pass.
- Follow-ups (rejection, decision relay, planner captures) go to the **same** agent via
  `SendMessage` (load it with `ToolSearch select:SendMessage`). Never respawn mid-section; if the
  agent is lost, record it and resume with a new one given the full prior report.
- Reports carry no `ROUTING` line in Claude Code: the harness exposes no routing metadata to the
  child, and the type named at dispatch identifies the definition. Routing evidence lives in the
  plan's table under the protocol above.

## Economics

Keep the pinned effort tiers and models. In the retrospective, verify-class review found defects
that less thorough reviews missed; do not reduce its model or effort. The mapper uses Sonnet
because it locates relevant code and its anchors are checked before implementation and review.
When a worker struggles, diagnose the missing fact or narrow the brief inside the approved section;
do not promote it to a costlier model or effort mid-run. The Agent tool result does not expose
per-role token counts; record `cost: unknown` unless the user supplies numbers from `/tasks` or
usage reporting.
