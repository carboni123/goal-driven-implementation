# AGENTS.md

Guidance for coding agents working on this repository. The README explains what the skill does
and how to install it; this file explains how to change it without breaking the people who run it.

## What this repository is

A **skill**, not an application. There is no `package.json`, no dependency, no build step, and
no test runner. Everything ships as Markdown plus three dependency-free Node ESM scripts. The
skill is loaded verbatim by Claude Code and OpenAI Codex CLI, so the prose in `SKILL.md` and
`references/` *is* the product: an agent reads it and acts on it. Write it with the same care as
code.

## Layout and ownership

| Path                                           | Role                                                                                                     | Edit?                                   |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| `skills/goal-driven-implementation/`           | The skill. The only source of truth.                                                                     | Yes                                     |
| `skills/.../SKILL.md`                          | The workflow. Loaded whenever the skill triggers.                                                        | Yes                                     |
| `skills/.../references/*.md`                   | Loaded on demand by `SKILL.md`: prompts, graph-analysis checklist, per-harness routing.                  | Yes                                     |
| `skills/.../assets/plan-template.md`           | The `gdi_schema: 2` plan skeleton every plan is instantiated from.                                       | Yes, in step with the validator         |
| `skills/.../assets/validate-plan.mjs`          | Strict structural validator with built-in fixtures (`--self-test`).                                      | Yes, in step with the template          |
| `skills/.../assets/render-plan-graph.mjs`      | Plan → HTML renderer (graphs, findings, budget, ledger).                                                  | Yes                                     |
| `skills/.../assets/scout-repo.mjs`             | Repository → feature map (apps, features, shared kernels); `--classify` maps paths to units. Self-tested. | Yes, in step with the mapper prompt     |
| `skills/.../assets/validate-report.mjs`        | Structural validator for mapper, reviewer, final, and implementer returns and for anchors. Self-tested.   | Yes, in step with the report formats    |
| `skills/.../assets/agents/claude/gdi-*.md`     | Pinned Claude Code agent definitions. Model and effort live in the frontmatter.                          | Yes, in step with `routing-claude.md`   |
| `skills/.../assets/agents/codex/goal-*.toml`   | Codex custom agents. Model and effort live in the TOML.                                                  | Yes, in step with `routing-codex.md`    |
| `skills/.../assets/VERSION`                    | The release number stamped into every plan as `gdi_version`.                                             | Only on release                         |
| `skills/.../agents/openai.yaml`                | Codex display metadata for the skill.                                                                    | Rarely                                  |
| `scripts/install.mjs`                          | Local installer that copies the skill and agent definitions into `~/.claude` and `~/.codex`.             | Yes                                     |
| `claude/`, `codex/`                            | The two pre-unification forks, frozen as they ran on 2026-09-01. Historical evidence only.               | **Never**                               |
| `CHANGELOG.md`                                 | What changed and the evidence that motivated it.                                                         | Every behavioral change                 |

`claude/` and `codex/` are not stale copies to be synced. They are the baseline the 0.2.0
retrospective was measured against. Do not edit, delete, or "fix" them, and do not copy from
them into `skills/` without saying so in the changelog.

## Things that must stay in agreement

The 0.2.0 changelog records drift between these surfaces as a real bug class. When you change
one, check the others in the same commit.

- **Model and effort pins.** The Claude agent frontmatter (`assets/agents/claude/*.md`), the
  role table in `references/routing-claude.md`, and any pin mentioned in `SKILL.md` must agree.
  Same for the Codex TOMLs and `references/routing-codex.md`. Current Claude pins: implementer
  opus·high, mapper sonnet·medium, verify-class reviewer opus·high, convention reviewer opus·medium.
- **Plan schema.** `assets/plan-template.md`, `validate-plan.mjs`, and the schema description in
  `SKILL.md` describe one contract. A new required surface goes into all three. The validator must
  keep accepting `gdi_schema: 1` plans under the legacy rules and every plan a previous release
  wrote; a validator change that rejects a previously valid plan is a schema bump, not a fix.
- **Reviewer lenses.** The lens list in `references/agent-prompts.md`, the `gdi-reviewer`
  description, and the lens names `SKILL.md` dispatches by must match.
- **Report formats.** The labels and verdict vocabularies in the prompt templates
  (`references/agent-prompts.md`) are what `validate-report.mjs` checks, and the agent
  definitions' standing contracts (`assets/agents/claude/*.md`, `assets/agents/codex/*.toml`)
  restate them so a role does not learn the format only from the dispatch prompt. Renaming a
  label or adding a required one changes all three, plus the validator's self-test fixtures. A
  Codex role uses a stable role label without model, effort, or revision suffixes. Keep labels
  consistent with `references/routing-codex.md`; record schema/release/source provenance in the
  plan, and never treat a role label as proof of the loaded profile revision or runtime model.
