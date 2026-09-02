# Routing — OpenAI Codex CLI

## Policy

Keep the main session (`gpt-5.6-sol` at `max`) as the control plane. It orchestrates, reviews
evidence, and commits; it never edits product code and is never a spawned worker.

| Role        | Custom agent                             | Model · effort             | Notes                             |
| ----------- | ---------------------------------------- | -------------------------- | --------------------------------- |
| Implementer | `goal-implementer-terra`                 | `gpt-5.6-terra` · `xhigh`  | One per section; no nested spawns |
| Mapper      | `goal-explorer` (or built-in `explorer`) | `gpt-5.6-terra` · `medium` | Read-only                         |
| Reviewer    | `goal-reviewer`                          | `gpt-5.6-terra` · `high`   | Read-only; one lens per spawn     |

Every ordinary spawned role runs on Terra. Never spawn a Sol implementer, reviewer, or peer
reasoner, and never let a child inherit the Sol main-session route. A delegated Sol orchestrator is
permitted only for a bounded multi-section subtree when the runtime confirms the child can spawn
and steer its own Terra subagents; it never edits, accepts, or commits.

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
  the role's instructions (`gdi-implementer-terra-xhigh-v2`, `gdi-reviewer-v2`,
  `gdi-explorer-v2`; a `-v1` attestation means the 0.2.x role file is installed and its returns
  will fail the report validator — reinstall the agents). Never include the expected literal in
  the task prompt.
- **Model-confirmed** — tool/runtime metadata identifies the effective model and effort. A TOML,
  an attestation, or a self-description does not prove the runtime model.

Steps: check role files and a clean `codex doctor`; reload the session if configuration changed
after it started; inspect the current spawn schema and send only keys it declares; run one bounded
read-only scratch dispatch per role; capture metadata; record.

Fallback ladder: (1) `agent_type` naming the registered Terra role with a bounded fork
(`fork_turns: "none"` or a small integer; never `"all"`, which inherits the Sol route);
(2) direct `model: "gpt-5.6-terra"` + `reasoning_effort` when the schema declares them. If neither
Terra route is available for the **implementer**, stop before product edits. If it is unavailable
for the **reviewer**, use a generic read-only child at Terra `high` before falling back to
main-session review; main-session review requires `review: self (<reason>)` on the ledger row and
an accepted risk in Graph Findings, and the final review must then be independent.

## Dispatch mechanics

- Follow-ups (rejection, decision relay) resume the same implementer with `followup_task`.
- Parallel mappers and reviewers within the thread cap; the root session consumes one slot.
- Every spawned role begins its report with
  `ROUTING: requested=<...>; attestation=<literal or none>; runtime=<metadata or unknown>`.
- Before resuming an older plan, replace unchecked legacy Sol implementer assignments with the
  Terra role; preserve completed history.
