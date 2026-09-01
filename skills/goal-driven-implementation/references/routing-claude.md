# Routing — Claude Code

## Roles

| Role                                                                                                                | `subagent_type`           | Pinned model · effort | Notes                                                                     |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------- | --------------------- | ------------------------------------------------------------------------- |
| Implementer                                                                                                         | `gdi-implementer`         | opus · high           | One writer per section; may spawn ≤5 read-only helpers via the Agent tool |
| Mapper                                                                                                              | `gdi-mapper`              | sonnet · medium       | Read-only; verifies anchors before reporting                              |
| Verify-class reviewer (security, data, contract, failure-mode, doc-truth, capacity, evaluator, final-review lenses) | `gdi-reviewer`            | opus · high           | Read-only; may run tests and probes to verify                             |
| Convention/scope reviewer                                                                                           | `gdi-convention-reviewer` | opus · medium         | Read-only                                                                 |

Pins live in the agent definitions' frontmatter, not in prompts. **Never pass a per-call
`model`** to these types — it beats frontmatter and silently defeats the pin. Effort has no
per-call override.

## Installing the roles

The definitions ship with the skill at `assets/agents/claude/gdi-*.md`. Claude Code loads agents
from `~/.claude/agents/` (user scope) or `.claude/agents/` (project scope). If a `gdi-*` type is
not listed in the session's available agents, copy the four files there and start a new session:

```bash
cp <skill-root>/assets/agents/claude/gdi-*.md ~/.claude/agents/
```

Do this in PLAN mode preflight, before the approval surface is built. Record the outcome in the
plan's Harness routing table.

## Fallback (recorded, never silent)

If the types still cannot be resolved: mapper → `Explore`; implementer and reviewers →
`general-purpose` with `model: "opus"` per call. Record `fallback: general-purpose+opus` in the
routing table and on every affected ledger row. If no read-only reviewer can be dispatched at all,
the orchestrator may review a section itself only with `review: self (<reason>)` on the row and an
accepted risk in Graph Findings; the final review must then run with an independent agent, or the
run stops.

## Dispatch mechanics

- Parallel fan-out = multiple `Agent` calls in one message. Sequential implementer = one call,
  `run_in_background: false`, wait for the report.
- Follow-ups (rejection, decision relay) go to the **same** agent via `SendMessage` (load it with
  `ToolSearch select:SendMessage`). Never respawn mid-section; if the agent is lost, record it and
  resume with a fresh one carrying the full prior report.
- Routing evidence: the harness confirms the agent type at dispatch; model/effort come from the
  frontmatter of the resolved definition. Record `requested = confirmed` when the type resolved.

## Economics

Effort tiers, not model downgrades. Review depth is the highest-yield spend in this loop; do not
economize on verify-class lenses. The mapper is the one Sonnet role because its output is breadth
and its anchors are checked downstream.
