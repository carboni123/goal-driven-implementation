# AGENTS.md

Instructions for coding agents that change this repository. `README.md` is for people who install
and run the skill; this file is for whoever edits it.

## What this repository is

One skill, `goal-driven-implementation`, for Claude Code and OpenAI Codex CLI. There is no
package manifest, no dependency, no build, and no CI. The product is Markdown that an agent reads
and acts on at run time, plus dependency-free Node ESM scripts: four under `assets/` and the
installer. A wrong sentence under `skills/` is a bug in the product.

## Layout

Everything shipped lives under `skills/goal-driven-implementation/` (called `<skill>` below).

| Path                                      | What it is                                                                               |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- |
| `<skill>/SKILL.md`                        | The workflow. Loaded whenever the skill triggers; must read correctly in both harnesses. |
| `<skill>/references/agent-prompts.md`     | Dispatch templates the orchestrator uses verbatim.                                       |
| `<skill>/references/graph-analysis.md`    | Graph checklist; each check cites the failure it prevents.                               |
| `<skill>/references/routing-claude.md`    | Claude Code role resolution, tool allowlists, dispatch mechanics.                        |
| `<skill>/references/routing-codex.md`     | Codex role resolution and dispatch mechanics. Names no model.                            |
| `<skill>/assets/plan-template.md`         | The `gdi_schema: 2` plan skeleton. Not expected to pass the validator.                   |
| `<skill>/assets/validate-plan.mjs`        | Plan validator; `--commit-boundaries` checks section commits against Git.                |
| `<skill>/assets/validate-report.mjs`      | Validator for mapper, reviewer, final, implementer, correction returns and anchors.      |
| `<skill>/assets/scout-repo.mjs`           | Repository → feature map; `--classify` maps changed paths to units.                      |
| `<skill>/assets/render-plan-graph.mjs`    | Plan → HTML (graphs, findings, budget, ledger). No fixtures.                             |
| `<skill>/assets/agents/claude/gdi-*.md`   | Claude Code role definitions; model, effort, and tools in the frontmatter.               |
| `<skill>/assets/agents/codex/goal-*.toml` | Codex role definitions; `model` and `model_reasoning_effort` in the TOML.                |
| `<skill>/agents/openai.yaml`              | Codex display metadata for the skill. Codex requires this exact path.                    |
| `<skill>/assets/VERSION`                  | Release number stamped into every plan as `gdi_version`.                                 |
| `scripts/install.mjs`                     | Copies the skill and role definitions into `~/.claude`, `~/.codex`, `~/.agents`.         |
| `CHANGELOG.md`                            | Every behavioral change and the evidence that motivated it.                              |

`<skill>/agents/` and `<skill>/assets/agents/` are different things: the first is Codex's skill
metadata, the second holds role definitions the installer copies. Do not merge them.

The pre-unification Claude and Codex forks were removed in `ddae435`. They are the baseline the
retrospective in `CHANGELOG.md` measured against; read them with `git show v0.6.1:claude/...` or
`git show v0.6.1:codex/...`. Do not restore them to the tree.

## Where each fact lives

Drift between copies of the same fact has shipped as a bug more than once. Keep one source for
each fact and make every other file point to it. When a fact has more than one copy, change all
copies in the same commit.

- **Codex model and effort.** Only in `assets/agents/codex/*.toml`. `routing-codex.md` and the
  README refer to the TOMLs and do not name models. The Codex stall-ladder escalation uses the
  planner's pins from `goal-planner.toml`, so editing that TOML changes the escalation route too.
- **Claude model and effort.** The agent frontmatter is the source. The role table in
  `routing-claude.md` repeats it and must match. The Claude escalation route (`model: "fable"`
  per call) lives in `routing-claude.md` and `SKILL.md` step 6.
- **Claude tool allowlists.** Each frontmatter `tools` line and the allowlist table in
  `routing-claude.md` must match. Keep every tool a role's contract uses: the implementer needs
  `Agent` for its read-only helpers and `TaskStop` for background commands.
- **Plan schema.** `plan-template.md`, `validate-plan.mjs`, and the schema description in
  `SKILL.md`. A new required surface goes into all three.
- **Report formats.** Labels and verdict words in `agent-prompts.md` are what
  `validate-report.mjs` checks, and the role definitions restate them so a role does not learn
  its format only from the dispatch prompt. Change all three plus the validator fixtures.
- **Reviewer lenses.** The lens list in `agent-prompts.md`, the `gdi-reviewer` description, and
  the lens names `SKILL.md` dispatches by.
- **Correction carrier.** `SKILL.md` steps 2, 3, and 6, prompts §2 and §5, the acceptance
  protocol in `plan-template.md`, the carrier rule in `routing-claude.md`, and the README's run
  description. Codex has no carrier rule and stays resume-only until a Codex run yields per-role
  usage.
