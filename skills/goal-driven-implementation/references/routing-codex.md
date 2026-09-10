# Routing — OpenAI Codex CLI

## Policy

Use the existing main session as the PLANNER + ORCHESTRATOR; request `gpt-6-astra` at `xhigh`.
It decomposes work, directs bounded agents, reviews evidence, and commits; it never edits product
code, is never a spawned worker, and is not a new installed role or premium peer.
The user or client selects the active main-session model; this skill cannot change it by prose or
by spawning a premium peer. Request the Astra xhigh pin, record runtime-confirmed evidence (or
`unknown`) and any deviation separately, and honor explicit user overrides.

| Role                   | Custom agent             | Model · effort            | Notes                             |
| ---------------------- | ------------------------ | ------------------------- | --------------------------------- |
| Planner + orchestrator | Existing root session    | `gpt-6-astra` · `xhigh`   | No spawned peer or installed role |
| Implementer            | `goal-implementer`       | `gpt-5.6-luna` · `max`    | One per section; no nested spawns |
| Mapper                 | `goal-explorer`          | `gpt-5.6-luna` · `max`    | Read-only                         |
| Reviewer               | `goal-reviewer`          | `gpt-5.6-terra` · `xhigh` | Read-only; one lens per spawn     |

Select each role's model and effort explicitly; never let a child inherit the main-session route.
Do not automatically promote a Luna worker to a costlier model when it struggles. Diagnose the
missing fact or narrow the instruction within the same approved section, preserving convergence
and decision boundaries. Do not spawn an additional Astra planner peer merely to plan or review.
The delegated-orchestrator exception is limited to an explicitly assigned bounded multi-section
subtree with exact section IDs and paths. The root retains the ledger, acceptance, commit, and
final-gate decisions; one implementer remains active globally, descendants count against thread
slots and usage, and the root dispatches independent reviewers. The parent must verify that the
child can route the role-specific pins above before dispatch; the child never edits product source
or docs, accepts sections, updates the ledger, runs final gates, or commits.

Role names identify responsibilities. Model and effort belong in the TOML and routing table;
changing them does not rename the role. Codex's `goal-implementer` corresponds to Claude Code's
`gdi-implementer` through the harness routing, with the same shared task and report contract.

Economics note: the user observed a cost regression on Astra-low; expected Luna savings remain
unmeasured. Do not state prices or claim proven quality equivalence from this routing change.

## Installing the roles

Definitions are included at `assets/agents/codex/*.toml`. Current Codex releases auto-discover personal
custom agents from `~/.codex/agents/`; copy them there:

```bash
cp <skill-root>/assets/agents/codex/*.toml ~/.codex/agents/
```

Older releases (verified on 0.144.6) require `multi_agent_v2` under `[features]` in
`~/.codex/config.toml` and an `[agents.<name>]` entry per role whose `config_file` points at the
TOML; the file's `name` must equal the registry key. Do not edit the user's config without
permission — print the snippet and ask.

Skill discovery: the `npx skills` CLI installs to `~/.codex/skills/<name>/`; OpenAI's documentation
lists `~/.agents/skills/` (user scope) and `<repo>/.agents/skills/` (repo scope). The installer
writes both user paths.

**Upgrade from `goal-implementer-terra`.** Install `goal-implementer.toml`; if a config registration
exists, rename its key to `[agents.goal-implementer]` and update `config_file` to the new filename.
Migrate any other references before retiring the old registration and old installed TOML. The
installer prints the new snippet but does not edit config or remove the old file. Reload the
session before using the renamed custom role; until then use the direct pinned fallback. The old
name is not an automatic alias. Preserve historical plan records and frozen source snapshots.

## Verification protocol (before the first task dispatch)

Keep three facts distinct and record them separately in the plan's Harness routing table:

- **Requested** — the role, model, and effort the orchestrator tried to select.
- **Role-confirmed** — tool/runtime metadata identifies the selected role. Without that evidence,
  record `unknown`; accepting a requested selector or echoing a label does not prove the loaded
  custom profile. A generic fallback receives its role contract in the dispatch prompt.
- **Model-confirmed** — tool/runtime metadata identifies the effective model and effort. A TOML,
  an attestation, or a self-description does not prove the runtime model. An explicit supported
  pin may still be requested when metadata is hidden, but record model-confirmed as `unknown`.

The existing `attestation` report field carries only a stable role label: `gdi-implementer`,
`gdi-mapper`, or `gdi-reviewer`, matching the shared responsibilities in Claude Code. It proves
neither profile freshness nor model routing. Keep `gdi_schema` (plan format), `gdi_version` (skill
release), and source path/revision in the plan's provenance; none alone proves which profile the
runtime loaded. Verify installed definitions and reload after changes, or use the current direct
pinned fallback when the loaded profile cannot be established. Do not copy labels into fallback
prompts; a generic child records `attestation=none`.

