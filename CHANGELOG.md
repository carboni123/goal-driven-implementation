# Changelog

Entries cite the evidence that motivated them. "Retrospective" means the 2026-09-01 review of 90
executed plans (July 2 to September 1, 2026): roughly 410 sections and 380 correction rounds.

## 0.7.0 — 2026-09-22 (tag `v0.7.0`)

### Changed — Codex routing reads pins from the role TOMLs

**Maintainer report, 2026-09-26.** Commit `01dc6a2` changed the Codex TOML pins (mapper
`gpt-6-luna` · `high`, implementer `gpt-6-sol` · `high`, reviewer `gpt-6-sol` · `medium`) but
`references/routing-codex.md` and the README still named the earlier Luna `max`, Terra `high`,
and Terra `xhigh` routes, so a direct-route (2) dispatch requested models the TOMLs no longer pin.
The maintainer ruled that the TOMLs under `assets/agents/codex/` are the source of truth.

- `routing-codex.md` names no model: the role table, direct-route list, fallbacks, escalation
  ledger note, and resume rule point to each role's `model` and `model_reasoning_effort`.
- The implementer escalation route uses the planner's pins from `goal-planner.toml`, which today
  equal the ruled `gpt-6-astra` · `xhigh`; changing the planner TOML now changes the escalation
  route as well.
- The economics note drops the Astra-low and Luna-implementer history (recorded in 0.5.0 and
  0.5.1) and keeps the instruction not to claim prices or quality equivalence.
- README routing summary, stall-ladder description, and Layout block no longer name models.

### Changed — ast-grep guidance for Codex agents

**Maintainer request, 2026-09-22.** Add `ast-grep` to Codex agents and check whether Codex has
Claude-style tool allowlists. The official [custom agent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents)
defines role files as session configuration layers; the [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)
documents built-in tool settings and per-MCP-server filters, but no general agent tool allowlist.

- All four Codex profiles and the fallback dispatch wrapper now direct syntax-aware searches
  through the optional `ast-grep` CLI, retaining `rg` and targeted reads for other searches.
  Search scope and each role's existing write boundary still apply.
- The routing reference explains the supported configuration and CLI prerequisite. No unsupported
  TOML tool list or machine-specific MCP server is added. The local CLI was already installed
  (`ast-grep 0.45.3`); the installer does not install it on other machines.

### Changed — stall ladder, implementer escalation, reachable review findings