- **Role labels.** Codex roles attest with stable labels (`gdi-planner`, `gdi-implementer`,
  `gdi-mapper`, `gdi-reviewer`) that carry no model, effort, or revision suffix. A label is not
  proof of which profile or model ran; provenance goes in the plan.
- **File lists.** The file index at the end of `SKILL.md` and the README's Layout block. Adding,
  renaming, or removing a file under `skills/` updates both.
- **Install targets.** `scripts/install.mjs` and the README's Install section name the same
  directories and agent files.

## Checks

Run all of these before you report done, and include the output.

```bash
S=skills/goal-driven-implementation/assets
node $S/validate-plan.mjs --self-test
node $S/validate-report.mjs --self-test
node $S/scout-repo.mjs --self-test
node $S/render-plan-graph.mjs <plan.md> --no-open --out /tmp/plan.html
node scripts/install.mjs --dry-run
```

- Each self-test prints one `... self-test passed` line.
- A changed rule in a validator or the scout gets a new or extended fixture in that script's
  self-test.
- After changing the scout's exclusions or detection, also run it on a real monorepo. The fixture
  cannot reproduce a nested worktree or a package store, and both have inflated a map thirtyfold.
- The renderer has no fixtures. After changing it, render a real plan and open the HTML.
- Always pass `--no-open` to the renderer; without it the script opens a browser.
- Never run `install.mjs` without `--dry-run` unless the user asks. It writes to the user's home
  directory.
- Do not edit `plan-template.md` to make it pass the validator. It contains placeholders.

## Writing the skill's prose

Files under `skills/` are read by an agent under a context budget, on every load. Write for that
reader.

- **Know the reader.** The orchestrator reads `SKILL.md`, `references/`, and the plan template. A
  dispatched role reads only its own definition and its dispatch prompt. Keep a sentence only if
  it changes what that reader does or settles a case the rule leaves open.
- **A role definition holds only what the role can act on.** A role cannot change its tools,
  model, effort, or install location, and skill-relative paths do not resolve where it runs.
  Host and installer guidance goes in the routing reference.
- **Harness differences go in `references/routing-<harness>.md`**, not in `SKILL.md`.
- **Change the template, not the prose around it.** `agent-prompts.md` templates are pasted into
  dispatches verbatim.
- **Use the literal phrase.** No metaphor, aphorism, or contrast written for effect; the reading
  agent may act on connotations the writer did not intend.
- **Keep the history out.** Sample sizes, dates, how a threshold was derived, rejected options,
  and what the text used to say go in `CHANGELOG.md`. An `_Origin:_` note may name the prevented
  failure in about three lines.
- **Every rule cites a failure.** A new rule needs evidence; removing one needs an argument that
  the failure can no longer occur. `CHANGELOG.md` and `graph-analysis.md` hold the citations.
- Wrap Markdown at about 100 columns and align tables. Files are LF-only (`.gitattributes`) and
  must contain no NUL bytes.

## Versions and the changelog

- A release is a `vX.Y.Z` tag, a matching `assets/VERSION`, and a changelog heading, committed
  together as `chore(release): prepare X.Y.Z`. Do not bump `VERSION` in a feature commit.
- Work between releases goes under the top changelog heading until it is tagged.
- **Patch:** prose clarifications, narrowing a rule that misfired, renderer fixes, validator fixes
  that reject nothing new. **Minor:** new rules, lenses, optional plan surfaces, installer
  behavior. **Schema bump** (`gdi_schema: N+1`): anything that makes the validator reject a plan
  an earlier release wrote. The validator keeps the old schema's rules, and `SKILL.md` documents
  the resume path.
- Every changelog entry names what motivated it: a plan, an issue, a maintainer report, or a
  retrospective finding.

## Commits

Conventional commits with a scope: `feat(skill):`, `feat(validator):`, `feat(install):`,
`fix(...)`, `docs(skill):`, `chore(release):`. One logical change per commit, with the changelog
entry in the same commit. Do not commit `.bak-*` directories, installer output, or
`.hubgrid-artifacts/`.

## Ruling floor

`SKILL.md` lets a host repository declare its own ruling floor. This is the floor for this
repository. Below it, decide and record the reason in the commit message or changelog. On it,
stop and get a human ruling before the change lands.

1. **The plan contract.** A `gdi_schema` bump, or a validator change that rejects a plan an
   installed release already wrote.
2. **The installed surface.** Renaming or removing a role (`gdi-*`, `goal-*`), changing an
   install directory or the `<skill>/agents/openai.yaml` path, or changing the skill `name` in
   `SKILL.md` frontmatter. Users have these paths in their home directories and Codex config.
3. **Role economics.** Changing a model or effort in a role definition or an escalation route.
   The pins encode evidence about where review depth pays; a change needs its own evidence.
4. **Removing a rule** from `SKILL.md`, `graph-analysis.md`, or a reviewer lens.

Not floor: wording, ordering, examples, renderer appearance, new optional validator warnings,
new optional plan surfaces, installer flags, and edits to this file.
