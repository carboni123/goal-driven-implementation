# Routing — OpenAI Codex CLI

## Policy

Keep the main session (`gpt-5.6-sol` at `max`) as the control plane. It orchestrates, reviews
evidence, and commits; it never edits product code and is never a spawned worker.

| Role        | Custom agent             | Model · effort           | Notes                             |
| ----------- | ------------------------ | ------------------------ | --------------------------------- |
| Implementer | `goal-implementer-terra` | `gpt-6-astra` · `low`    | One per section; no nested spawns |
| Mapper      | `goal-explorer`          | `gpt-5.6-luna` · `max`   | Read-only                         |
| Reviewer    | `goal-reviewer`          | `gpt-5.6-terra` · `high` | Read-only; one lens per spawn     |

Select each role's model and effort explicitly; never let a child inherit the main-session route.
Never spawn a Sol implementer, reviewer, or peer reasoner. A delegated Sol orchestrator is
permitted only for a bounded multi-section subtree when the runtime confirms the child can spawn
and steer its own subagents at the role-specific pins above; it never edits, accepts, or commits.

`goal-implementer-terra` is a stable installed role identifier, not a model assertion. Keep its
filename, `name`, and existing config registrations; its TOML now selects Astra. Mapping retains
the same anchor and report checks.

## Installing the roles

Definitions ship at `assets/agents/codex/*.toml`. Current Codex releases auto-discover personal
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

## Verification protocol (before the first production dispatch)

Keep three facts distinct and record them separately in the plan's Harness routing table:

- **Requested** — the role, model, and effort the orchestrator tried to select.
- **Role-confirmed** — the spawn schema declared the selector, the call accepted it, and either
  runtime metadata reports the role or the child returns the profile-only attestation embedded in
  the role's instructions (`gdi-implementer-astra-low-v3`, `gdi-reviewer-v2`,
  `gdi-explorer-v3`). An older implementer or mapper literal identifies a stale role file;
  reinstall and reload before using that custom role, or use the direct pinned fallback below.
  Reviewer `-v2` is still current; a `-v1` mapper or reviewer also lacks the validated report
  contract. Never include the expected literal in the task prompt.
- **Model-confirmed** — tool/runtime metadata identifies the effective model and effort. A TOML,
  an attestation, or a self-description does not prove the runtime model.

Steps: check role files and a clean `codex doctor`; reload the session if configuration changed
after it started; inspect the current spawn schema and send only keys it declares; run one bounded
read-only scratch dispatch per role; capture metadata; record.

Both routes require an explicit bounded fork (`fork_turns: "none"` or a small integer; never
`"all"`, which inherits the main-session route). Do not rely on the default fork. Fallback ladder:
(1) `agent_type` naming the current registered role;
(2) direct `model` + `reasoning_effort` at that role's pins when the schema declares them:

- Implementer: `model: "gpt-6-astra"`, `reasoning_effort: "low"`.
- Mapper: `model: "gpt-5.6-luna"`, `reasoning_effort: "max"`; a built-in `explorer` is usable
  only when it can select this route. A built-in role name alone does not establish the pin.
- Reviewer: `model: "gpt-5.6-terra"`, `reasoning_effort: "high"`.

A generic child receives the role's scope, write restrictions, and report contract from the
dispatch template; report `attestation=none` unless a profile actually supplies one. Do not put
attestation literals in a fallback prompt. If neither Astra route is available for the
**implementer**, stop before product edits. If neither Luna route is available for a **mapper**,
the orchestrator may gather the same anchored context itself and record the fallback. For the
**reviewer**, use a generic read-only child at Terra `high` before falling back to main-session
review; main-session review requires `review: self (<reason>)` on the ledger row and an accepted
risk in Graph Findings, and the final review must then be independent. The implementer pin has
no automatic substitute.

## Codex prompt wrapper

For initial dispatches, corrections, and follow-ups, prepend this wrapper to the appropriate
body in `references/agent-prompts.md`. The installed implementer repeats its core guidance so it
also applies when that role is dispatched directly. Keep routing evidence separate from the body;
never insert the profile-only attestation literal.

For a generic correction implementer, also include the RULES from template §2; a fresh child
does not inherit them. Apply those rules to the listed findings, with template §7 defining the
correction scope, required gates, and report format instead of a section's IMPLEMENT list.

```text
Carry the assigned task through to its required evidence and report. Use prior user instructions
and recorded rulings as authorization for the same scope; resolve routine choices within your
role. User instructions take precedence over skill guidance, subject to higher-priority rules.
For an unruled floor change, stop before dependent code or actions; complete permitted independent
preparation and cite the blocking instruction's file and exact clause in the relevant report
field. Never expand the assigned scope to manufacture a workaround.

Run the checks required by the section, plan, and repository, including sensitivity checks and
required acceptance reruns. Beyond those, add or repeat tests only when changed code, a failure,
or an unresolved concern warrants it. A small change does not waive a required gate.

Keep the requested report labels and evidence. Write concise, readable findings and agent
messages; do not append a second summary. A follow-up refines the active task unless it explicitly
replaces it; preserve completed work and incorporate the correction.

Do not spawn subagents from an ordinary worker. Any delegated orchestrator may dispatch only the
roles and subtree expressly assigned to it under the routing policy.
```

The root owns mapper and reviewer fan-out under `SKILL.md`'s counts and eligibility rules; an
Astra implementer stays the sole writer. Apply the wrapper's authorization guidance when
orchestrating too: surface only unresolved rulings, with the exact instruction and evidence.
This adapts the [Astra prompting guidance](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-6-astra.md#prompting-best-practices)
(read 2026-09-05) to GDI's existing role boundaries and verification gates.

## Dispatch mechanics

- Follow-ups (rejection, decision relay) resume the same implementer with `followup_task`.
- Parallel mappers and reviewers within the thread cap; the root session consumes one slot.
- Every spawned role begins its report with
  `ROUTING: requested=<...>; attestation=<literal or none>; runtime=<metadata or unknown>`.
- Before resuming an older plan, update unchecked Sol or Terra implementer assignments to the
  Astra route and future mapper assignments to Luna. Re-run routing preflight and record the
  new evidence; preserve completed history and any explicit plan-specific user override.
