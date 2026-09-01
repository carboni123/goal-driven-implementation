# Changelog

Entries cite the evidence that motivated them. "Retrospective" means the 2026-09-01 review of 90
executed plans (July 2 to September 1, 2026): roughly 410 sections and 380 correction rounds.

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