**Maintainer report, 2026-09-22.** Orchestrators running the skill stopped at the convergence
pause many times. The maintainer's usual fix was to tell the orchestrator to use a stronger model
for the implementer, which the routing references prohibited ("do not promote it to a costlier
model or effort mid-run"). Reviewers also raised defects that needed states or callers the
repository never produces; each one cost a correction round. Anthropic's Opus 5.5 guide
(2026-09-22) says the model sometimes stops to report or to offer to continue on long runs, and
that it follows instructions that name which stops are wanted.

- **Stall ladder** (`SKILL.md` step 6, prompts §5, template rules and diagram). When a round
  repeats a defect mechanism, stops reducing findings, or invalidates the commit boundary, the
  orchestrator takes the first step that applies: supply the missing fact, split an oversized
  section with a bounded replan, escalate a commit-sized section's implementer once, and report a
  blocker only after that. Steps 1–3 need no user approval. Floor items still go to the user.
- **Implementer escalation route.** This is a role-economics change the maintainer ruled on for
  this entry. Claude Code: a fresh `gdi-implementer` with a per-call `model: "fable"`, which
  keeps the definition's effort, tools, and contract. Codex: a fresh implementer on the direct
  route at `gpt-6-astra` · `xhigh`. At most once per section, always via the fresh-carrier body,
  recorded on the ledger's `routing:` field and the round line. If the route is unavailable, the
  orchestrator reports a blocker and does not substitute another route. Base pins are unchanged.
  Not yet measured: the escalation's cost per accepted section or its effect on round counts.
- **Keep going.** The EXECUTE loop says to accept a section and dispatch the next one in the same
  turn, and lists the stops that exist. The implementer contract (template §2, both harness
  definitions) says `STATUS: blocked` means no in-scope progress is possible, and that a
  difficult in-section defect is not a blocker.
- **Reachable findings.** Every section and final-review finding carries a `trigger:` segment:
  the client request, caller, state a writer produces, or deployment failure that reaches it at
  this commit, or `static` with the rule or claim it breaks. For security, a hostile client
  counts as a client. A defect that has no existing trigger goes under NOTES, and the orchestrator
  refutes a finding whose named trigger does not exist as `unreachable`. `validate-report.mjs`
  rejects a finding without `trigger:` (new fixtures for reviewer and final). Reviewers whose
  installed definitions predate this change get the format from the dispatch prompt and are
  re-prompted once on a missing trigger. No lens checklist item was removed.

### Changed — commit-sized implementation sections

**Maintainer request, 2026-09-22, following tyxter-messaging #968/#1002.** The workflow committed
accepted D1, D2, and D3 separately, but each section accumulated substantial work before that
boundary. D3 combined five automation entry points, phone provenance, effect ownership, and
cancellation/recovery, then required PR-level acceptance before its first commit. Its six
correction rounds ended in merge commit `4e6ba4fac`; 245 first-parent changed files included
incoming main changes, while Git's remerge diff showed 48 files, 4,712 additions and 199 deletions.
The evidence supports better decomposition rather than merely repeating the instruction to commit.

- Sections now justify their commit boundary and name the milestone that consumes them.
  Independent behaviors are split while atomic invariants stay together. No arbitrary file,
  line, time, or correction-count limit is introduced.
- Planner prompts and both harness profiles separate milestone gates from section checks.
  Implementers report discoveries that invalidate a boundary; the orchestrator requests a
  bounded replan within approved scope, preserving evidence and unresolved findings.
- Repeated concrete defects pause the correction loop for diagnosis; growth triggers an
  internal bounded replan. These do not automatically become user approval requests. The
  previous class-wide escalation also stopped #1002 over successive generated-artifact misses;
  the authorized workflow adjustment retains floor escalation and reports genuine blockers.
- Upstream merges are completed separately from section commits. Role/model pins, acceptance
  checks, installed paths, plan schema, and release version are unchanged.
- Added explicit validator modes: `--commit-boundaries` checks populated milestone/stopping-point
  fields; `--repo-root` resolves accepted SHAs, branch reachability, distinct section commits,
  and dependency ancestry using read-only Git commands. Existing structural invocation is
  unchanged. Neither mode claims to prove behavioral correctness or ownership of a diff.
- Acceptance now records the actual SHA after committing and verifies it before further product
  work. The orchestrator inspects residual staged/unstaged/untracked changes against its baseline.
  SHA-only ledger receipts can join the next section commit, avoiding self-referential hashes.
- Independent scenario evaluation found two stale template rules: all authored tests blocked
  acceptance regardless of scheduled stage, and its convergence diagram still escalated broad
  repeated classes. Aligned the rules and diagram with section/milestone gates and bounded replans.
- Validator review caught multiline template placeholders passing the boundary check; added a
  regression fixture. Self-tests cover real Git identity, ancestry, distinct commits, CLI parsing,
  and preservation of Git state. These checks and scenario evaluation do not establish outcomes
  from a full feature implementation under the revised workflow.

## 0.6.1 — 2026-09-19

### Changed — Claude Code context economy

**Maintainer request, 2026-09-18, after a spend measurement.** 201 local Claude Code transcripts
(57 main sessions) were weighted per token as input 1, cache write 1.25, cache read 0.1, output 5.
Cache reads were 62% of weighted spend, cache writes 28%, output 10%, uncached input 0.1%: a role
costs its context size times its turns. Sixteen `gdi-implementer` runs were 32% of all spend
(median 141 turns, 1.07 tool calls per turn, context 53k at the first turn and 270k at the last).
The measured definitions were the installed 0.5.0-era copies, not 0.6.0. The measurement scripts
are in the maintainer's checkout under `spend/` (gitignored), not in the installed skill. The
numbers below come from one machine and mostly one host repository.

- **Tool allowlists on four roles.** `gdi-*` roles with no `tools` key started their first turn
  at 47k to 50k tokens; a custom role on the same machine with a six-tool allowlist started at
  7.8k. That base is re-read on every turn (4,700 `gdi-*` turns in the sample): about a sixth of
  implementer spend and roughly half of a reviewer's context. `gdi-implementer` now pins `Read,
  Edit, Write, NotebookEdit, Bash, PowerShell, Grep, Glob, Agent, ToolSearch, Monitor, TaskStop`;
  `gdi-mapper`, `gdi-reviewer`, and `gdi-convention-reviewer` pin `Read, Grep, Glob, Bash,
  PowerShell` and keep their `disallowedTools`. The lists cover 5,536 of the 5,537 tool calls
  those roles made across 106 measured runs (the exception: one implementer `SendMessage`).
  `gdi-planner` keeps every tool for the rendered-graph pass. A host that needs an MCP server in
  a role adds it in a project-scope copy, recorded as a host override and not as a stale role.
  Documented harness behavior relied on: an unavailable listed tool (`PowerShell` outside
  Windows) is dropped without an error, `disallowedTools` applies before `tools`, and MCP tools
  are inherited unless an allowlist omits them. Not yet verified: that the allowlist shrinks the
  first-turn context and does not only block calls. That is inferred from the measurement above
  and from the documented rule that a subagent builds its tool set before its first request; to
  verify, compare a role's first-turn context after installing. Role names, models, and efforts
  are unchanged; installed copies need a reinstall and a new session.
- **Stale dispatch mechanic removed.** `routing-claude.md` told the orchestrator to pass
  `run_in_background: false` for the implementer. The `Agent` tool documents no such argument,
  and all 16 measured implementer dispatches ran in the background and reported through a
  completion notification.
- **Why resumes missed the prompt cache.** A resumed subagent can read the cache entries its
  first run wrote, but a subagent's prompt cache expires after five minutes by default, even on a
  subscription, and a review round takes longer. The one-hour option (`subagentPromptCacheTtl` in
  settings, or `experimental.cacheTtl: 1h` in a definition) is not set: the key is experimental,
  a one-hour cache write costs more than a five-minute one on the API, no run here has measured
  the trade, and it would not reduce the larger cost, which is re-reading a large context on
  every later turn.
- **Correction carrier (re-scopes "never respawn mid-section").** Work after an implementer's
  first report was 43% of implementer spend in 24% of its turns, at 2.2 to 3.1 times the first
  dispatch's cost per turn. 22 of 28 orchestrator follow-ups arrived after the prompt cache had
  expired and re-wrote the whole context (12.5% of implementer spend), and every later turn
  re-read a context that was 183k to 543k tokens when the agent stopped. A rejection now goes to
  a fresh section-correction implementer when the rejected report's completion notification
  shows `subagent_tokens` above 150k; otherwise, and always for decision relays and
  report-validation errors, the same agent is resumed. The part of the old rule that remains: an
  implementer is never replaced before it returns a validated report, because until then its
  context is the only record of the section's work. After a validated report, the report plus
  the uncommitted diff is a complete handoff. `SKILL.md` steps 2, 3, and 6, prompts reference §2
  and §5 (new fresh-carrier body, validated with `--kind implementer`), `routing-claude.md`
  (Correction carrier), the plan template, and the README agree. Codex keeps resume-only: no
  Codex run has produced per-role usage to measure. The 150k threshold was calculated and has
  not been tested in a run. At about 19 turns per round, resuming costs roughly 2.9 times the
  context; a fresh agent costs roughly 4 times a 90k working context (base, section, prior
  report, a re-read of the touched files, some orientation turns). The two are equal near 120k,
  and 150k leaves margin for a fresh agent that needs an extra round. No measured stop was under
  183k, so no measurement covers the same-implementer branch. Fresh rounds are marked
  `(carrier: fresh)` in the ledger so a retrospective can compare rounds-to-converge and escaped
  defects for both carriers.
- **Usage is observable.** `routing-claude.md` said the Agent tool exposes no token counts. The
  completion notification of a background agent carries `<usage>` with `subagent_tokens`,
  `tool_uses`, and `duration_ms` (40 of 43 implementer notifications in the sample), and
  `subagent_tokens` matched the agent's context size at that stop. The field names are observed,
  not documented: the harness docs state only that a metadata trailer carries token counts and
  duration. The ledger `cost:` field records the block per return; it is a context size, not a
  billed total.
- **Implementer tool calls.** 94% of implementer turns made one tool call, 214 of 2,240 turns
  were in runs of three or more read-only calls of one kind, and 443 turns read code with
  `cat`/`sed`/`grep` in the shell. Six waits on a helper subagent each outlasted the prompt cache
  (2.1% of implementer spend). The `gdi-implementer` standing contract now batches independent
  read-only calls, reads a file once with Read, and dispatches helpers in the first turns or not
  at all.
- **Considered and not changed.** Capping test and build output: together they were 4.6% of
  implementer spend. The `effort` pin: output tokens were 2.2% of spend. Model and effort pins
  are unchanged.
- **Prose audience rules (AGENTS.md).** Maintainer review, 2026-09-19, of the first draft of the
  changes above. That draft put installer guidance and a skill-root path in the
  `gdi-implementer` definition, where the role can act on neither, and put sample sizes, the
  threshold derivation, and a rejected cache option in `routing-claude.md`, which the
  orchestrator re-reads before dispatch. Those moved into this entry. "Editing the prose" in
  AGENTS.md now names the reader of each file under `skills/`, limits an agent definition to
  what its role can act on, sends evidence and rejected options to the changelog, and requires
  literal phrasing.

## 0.6.0 — 2026-09-13

### Changed — Claude Code routing reviewed against the 0.5.x Codex changes

**Maintainer request, 2026-09-13.** Review the Claude routing against the 0.5.0 and 0.5.1 Codex
changes and improve it; both releases had left Claude unchanged by scope. Findings and changes:

- **Dedicated Claude planner.** New `assets/agents/claude/gdi-planner.md`, dispatched with the
  shared §0 planner prompt after PLAN-mode mapping validates, as Codex dispatches `goal-planner`.
  It pins `model: inherit` and no effort: plan quality tracks the session the user selected, no
  new economics pin is introduced, and the role's value is a fresh context holding only the
  validated brief, rulings, and open questions, plus an author distinct from the session that
  approves, reviews, and commits. The orchestrator checks the write boundary with `git status`
  when the planner returns and re-runs plan validation itself. Fallback when the type is not
  installed: the main session authors the plan under the same contract, recorded as
  `fallback: main-session planner`. `SKILL.md`, the planner prompt, `graph-analysis.md`, the plan
  template, both harnesses' reviewer definitions, README, and AGENTS.md no longer describe
  Claude planning as main-session only.
- **Definition currency in preflight.** On 2026-09-13 the installed `~/.claude/agents/gdi-*.md`
  on the maintainer's machine dated from September 2 and 3: `gdi-implementer.md` lacked the 0.4.0
  RETIRES, sensitivity, and evidence-reuse rules, and the installed skill was 0.5.0. Every Claude
  run since had dispatched to older contracts while its plan recorded the current release.
  `routing-claude.md` gains a verification protocol with the same three facts as Codex
  (requested / role-confirmed / model-confirmed): role-confirmed requires a `diff` of the loaded
  definition against the skill's copy, with project scope taking precedence over user scope;
  model-confirmed is `unknown` unless the user reads the agent's row in `/tasks`, because the
  Agent tool result reports neither model nor effort. It also records that
  `CLAUDE_CODE_SUBAGENT_MODEL_FORCE` overrides every frontmatter pin.
- **Standing contracts aligned with the Codex TOMLs.** `gdi-implementer` gains the task-boundary
  and premise-mismatch rule, permitted independent preparation before a decision brief, routine
  choices under CALLS with existing rulings honored, citation of the exact blocking clause, the
  defect-injection rule for sensitivity probes, and no second summary. `gdi-mapper` gains the
  area boundary and the rule that line existence is not semantic proof. `gdi-reviewer` verifies
  planner premises independently and checks consolidation outcomes; `gdi-convention-reviewer`
  checks consolidation outcomes and tracked generated artifacts. Mapper, both reviewers, and the
  planner disable the Agent tool in their definitions instead of relying on the prompt alone.
- **Dispatch mechanics.** Never pass `isolation` to a `gdi-*` dispatch: a worktree child branches
  from the default branch and its edits land in another checkout, so the orchestrator's diff,
  the reviewers, and the section commit would miss the work. Claude reports carry no ROUTING
  line; routing evidence lives in the plan's table.

### Changed — Codex implementer returns to Terra

- **Maintainer ruling, 2026-09-13.** The Luna implementer trial (0.5.0 to 0.5.1) did not go
  well; `goal-implementer` moves to `gpt-5.6-terra` at `high`. TOML, routing table, direct
  fallback pins, resume guidance, and README agree. Mapping stays on Luna max, the planner on
  Astra xhigh, and reviewers on Terra xhigh. Neither trial produced per-role usage counters, so
  this records the ruling, not a measured comparison. The role name is unchanged; installed
  copies need a reinstall and a reload.

Plan/report schemas, validators, and install directories are unchanged. The Claude installer
copies the new planner definition through its existing wildcard.

## 0.5.1 — 2026-09-12

### Changed

- **Maintainer request, 2026-09-12.** Add a dedicated Codex `goal-planner` at Astra xhigh after
  validated mapper context, with plan/graph-only writes and an explicit handoff to the
  user-selected orchestrator. The supplied Astra prompting notes motivate the concise, progressive
  planner prompt, honest unavailable-image handling, and completion through existing plan and graph
  checks. Existing schema, Claude main-session planning, worker/reviewer pins, and EXECUTE resume
  behavior remain compatible (`docs/plans/2026-09-12-goal-planner-plan.md`).

## 0.5.0 — 2026-09-10

### Evidence

Reviewed recent Tyxter plan ledgers for #878, #780, #861, #856, completion quality gates,
and #896, plus the #882 and #936 consolidation follow-ups. This is a selected execution sample,
not a controlled model comparison. The historical forks remain the September 1 baseline.

- **Economics ruling, 2026-09-10.** The maintainer reports that Astra at low effort proved too
  expensive after further runs and requests mappers on Luna max, the planner on Astra xhigh,
  implementers on Luna max, and reviewers on Terra xhigh. This supersedes September 5's
  favorable Astra-low feedback. The reviewed ledgers do not expose sufficient per-role token or
  monetary counters to quantify savings or prove equivalent implementation quality.
- **Consolidation missed the intended reduction.** Tyxter #882's skill-audience plan
  (`docs/plans/2026-09-06-issue-882-skill-audiences-plan.md` at `bb8519777`) added 1,388 net
  lines. The user asked for pruning; `a31476b57` then removed 7,904 net lines. After #936's
  fixture adoption, the user again requested actual reduction; `062811da3` removed 819 net
  lines by consolidating repeated test bodies while preserving route scenarios. Counts are
  whole-commit totals, including support artifacts; they establish outcome mismatch, not a
  universal line-count target or proof that a shared fixture replaces caller tests.
- **Generated metadata caused late reruns.** #861's archived
  `2026-09-08-issue-861-credit-retry-hint-plan.md` records R2 dependency-metadata repair
  (ledger line 277); #856's `2026-09-09-issue-856-meta-health-sync-plan.md` records a stale
  dependency graph after 257/258 tasks (lines 297–304). #856 ran final CI three times against
  one planned, and 19 focused invocations against three planned (lines 120–126).
- **Execution realm mattered.** #856 first lacked its shared Turbo-cache mount; #861 required
  explicit runner/cache/environment configuration. #878's
  `docs/plans/2026-09-06-issue-878-outbound-send-split-plan.md` records WSL/native tool and path
  differences (lines 102–128) and a worker's claimed dead-code pass contradicted by the actual
  command (lines 355–363). These support precise gate probes and independent evidence review,
  not automatic reruns of all valid checks.
- **Provenance and honest completion worked unevenly.** #780, #861, #856 and the quality-gates
  ledger record unknown runtime model or usage data. #878 and #896 use schema 1 without a
  skill version; this retrospective session also exposed a backup skill and older runtime roles
  than the canonical source. #896 correctly leaves `ci:local` blocked despite passing product
  and browser checks (`docs/plans/2026-09-10-issue-896-dashboard-locales-boundaries-plan.md`,
  lines 592–641, commit `5cb6e2b07`). Preserve that distinction rather than marking every
  accepted implementation fully verified.

### Changed

- Make the main session's planner responsibility explicit. Request Astra xhigh there (selected
  by the user/client), Luna max for mapping and implementation, and Terra xhigh for independent
  review; record runtime evidence and any deviation. No additional premium planner child is
  needed. A struggling worker gets diagnosis and a narrower brief, not automatic promotion.
- **Rendered graph inspection.** On September 10, 2026, the maintainer reported that an agent
  viewing a Mermaid screenshot had caught an error missed in source review and requested an
  explicit visual step, then clarified that the goal planner owns graph review. Full PLAN
  mode now renders and captures the current diagrams before the main-session planner inspects them and
  checks their agreement with the plan. The checklist covers paths, arrows, edge meanings, gate
  placement, legibility, and cross-view consistency; corrections invalidate affected images.
  The former plan-reviewer checklist moves into the planner's graph-analysis reference. Code
  reviewers may receive a relevant inspected graph as optional context for tracing implementation
  paths; findings still require code/test evidence. Both harness profiles keep those responsibilities
  distinct. The bounded-fix exception, model pins, code-review report formats, schemas, and renderer
  interface are unchanged; screenshots use available browser/Mermaid image tools.
- **Role naming ruling, 2026-09-10.** The maintainer requests a model-neutral implementation
  role and removal of model/effort/version suffixes. Rename the canonical Codex file and role
  from `goal-implementer-terra` to `goal-implementer`. Use stable report labels
  `gdi-implementer`, `gdi-mapper`, and `gdi-reviewer`, matching Claude's role vocabulary. Model
  pins remain configuration; schema/release/source provenance remains in the plan. Stable labels
  no longer serve as profile-revision evidence. The installer prints the new registration and
  migration instructions, preserving old installed files/config for deliberate migration.
- Align Codex TOMLs, direct fallbacks, resume guidance, and stable role labels. Keep loaded-role evidence
  distinct from runtime model evidence; unavailable metadata remains unknown. Reuse unchanged
  routing receipts and useful bounded read-only probes instead of redundant scratch work.
- Dispatch concise task boundaries using existing section fields: allowed files, mechanism,
  exemplar, preserved invariants, acceptance checks, exclusions, and rulings. Workers report
  contradicted premises; reviewers independently assess those premises and the resulting code.
  Line existence alone is insufficient to reuse stale mapping. Preserve the existing bounded
  delegated-orchestrator exception with global writer, ownership, and reviewer independence rules.
- For reduction work, plan and review actual retirements and caller adoption. Compare consistent
  before/after inventories, separating product reduction from added tests and support artifacts;
  preserve distinct regression checks. Add no deletion quota or required mutation-test campaign.
- Schedule canonical generated-artifact refresh before review and broad gates, including changes
  from test imports or file moves. Preflight probes use the gate's actual realm, cwd, mounts,
  cache/dependency outputs, and environment mode; setup failures are not behavioral test evidence.
- Record resolved skill provenance and available usage by role, including main-session overhead
  and correction work; missing counters or prices remain unknown. Compare cost per accepted
  section with rework and escaped defects before claiming the new routing is more efficient.
- An independent forward test of a resumed controller-test consolidation selected the intended
  fallback routes, preserved caller coverage, and kept usage unknown, but proposed sensitivity
  evidence by changing an expected value. Clarify that a needed probe injects the relevant
  implementation defect; breaking the test itself does not establish defect detection.

Plan/report schemas, validators, install directories, and Claude model pins are unchanged.
Shared workflow and prompt clarifications apply to both harnesses. The skill release is 0.5.0;
installation and runtime reload remain separate from the tagged source release.

## 0.4.0 — 2026-09-05

### Changed — proportionate verification

- **Maintainer ruling, 2026-09-05.** Tyxter fixes reportedly grew from about 30 minutes to four
  hours. A sample of its 20 latest non-merge `fix(...)` commits averaged 1,596 added lines;
  path-based grouping attributed about 55% to tests/fixtures/journeys and 22% to plans. These
  counts establish growth, not which tests were unnecessary or where elapsed time went. The
  maintainer authorized narrowing the skill's proof and rerun requirements.
- Replace sensitivity proof for every regression or mocked test with focused before/after
  evidence per defect mechanism when practical; an existing observed reproduction counts.
  Require additional sensitivity checks for concrete risks of bypassed paths, vacuous assertions,
  or misplaced faults. Unchanged behavior may correctly pass with the fix disabled. The original
  race-test and stale-mock failures remain covered by targeted checks, without per-test rituals.
- Share valid evidence across roles and correction rounds. Invalidate it by relevant inputs,
  not a rejection, new agent, or commit SHA alone. Focused baselines and section checks precede
  broader final gates; explicit user and host requirements retain their required stage. New or
  changed evaluators need soundness evidence; unchanged harnesses reuse valid evidence. No
  applied-state rollback or separate rebuild/deploy is introduced for sensitivity proof.
- Align workflow, dispatch/review/correction prompts, graph-analysis rationale, plan template,
  and both harnesses' role instructions. Report labels, validators, schema, model/effort pins,
  and frozen forks are unchanged. Codex attestations advance to `gdi-implementer-astra-low-v5`
  and `gdi-reviewer-v4`; the mapper attestation is unchanged. This records source changes, not
  installation or runtime reload.

### Added

- **Justified retirement reports.** Section and final-review correction implementers now return
  `RETIRES`: artifacts actually removed, or a concrete reason none was retired, including additive
  work with no obsolete artifact or retained compatibility. The report validator rejects a missing,
  bare, or empty `none` explanation; reviewers check whether the stated rationale is true. A
  `decision-needed` correction also requires a substantive separate or compact decision brief.
  This directly bumps current Codex source attestations from implementer
  `gdi-implementer-astra-low-v3` to `gdi-implementer-astra-low-v4` and reviewer
  `gdi-reviewer-v2` to `gdi-reviewer-v3`; it does not establish runtime reload. Evidence: Tyxter
  #877 task 4's requested retirement-report requirement.

## 0.3.0 — 2026-09-05 (tag `v0.3`)

Evidence: the aiq-lite `code-research` skill (v0.0.6-sketch), whose live runs against a large
monorepo produced two mechanisms this skill lacked. Ported to dependency-free Node so the skill's
toolchain stays `node` only.

### Added

- **`assets/scout-repo.mjs`** — a deterministic feature map of the host repository (apps,
  feature slices, shared kernels; file and char counts; layers; anchor docs; package name; the
  one-line description each unit's own README gives it) from one tree walk and no LLM call.
  PLAN mode runs it before mapping: mappers are dispatched one per unit the inputs touch and
  named from the map, section TARGETs name the owning unit, and the plan header records the map.
  `--classify <paths>` maps changed paths to owning units and reports how many units and shared
  kernels a set touches — the structural evidence the bounded-fix lane eligibility check and the
  reader-sweep class ask for; the lane re-runs it over `git diff --name-only` at accept time.
  Nested checkouts (any directory carrying its own `.git`) and package stores are skipped: the
  first run against the retrospective's monorepo counted 64,851 files and 477 "features" until
  `.worktrees/` and `.pnpm-store/` were excluded; the corrected run reports 5,203 files and 36.
- **`assets/validate-report.mjs`** — structural validation of agent returns before the
  orchestrator acts on them: mapper (labels present, SYMBOLS anchored, thin/soft warnings),
  reviewer and final reviewer (verdict vocabulary, evidence anchor count, REJECT with no findings,
  every finding anchored and evidence-tagged), implementer (status vocabulary, labels, CLAIMS
  anchored, GATE EVIDENCE non-empty, decision brief present), and `anchors` for any text
  including the plan file. With `--repo-root` every `path:line` anchor must name an existing
  file and a line inside it. A hard error goes back to the same agent once with the error list;
  reviewers only ever see an implementer report that validates.
- **Evidence tags on findings.** Every reviewer and final-review finding ends with
  `evidence: test|code|partial|config|inference`. A REJECT whose findings are all `inference`
  does not reach the implementer until the orchestrator has verified each against the code and
  upgraded the tag with its own anchor or refuted it on the record. Origin: the aiq-lite
  distinction between evidence strengths, and this skill's own rule that a reviewer can be wrong.
- **Mapper follow-up rule.** A `thin` or `soft` mapper return earns at most one targeted
  follow-up per section (narrower AREA at the weak symbols); persistent thinness is an accepted
  risk in Graph Findings, not a loop. Origin: aiq-lite's substitution rule and its cap of two
  follow-ups per run.
- **Role definitions restate the validated formats.** The mapper and reviewer standing
  contracts (Claude `gdi-mapper`, `gdi-reviewer`; Codex `goal-explorer`, `goal-reviewer`) now
  name the return labels, repository-relative anchors, the evidence tag, and the fact that a
  structural validator sends a failing return back once. The dispatch prompt still wins on
  conflict; the restatement exists so the first return of a session does not burn a re-prompt
  round on format. Codex attestations bump to `gdi-explorer-v2` and `gdi-reviewer-v2`, so a
  `-v1` attestation identifies a stale installed role file.

### Changed — Codex routing and prompting

- **Codex role economics, maintainer ruling (2026-09-05).** The maintainer's GDI run feedback
  requests mappers on `gpt-5.6-luna` at `max`, implementers on `gpt-6-astra` at `low`, and
  reviewers staying on `gpt-5.6-terra` at `high`. Motivation: Luna mapping was cheaper and faster;
  Astra produced better code with less churn at about the same observed task cost as Terra.
  This feedback is the human ruling for AGENTS.md's role-economics floor, not a benchmark or
  guaranteed cost claim. TOMLs, routing, fallback selection, and resume guidance now agree.
  The main-session pin stays Sol `max`. The installed `goal-implementer-terra` identifier stays
  stable for existing registrations while selecting Astra; no install targets or roles change.
  Implementer and mapper attestations become `gdi-implementer-astra-low-v3` and
  `gdi-explorer-v3`; reviewer `gdi-reviewer-v2` remains current. Old profile attestations prompt
  a reinstall and reload or the direct pinned fallback, never a claim that the runtime model was
  verified. Both dispatch routes explicitly require a bounded fork to avoid model inheritance.
- **Codex prompting adapted to Astra.** The same request cites OpenAI's
  [Astra guide](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra.md#prompting-best-practices)
  (read 2026-09-05), which identifies premature clarification, skill-instruction sensitivity,
  verbose reports, under-delegation, and excessive verification as behaviors to tune. A Codex
  dispatch wrapper and the implementer's standing instructions carry approved work through to
  evidence, reuse existing rulings, identify the exact instruction behind a blocker, and limit
  extra testing after required gates pass. The root retains mapper/reviewer fan-out; workers
  keep their existing delegation limits. Required gates, sensitivity checks, independent review,
  report labels, schema compatibility, and Claude behavior are preserved. The shared prompt
  preamble now defers routing-header fields to the harness, fixing its conflicting Codex
  `confirmed` example. Independent dispatch simulation also found that generic correction
  workers could miss the implementer rules with no inherited history; the Codex dispatch now
  includes those rules while retaining the correction-specific scope and report.

### Changed — direct wording

- **Literal language in skill instructions (maintainer request, 2026-09-05).** Replaced
  metaphors and rhetorical phrasing in the workflow, references, plan template, and agent
  instructions with direct descriptions of actions, conditions, and evidence. Examples include
  "cost is earned," "highest-yield spend," "a numeric knob," and "a second pair of eyes."
  The request identified unnecessary reading effort and imprecision as the problem. The
  direct-wording edit did not change workflow requirements, reviewer lenses, model/effort pins,
  report fields, or schema rules. It left the current Codex implementer attestation at
  `gdi-implementer-astra-low-v3`; its earlier v4 claim was inaccurate. The later retirement-report
  change records the direct v3-to-v4 bump and matching routing update. Frozen forks are unchanged.

## 0.2.2 — 2026-09-03

Evidence: a key-inventory survey of one repository on 2026-09-03 found 272 readable configuration
keys, 79 of them numeric tunables of which exactly one had ever been set on any host, and a schema
growing by roughly 40 keys a month against 6 removed. The pattern behind the growth was the
implementer's hedge: a number it could not justify became an environment variable with a schema
default, and the next section copied the pair.

### Added

- **Unjustified configuration key** finding class on the convention/scope lens. A new
  environment variable or other host-set key is a finding unless the section records who sets
  it, on which host, and what breaks at the default. Numeric knobs belong in a named constant in
  the owning module, runtime-changed values in a config table, and env holds secrets, endpoints,
  and per-host selectors. A schema default is the hedge the class exists to catch, not the
  justification. Added to the dispatch checklist (`references/agent-prompts.md`, dimension 5)
  and to the Claude convention reviewer's standing contract; Codex's single reviewer role reads
  the same checklist.

## 0.2.1 — 2026-09-02

Evidence: two plans run on 0.2.0 in a repository other than the one the retrospective studied.
One of them turned a one-line Compose behavior change (issue 19 there) into a 310-line plan,
mapper fan-out, repeated full suites, several review rounds, and an implementer that rebuilt a
separate "candidate version" of the fix to satisfy the revert-proof rule.

### Changed

- **Sensitivity check replaces "revert the fix, watch it go red".** The rule now names its
  mechanism (a local stash or one-line temporary edit, restored at once), its scope (regression
  tests that guard a defect fix, and tests that rely on a mock, fake, or injected fault), and what
  it never is: a revert of committed work, a rebuild, a redeploy, or a rollback of once-applied
  state such as a migration. Those get a disposable fixture. The graph-analysis class is renamed
  **Test sensitivity**; its origin evidence is unchanged. The orchestrator accepts the pasted red
  output and does not repeat the check. Motivation: the unscoped wording read as an instruction
  to move backwards, against a fix-forward delivery model, and applied to every new test
  regardless of risk.
- **Bounded-fix lane.** The 0.2.0 unification dropped the baseline forks' two proportionality
  valves ("skip aggregation for trivial sections", "small low-risk diffs collapse to two lenses")
  without replacing them, while the trigger list still pulled "fix an issue end to end" into the
  full loop. The lane restores proportionality with a structural gate rather than a size gate:
  one section, nothing on the floor, no write into a shared column, enum, event type, or registry,
  no migration, auth, limiter, or public-contract surface, provable with the owning package's
  tests. Inside it: plan still written (the ledger is the retrospective's record), mapper fan-out
  skipped when the orchestrator can anchor context itself, two lenses (convention/scope,
  doc-truth), affected-subset gate per section, section review doubles as final review, global
  gate once on the merged tree. A disqualifier found mid-lane continues under the full loop from
  the current state. Recorded as `lane: bounded` in Recorded calls and on the ledger row. The
  reader-sweep evidence is why the gate is structural: the failures were small diffs into shared
  surfaces.
- **Product-neutral wording.** The default ruling floor and several examples were written in the
  vocabulary of the retrospective's host product (customers, money customers pay, rate cards,
  credit thresholds, webhook signature schemes, `turbo run test --affected`, `NODE_ENV`,
  dashboard/BFF). The floor now reads commercial terms / public integration contract /
  irreversible outward actions, states that it is written for a product with paying users and a
  public API, and tells a library, CLI, internal tool, or infrastructure repository to declare
  its own. Examples are toolchain-neutral; "customer-facing" is "user-facing" throughout the
  skill, template, and agent definitions. Origins in `graph-analysis.md` keep their original
  wording because they are evidence, not rules.

## 0.2.0 — 2026-09-01

### Unified

- One `SKILL.md` for Claude Code and Codex CLI, built on the Codex lineage (plan lifecycle,
  execution-environment preflight, validator, deferrals table) with the Claude lineage's pinned
  agent roles. Harness-specific dispatch lives in `references/routing-claude.md` and
  `references/routing-codex.md`. The forks had diverged by ~490 lines in `SKILL.md`; every plan
  since 2026-08-06 had run on the Codex fork while the Claude fork drifted.
- Plan schema bumped to `gdi_schema: 2`; `gdi_version` stamps the skill release into every plan.
  Retrospective: skill evolution had to be inferred from plan dates because no plan recorded which
  revision produced it.
- Plan format the runs had already evolved by copying the previous plan (`gdi_schema`
  frontmatter, preflight table, model-routing block, deferrals table) is now in the template.

### Added — closing the escape routes (Tier 1)

- **Reader sweep** in the graph analysis, the contract lens, and a final-review lens (d) over
  the diff's complement; default per-section gate widened to the owning package's full suite
  plus affected dependents. Retrospective: a promotion credit written into a shared provider
  column was summed as revenue by a report in another module and counted promo-only accounts as
  paying customers, four days after a clean run; five new event types in one week shipped without
  a row in another module's fail-closed retention snapshot because section gates ran only the
  owning module's tests.
- **Paired admission exit tests** measured on real client behavior, a **capacity/false-positive
  reviewer lens** for limiter, quota, timeout, and admission changes, and a **cheapest real-client
  probe** budgeted before the first image build. Retrospective: a public rate limiter whose exit
  tests were all "excess gets 429"; one page view of the product's own docs site issued 77
  prefetch requests against a burst of 60, a P1 in production two days after a clean final review.
- **Final review runs on the branch merged onto current `origin/main`**, with a declared
  base-drift policy. Retrospective: 29 textual conflicts and two extra whole-branch rounds in one
  plan; two plans in the same week shipping contradictory semantics for one subsystem, noticed
  only by a human at merge.
- **Claim discipline**: implementer report carries a CLAIMS block (every prose assertion with
  the anchor that makes it true at this commit); a dedicated **doc-truth reviewer lens**; a
  **claim-decay** final-review lens; accepted corrections are broadcast into later sections'
  briefs as **Corrections in force**. Retrospective: prose over-claims were the top rejection class
  in all nine batches, 26 to 40 percent of recorded reasons, and the largest final-review catch
  class.

### Changed — fewer human touchpoints (Tier 2)

- **Ruling floor** replaces the pre-2026-08 escalation list (config format, non-additive schema,
  auth model, storage format, sovereignty boundary). Floor = money customers pay, the public
  integration contract, irreversible outward actions; a host repository's declared floor wins.
  Rulings split into **floor rulings** (user) and **recorded calls** (orchestrator, `⇢`). A plan
  with no floor item in a repository that declares its floor starts without waiting for approval.
  Retrospective: plan approval was the dominant remaining human touchpoint, about half of plans
  crossed no floor item, roughly half of approval-time rulings were below the floor, and one
  below-floor ruling routed to the human was decided wrong on stale evidence and reversed mid-run.
- **Known blockers** table with pre-approved handling, per-gate **environment preflight**
  (smoke-run or `unproven`), **terminal-action** ruling, environment retries as their own lane
  (`⚙×n`). Retrospective: the same failed development migration blocked six plans in one week; the
  plan that pre-ruled the runbook paid nothing, another escalated it to the user; an acceptance gate
  took five environment retries with no product change; two plans needed a mid-run amendment only
  to open a PR.
- **Reviewer unavailable** now degrades to a generic read-only agent at reviewer effort, then to
  main-session review only with `review: self (<reason>)` on the ledger row and an accepted risk in
  Graph Findings, with an independent final review mandatory. Roles are resolved in preflight before
  the approval surface exists. Retrospective: no plan recorded the pinned roles resolving; the plan
  whose five sections were all silently self-reviewed had the most live-gate defects and blew its
  build budget three times over.
- **Convergence rule replaces the fixed two-round cap** in the Claude lineage (the Codex lineage
  had already dropped it): rounds continue while findings shrink; stop on a floor item, a repeated
  class, or a broken section boundary. Retrospective: the cap was exceeded in at least nine plans,
  overridden in writing in most, and never once triggered a stop; second and later rounds found real
  defects.

### Added — making the loop measurable (Tier 3)

- **Ledger record schema** for accepted rows: sha, `rounds: n` with one `R<k> <class>: reason`
  line per round, `review:`, `routing:`, `cost:`; the validator enforces it and refuses a
  topology graph whose marks disagree with the ledger. New marks `⇢` (orchestrator-ruled) and
  `⚙×n` (environment retries) so `⚠→` means only "a brief reached a human". Retrospective:
  unrecorded rejection reasons were the largest single class in two batches; graphs marked `✓`
  where rounds happened; three plans ticked "annotated as executed" with no marks.
- **Deferrals must carry a filed issue or a machine-checkable re-entry gate**; validation error
  otherwise. Retrospective: zero of nineteen deferrals in the last week had a new issue number; the
  same deferral was filed twice; one plan wrote "follow-up issue required" and filed none.
- **Gate budget records actual runs** beside planned, with implementer and orchestrator runs
  counted separately; overruns above 1.5× are named as misses. Retrospective: one plan blew its
  image-build budget 3×; none recorded tokens.
- Graph analysis gains **partially consumed input**, **unruled semantics (negative space)**,
  **constraint admissibility**, **data-path reachability**, **rollout window**, **plan as
  evidence**, **sibling surface**, **class completeness**, **invariant inversion / writers**, and
  **stale running stack**; each class in `references/graph-analysis.md` names the failure it
  prevented.
- New reviewer lens **evaluator soundness** for journey sections, and load-bearing proof
  (revert the fix, watch the test go red) as gate evidence. Retrospective: four journey sections,
  four rejections, all defects in the proof; tests that passed without the fix were accepted in at
  least five plans.
- Section blocks gain `WRITERS` and `SIBLING SURFACES`; TARGET names the owning docs of every
  package written. Retrospective: the final review kept catching a README no section's file list
  named; every serious defect in one run lived in unlisted writers.

### Fixed

- Claude-lineage `render-plan-graph.mjs` carried four NUL bytes; the unified copy is the clean,
  newer Codex script (renders the lifecycle gate budget too).
- `SKILL.md` pin table disagreed with the Claude agent files (implementer `xhigh` vs `high`,
  mapper `opus` vs `sonnet`, reviewer `high` vs `medium`). Reconciled: implementer opus·high,
  mapper sonnet·medium, verify-class reviewer opus·high, convention reviewer opus·medium.
- Codex agent TOMLs now carry the auto-discovery note from the installed copies.

## 0.1.0 — 2026-09-01 (baseline)

- Verbatim snapshot of the Claude Code fork (`~/.claude/skills`, `~/.claude/agents`) and the
  Codex fork (`~/.codex/skills`, `~/.codex/agents`) as they ran on 2026-09-01. Kept under
  `claude/` and `codex/` unchanged.
