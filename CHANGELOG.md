# Changelog

Entries cite the evidence that motivated them. "Retrospective" means the 2026-09-01 review of 90
executed plans (July 2 to September 1, 2026): roughly 410 sections and 380 correction rounds.

## 0.3.0 — unreleased (branch `0.3.0`)

Evidence: the aiq-lite `code-research` skill (v0.0.6-sketch), whose live runs against a large
monorepo produced two mechanisms this skill lacked. Ported to dependency-free Node so the skill's
toolchain stays `node` only. Validate against real plans before tagging; 0.2.1 is the control.

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
  The request identified unnecessary reading effort and imprecision as the problem. Workflow
  requirements, reviewer lenses, model/effort pins, report fields, and schema rules are unchanged.
  The edited Codex implementer instructions use `gdi-implementer-astra-low-v4`, with the routing
  attestation list updated to match. Historical changelog entries and frozen forks are unchanged.

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