Steps: check role files and a supported runtime diagnostic; use `codex doctor` when the runtime
provides it, and inspect the available diagnostic instead when it does not rather than requiring
an unavailable command. Reload the session if configuration changed after it started; inspect the
current spawn schema and send only keys it declares. A first real bounded read-only mapper or
reviewer task may serve as role preflight, avoiding a throwaway dispatch. If implementer role
verification is needed, use a read-only scratch task before permitting writes. Reuse a routing
receipt when role configuration and runtime are unchanged. Capture metadata and record it; hidden
metadata is `unknown`.

Both routes require an explicit bounded fork (`fork_turns: "none"` or a small integer; never
`"all"`, which inherits the main-session route). Do not rely on the default fork. Try these routes
in order:
(1) `agent_type` naming the current registered role;
(2) direct `model` + `reasoning_effort` at that role's pins when the schema declares them:

- Implementer: `model: "gpt-5.6-luna"`, `reasoning_effort: "max"`.
- Mapper: `model: "gpt-5.6-luna"`, `reasoning_effort: "max"`; a built-in `explorer` is usable
  only when it can select this route. A built-in role name alone does not establish the pin.
- Reviewer: `model: "gpt-5.6-terra"`, `reasoning_effort: "xhigh"`.

A generic child receives the role's scope, write restrictions, and report contract from the
dispatch template; report `attestation=none` unless a profile actually supplies one. Do not put
attestation literals in a fallback prompt. If neither Luna route is available for the
**implementer**, stop before product edits. If neither Luna route is available for a **mapper**,
the orchestrator may gather the same anchored context itself and record the fallback. For the
**reviewer**, use a generic read-only child at Terra `xhigh` before falling back to main-session
review; main-session review requires `review: self (<reason>)` on the ledger row and an accepted
risk in Graph Findings, and the final review must then be independent. The implementer pin has
no automatic substitute.

## Codex prompt wrapper

For initial dispatches, corrections, and follow-ups, prepend this wrapper to the appropriate
body in `references/agent-prompts.md`. The installed implementer repeats its core guidance so it
also applies when that role is dispatched directly. Keep routing evidence separate from the body;
let an installed profile supply its own role label.

For a generic correction implementer, also include the RULES from template §2; a fresh child
does not inherit them. Apply those rules to the listed findings, with template §7 defining the
correction scope, required gates, and report format instead of a section's IMPLEMENT list.

```text
Complete the assigned task and provide the required evidence and report. Use prior user instructions
and recorded rulings as authorization for the same scope; resolve routine choices within your
role. User instructions take precedence over skill guidance, subject to higher-priority rules.
Use the planner's bounded context — allowed files, observed mechanism, known exemplar, invariants,
acceptance, gates, exclusions, and prior rulings — as the task boundary. If a premise is false or
the task cannot fit that boundary, report the concrete mismatch and permitted independent progress;
do not redesign or silently expand the section.
For an unruled floor change, stop before dependent code or actions; complete permitted independent
preparation and cite the blocking instruction's file and exact clause in the relevant report
field. Any workaround must remain within the assigned scope.

Apply SKILL.md's proportionate-verification policy: focused reproduction per defect mechanism,
sensitivity checks for concrete vacuity risks, and reuse of valid evidence across roles. Run
checks at their scheduled stage and repeat only missing or invalidated checks or a targeted
probe for a finding. Preserve explicit user and host-repository requirements; pending gates
are not successes.

Keep the requested report labels and evidence. Write concise, readable findings and agent
messages; do not append a second summary. A follow-up refines the active task unless it explicitly
replaces it; preserve completed work and incorporate the correction.

Do not spawn subagents from an ordinary worker. Any delegated orchestrator may dispatch only the
roles and subtree expressly assigned to it under the routing policy.
```

The root dispatches mappers and reviewers under `SKILL.md`'s counts and eligibility rules; a
Luna implementer stays the sole writer. Apply the wrapper's authorization guidance when
orchestrating too: request only unresolved rulings, with the exact instruction and evidence.
This adapts the [Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra.md#prompting-best-practices)
(read 2026-09-05) to GDI's existing role boundaries and verification gates.

## Dispatch mechanics

- Follow-ups (rejection, decision relay) resume the same implementer with `followup_task`.
- Parallel mappers and reviewers within the thread cap; the root session consumes one slot.
- Every spawned role begins its report with
  `ROUTING: requested=<...>; attestation=<role label or none>; runtime=<metadata or unknown>`.
- Before resuming an older plan, update unchecked implementer assignments targeting the former
  role name or Astra-low, Sol, or Terra routes to `goal-implementer` / Luna max; future mapper
  assignments stay on Luna max and reviewer assignments use Terra xhigh. Re-run routing preflight
  and record the new evidence; preserve completed history and any explicit plan-specific user override.