- **File lists.** `SKILL.md` ends with a file index, and the README has a Layout block. Adding or
  renaming a file under `skills/` updates both.
- **Install targets.** `scripts/install.mjs` and the README's Install section name the same
  directories and the same agent files.

## Checks to run before you finish

There is no CI. Run these locally and report the output.

```bash
node skills/goal-driven-implementation/assets/validate-plan.mjs --self-test
node skills/goal-driven-implementation/assets/scout-repo.mjs --self-test
node skills/goal-driven-implementation/assets/validate-report.mjs --self-test
node skills/goal-driven-implementation/assets/render-plan-graph.mjs <some-plan.md> --no-open
node scripts/install.mjs --dry-run
```

- Each self-test prints a single `... self-test passed` line.
- When you touch a validator or the scout, add or extend a fixture inside it for the rule you
  changed. A rule with no fixture is untested.
- Run the scout against a real monorepo, not only the fixture, when you change its exclusions
  or detection rules: the fixture cannot reproduce a nested worktree checkout or a package
  store, and both have inflated a map thirtyfold before.
- `plan-template.md` is a skeleton with placeholders and is **not expected** to pass the
  validator. Do not "fix" the template to make it validate.
- The renderer has no fixtures. Render a real plan (or a filled-in copy of the template) and
  open the HTML if you changed rendering.
- Without `--no-open` the renderer launches the system browser on the output file. Always pass
  it in unattended or agent runs; use `--out <file.html>` to pick where the HTML lands.

## Editing the prose

`SKILL.md` is read under a context budget by an agent that has to act on it. Keep it that way:

- Every rule earns its place with a failure it prevents. `CHANGELOG.md` and
  `references/graph-analysis.md` cite the retrospective evidence per rule. A new rule without
  evidence, or a removed rule without an argument that the failure can no longer happen, will be
  questioned in review.
- Put mechanics that differ per harness in `references/routing-<harness>.md`, not in `SKILL.md`.
  `SKILL.md` must read correctly in both Claude Code and Codex CLI.
- Prompt templates in `references/agent-prompts.md` are used verbatim by the orchestrator. Change
  the template, not the surrounding prose, if you want dispatched agents to behave differently.
- Wrap Markdown at about 100 columns to match the existing files. Tables are aligned; run them
  through a formatter or align by hand.
- Files are LF-only (`.gitattributes` enforces it). Do not commit CRLF, and do not commit files
  with NUL bytes; the Claude fork's renderer once shipped with four and it broke silently.

## Versioning and releases

Releases are git tags `vX.Y.Z`. `assets/VERSION` carries the same number and every plan written
by that release records it as `gdi_version`, so retrospectives can correlate plan outcomes with
skill revisions. Do not bump `VERSION` in a feature commit; the bump, the changelog heading, and
the tag belong together.

- **Patch**: prose clarifications, narrowing or re-scoping a rule that misfired in a real run,
  renderer fixes, validator fixes that reject nothing new.
- **Minor**: new rules, new lenses, new plan surfaces that the validator accepts but does not
  require, new installer behavior.
- **Schema bump** (`gdi_schema: N+1`): any change that makes the validator reject a plan a
  previous release wrote. Keep the previous schema's rules in the validator and document the
  resume path in `SKILL.md`, as was done for schema 1 → 2.

Every changelog entry cites what motivated it: a plan, an issue, or a retrospective finding.
"Cleanup" is not a motivation.

## Commits

Conventional-commit prefixes with a scope where one applies: `feat(validator):`, `feat(skill):`,
`feat(install):`, `docs:`, `chore:`. One logical change per commit. Do not commit `.bak-*`
directories or installer output; the installer writes outside the repo and that is intended.

## Ruling floor for this repository

The skill lets a host repository declare its own ruling floor in an AGENTS.md. This is that
declaration for the skill's own repository. Changes below the floor are the agent's call; record
the rationale in the commit message or changelog. Changes on the floor need a human ruling
before they land.

1. **The plan contract.** A `gdi_schema` bump, or any validator change that would reject a plan
   an installed release has already written.
2. **The installed surface.** Renaming or removing an agent role (`gdi-*`, `goal-*`), changing an
   install target directory, or changing the skill's `name` in `SKILL.md` frontmatter. Users have
   these paths in their home directories and their Codex `config.toml`.
3. **Role economics.** Changing a pinned model or effort. These pins encode retrospective evidence
   about where review depth pays; a change needs its own evidence.
4. **Removing a rule** from `SKILL.md`, `graph-analysis.md`, or a reviewer lens. Each one was added
   after a named production failure.

Not floor: wording, ordering, examples, renderer appearance, new optional validator warnings,
new optional plan surfaces, installer flags, and additions to this file.
