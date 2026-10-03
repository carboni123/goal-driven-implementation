# goal-driven-implementation

A skill for coding agents that turns a roadmap, PRD, ADR, or issue into a **goal-driven
implementation plan** and executes it: one orchestrator that never writes product code, one
planner that defines concise goals and execution order, one implementer per plan section, parallel
read-only reviewers, a whole-branch final review against current `main`, and a plan file that
doubles as the progress ledger. Works in Claude Code and OpenAI Codex CLI from one `SKILL.md`.

Preferred Codex routing: the user/client-selected main-session orchestrator, a dedicated plan
author that inherits the orchestrator's model and effort after validated mapping, mappers, the
sole implementer, and independent reviewers. Worker models and efforts are configured in
`skills/goal-driven-implementation/assets/agents/codex/`. The skill records the orchestrator's
actual route or unknown metadata. The planner filters mapper evidence into each section and
returns concise goals, scope, dependencies, and acceptance checks; implementers choose the design
and implementation steps. Reviewers check the resulting code and the plan's assumptions. These
are maintainer-selected cost preferences, with outcomes and available usage recorded per role.
The Codex planner is `goal-planner`; its TOML omits model and effort so they inherit.
The orchestrator's model remains user-selected.
The Codex implementer is `goal-implementer`; model and effort stay in its configuration.

Claude Code routing: the user-selected main session orchestrates; `gdi-planner`, which inherits
the session's model and effort, organizes goals and filters mapper evidence in a fresh context;
`gdi-implementer` (Claude Opus 5.5 high) builds; `gdi-mapper` (Sonnet medium) maps;
`gdi-reviewer` and `gdi-convention-reviewer` (Claude Opus 5.5 medium) review. Preflight diffs the
installed agent definitions against the skill's copies before the first dispatch, because a stale
definition runs an older contract while the plan records the current release.

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

Targets: `~/.claude/skills/`, `~/.claude/agents/` (five `gdi-*` roles), `~/.codex/skills/`,
`~/.agents/skills/`, `~/.codex/agents/` (four `goal-*` roles). Existing copies are moved to
`~/.gdi-backups/<timestamp>/`, outside the directories a harness scans, so a backup is never
loaded as a second skill. `.bak-<timestamp>` copies left beside the targets by an earlier
installer are moved there too. An unknown flag is an error and installs nothing.

