# goal-driven-implementation

A skill for coding agents that turns a roadmap, PRD, ADR, or issue into a **goal-driven
implementation plan** and executes it: one orchestrator that never writes product code, one
implementer per plan section, parallel read-only reviewers, a whole-branch final review against
current `main`, and a plan file that doubles as the progress ledger. Works in Claude Code and
OpenAI Codex CLI from one `SKILL.md`.

## Install

With the [skills CLI](https://skills.sh):

```bash
npx skills add carboni123/goal-driven-implementation
```

Or clone and run the installer, which also places the agent definitions the skills CLI does not:

```bash
git clone https://github.com/carboni123/goal-driven-implementation
node goal-driven-implementation/scripts/install.mjs        # both harnesses
node goal-driven-implementation/scripts/install.mjs --only codex
```

Targets: `~/.claude/skills/`, `~/.claude/agents/` (four `gdi-*` roles), `~/.codex/skills/`,
`~/.agents/skills/`, `~/.codex/agents/` (three `goal-*` roles). Existing copies are moved to a
`.bak-<timestamp>` sibling.

## What a run looks like

1. **PLAN** — map the code, write the plan from `assets/plan-template.md`, draw the topology
   graph (inputs → sections → goal exit tests → final review → gates → PR), run the
   [graph analysis checklist](skills/goal-driven-implementation/references/graph-analysis.md),
   validate, render, and either wait for the user's ruling on floor items or start.
2. **EXECUTE** — per section: aggregate context if anchors are stale, one implementer, three to
   eight review lenses in parallel, the orchestrator re-runs the gate and reads the diff, then
   accepts (commit section + ledger together) or sends exact gaps back to the same implementer
   until it converges.
3. **COMPLETE** — re-baseline on `origin/main`, whole-branch final review (seams, contract
   coherence, reader sweep of the diff's complement, claim decay, rollout window), expensive
   gates once against the reviewed candidate, deferrals filed as issues, graph annotated from
   the ledger, report.

The **ruling floor** is the customer contract: money customers pay, the public integration
contract, irreversible outward actions. Everything else the orchestrator decides and records.
A host repository can declare its own floor and the skill uses that instead.

## Layout

```
skills/goal-driven-implementation/
  SKILL.md                       the workflow (loaded when the skill triggers)
  agents/openai.yaml             Codex display metadata
  assets/
    VERSION                      release stamped into every plan as gdi_version
    plan-template.md             gdi_schema: 2 plan skeleton
    validate-plan.mjs            strict structural validator (--self-test)
    render-plan-graph.mjs        plan → HTML (graphs, findings, budget, ledger)
    agents/claude/gdi-*.md       pinned Claude Code roles
    agents/codex/goal-*.toml     Codex custom agents
  references/
    agent-prompts.md             mapper, implementer, reviewer lenses, final review, relays
    graph-analysis.md            the analysis checklist, each class with the failure it prevents
    routing-claude.md            role resolution and dispatch in Claude Code
    routing-codex.md             role resolution and dispatch in Codex CLI
scripts/install.mjs              local installer
claude/, codex/                  the two forks as they were on 2026-09-01 (baseline, unchanged)
```

## Versioning

Releases are git tags (`v0.2.0`). `assets/VERSION` carries the same number and every plan the
skill writes records it as `gdi_version`, so a later retrospective can correlate plan outcomes
with skill revisions. `CHANGELOG.md` records what changed and the evidence that motivated it.

Plan schema: `gdi_schema: 2` is current. The validator still accepts `gdi_schema: 1` plans with
the legacy rules; resuming one adds the schema-2 surfaces without touching approved scope.

## Development

```bash
node skills/goal-driven-implementation/assets/validate-plan.mjs --self-test
node skills/goal-driven-implementation/assets/validate-plan.mjs path/to/plan.md
node skills/goal-driven-implementation/assets/render-plan-graph.mjs path/to/plan.md --no-open
```

Change the skill in `skills/goal-driven-implementation/`, bump `assets/VERSION`, add a
changelog entry that cites the plan or issue that motivated the change, tag.

## License

MIT.
