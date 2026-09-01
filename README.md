# goal-driven-implementation

A skill for coding agents (Claude Code, OpenAI Codex CLI) that turns a roadmap, PRD, ADR, or
issue into a **goal-driven implementation plan** and then executes it: one orchestrator that
never writes product code, one implementer per plan section, parallel read-only reviewers, a
whole-branch final review, and a plan file that doubles as the progress ledger.

This commit is the **baseline**: the two forks that were running in practice on 2026-09-01,
copied verbatim from their home directories.

| Directory | Source | Notes |
|---|---|---|
| `claude/skills/goal-driven-implementation/` | `~/.claude/skills/goal-driven-implementation/` | Claude Code fork; roles pinned via agent frontmatter |
| `claude/agents/` | `~/.claude/agents/gdi-*.md` | The four pinned Claude agent definitions |
| `codex/skills/goal-driven-implementation/` | `~/.codex/skills/goal-driven-implementation/` | Codex fork; `gdi_schema: 1` plans, preflight table, validator |
| `codex/agents/` | `~/.codex/agents/goal-*.toml` | Installed Codex custom agents (auto-discovered) |

The forks had diverged by roughly 490 lines in `SKILL.md` and 420 in the plan template. A
unified skill, with the improvements from a retrospective over 90 executed plans, follows in
subsequent commits.