For an existing `goal-implementer-terra` installation, migrate its config registration and other
references to `goal-implementer`, retire the old registration/file, and reload Codex. The installer
prints the new snippet and leaves legacy config/files intact. See the
[upgrade instructions](skills/goal-driven-implementation/references/routing-codex.md#installing-the-roles).

## What a run looks like

1. **PLAN** — scout the repository into a feature map (`assets/scout-repo.mjs`, no LLM call),
   map the code one unit at a time, dispatch the plan author after mapper returns validate (or
   use the existing mapping exception when the orchestrator has verified every context anchor),
   define concise goals and execution order in `assets/plan-template.md`, filter each section's
   mapper evidence, draw the topology graph (inputs → sections → goal
   exit tests → final review → gates → PR), run the
   [graph analysis checklist](skills/goal-driven-implementation/references/graph-analysis.md),
   validate, render, have the plan author inspect supplied screenshots, and either wait for the
   user's ruling on floor items or start. The plan author is a dedicated role in both harnesses
   (`gdi-planner`, `goal-planner`); the orchestrator checks its write boundary and re-validates.
2. **EXECUTE** — per section: aggregate context if anchors are stale, one implementer, three to
   eight review lenses in parallel. Dispatch is by file: `assets/section-brief.mjs` writes the
   section's assignment from the plan (section block, rulings, corrections in force, gates,
   preflight, baseline) and prints short dispatch stubs; each role reads its rules from
   `assets/prompts/`. In Claude Code an agent writes its report to the plan's run directory and
   validates it before returning. Every return is validated structurally
   (`assets/validate-report.mjs`: labels, verdict, evidence tags, anchors that resolve) before the
   orchestrator acts on it, the orchestrator verifies the evidence and reads the diff, then accepts
   (commit section and acceptance evidence, then record and verify its SHA) or sends exact gaps
   back until it converges: to the same implementer, or in Claude Code to a fresh one when the
   first returned with a large context. After a correction, the reviewers that rejected are
   resumed to rule on their own findings. Reviewer findings name the trigger that reaches them;
   one that no existing caller, writer, client, or deployment failure produces is refuted as
   unreachable. A correction loop that stalls supplies the missing fact, splits an oversized
   section when its boundary no longer holds, and enters **sign-off mode** when review stops
   converging. The orchestrator checks each finding, records a required correction, refutation,
   or non-blocking note with evidence, and signs off without requiring reviewer agreement.
   Workers stay on their usual model and effort. Required corrections, gates, and floor rulings
   still block acceptance. Original verdicts, finding dispositions, and evidence remain in the
   plan; the ledger records `review: sign-off (<reason>)`. The same mode applies to final review.
   The orchestrator does not pause between
   sections except for a floor ruling, approval, a blocker, or the terminal action.
   Implementation is sequential by default. Sections the plan places in a **parallel batch** (no
   dependency between them, declared and disjoint write sets, no shared mutable realm, checks
   that pass without a sibling's result) are implemented at the same time in Claude Code, in one
   checkout; each is reviewed as it returns, and the batch is committed one section at a time
   after a join check on the combined tree. Codex runs batch members one after another.
3. **COMPLETE** — re-baseline on `origin/main`, whole-branch final review (seams, contract
   coherence, reader sweep of the diff's complement, claim decay, rollout window), expensive
   gates once against the reviewed candidate, deferrals filed as issues, graph annotated from
   the ledger, report. The report leads with the outcome in the user's terms (delivered, in
   part, not delivered), then the calls that narrowed the request and what is out of scope, then
   the size of the change by kind, then the process record.

A change that is one section, touches nothing on the floor, and writes nothing into shared state
runs the **bounded-fix lane** instead: same plan file and implementer, two review lenses, the
affected tests, no whole-branch fan-out. Eligibility is decided by what the diff touches, not its
size, and any disqualifier found mid-run continues under the full loop without redoing work.
The orchestrator writes a bounded plan itself, and parts of the template that do not apply take
one line.

A change that also touches only text no program runs or reads (docs, runbooks, comments, roadmap
entries) runs the **direct lane**: no plan file and no mapper, planner, or implementer. The
orchestrator checks each claim against the code, writes the change, runs the documentation
checks, and has one independent reviewer check doc-truth and convention/scope. The commit body
records the lane, premise corrections, checks, and review. A disqualifier moves the work to the
bounded lane or the full loop.

Verification is proportionate in both lanes: focused defect reproduction, additional sensitivity
checks for concrete risks, and evidence shared across roles while its inputs remain valid.
Broader gates run against the final reviewed candidate; explicit user and host checks still apply
at their required stage. A rejection invalidates affected evidence, not every previous result.

Sections are commit-sized increments; milestones group them into PR or delivery checkpoints.
Each section explains why its result is coherent without the next section. Broad milestone gates
do not automatically block constituent commits, and a commit does not claim milestone completion.
When discovery invalidates the boundary, the orchestrator requests a bounded replan of remaining
work, retaining accepted commits and assigning every unresolved finding. Atomic invariants stay
together; independent behaviors get separate sections.

The orchestrator verifies accepted SHAs against Git before dispatching the next section and
checks that no completed section's product changes remain uncommitted. The SHA-only ledger
update can accompany the next section commit; final ledger updates are committed at milestone
closure. Git validation checks commit identity and dependency ancestry, while diff ownership
and behavioral correctness still require review.

The **ruling floor** defaults to commercial terms, the public integration contract, and
irreversible outward actions. Everything else the orchestrator decides and records. A host
repository declares its own floor in its AGENTS.md or an ADR and the skill uses that instead; the
default is written for a product with paying users and a public API and is not a fit for every
repository.

## Layout

```
skills/goal-driven-implementation/
  SKILL.md                       the workflow (loaded when the skill triggers)
  agents/openai.yaml             Codex display metadata
  assets/
    VERSION                      release stamped into every plan as gdi_version
    plan-template.md             gdi_schema: 2 plan skeleton
    validate-plan.mjs            structural, batch, boundary, and Git commit checks (--self-test)
    section-brief.mjs            plan → one section's assignment file and dispatch stubs (--self-test)
    render-plan-graph.mjs        plan → HTML (graphs, findings, budget, ledger)
    scout-repo.mjs               repository → feature map; --classify maps paths to units (--self-test)
    validate-report.mjs          structural check of agent returns and anchors; --fix (--self-test)
    prompts/*.md                 rules and report format each role reads (planner, mapper,
                                 implementer, reviewer, final-reviewer, correction)
    agents/claude/gdi-*.md       pinned Claude Code roles (planner, implementer, mapper, two reviewers)
    agents/codex/goal-*.toml     Codex custom agents
      goal-planner.toml         plan-authoring role
      goal-implementer.toml     implementation role
      goal-explorer.toml        read-only mapper role
      goal-reviewer.toml        read-only reviewer role
  references/
    agent-prompts.md             dispatch stubs, run directory and reports, follow-ups, relays
    graph-analysis.md            the analysis checklist, each class with the failure it prevents
    routing-claude.md            role resolution and dispatch in Claude Code
    routing-codex.md             role resolution and dispatch in Codex CLI
scripts/install.mjs              local installer
```

The pre-unification Claude and Codex forks are in Git history: `git show v0.6.1:claude/...`.

## Versioning

Releases are git tags (`vX.Y.Z`). `assets/VERSION` carries the same number and every plan the
skill writes records it as `gdi_version`, so a later retrospective can correlate plan outcomes
with skill revisions. `CHANGELOG.md` records what changed and the evidence that motivated it.

Plan schema: `gdi_schema: 2` is current. The validator still accepts `gdi_schema: 1` plans with
the legacy rules; resuming one adds the schema-2 surfaces without touching approved scope.

## Development

```bash
node skills/goal-driven-implementation/assets/validate-plan.mjs --self-test
node skills/goal-driven-implementation/assets/scout-repo.mjs --self-test
node skills/goal-driven-implementation/assets/validate-report.mjs --self-test
node skills/goal-driven-implementation/assets/section-brief.mjs --self-test
node skills/goal-driven-implementation/assets/validate-plan.mjs path/to/plan.md
node skills/goal-driven-implementation/assets/validate-plan.mjs path/to/plan.md --commit-boundaries
node skills/goal-driven-implementation/assets/validate-plan.mjs path/to/plan.md --repo-root path/to/repo
node skills/goal-driven-implementation/assets/validate-plan.mjs path/to/plan.md --repo-root path/to/repo --write-sets A1,A2
node skills/goal-driven-implementation/assets/section-brief.mjs path/to/plan.md A1 --run-dir /tmp/run --repo-root path/to/repo
node skills/goal-driven-implementation/assets/validate-report.mjs --kind reviewer --repo-root path/to/repo --input report.md --fix
node skills/goal-driven-implementation/assets/render-plan-graph.mjs path/to/plan.md
node skills/goal-driven-implementation/assets/scout-repo.mjs path/to/repo --out feature-map.yml
```

Change the skill in `skills/goal-driven-implementation/`, bump `assets/VERSION`, add a
changelog entry that cites the plan or issue that motivated the change, tag.

## License

MIT.
