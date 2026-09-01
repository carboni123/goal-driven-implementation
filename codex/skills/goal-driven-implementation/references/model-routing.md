# Model Routing for Goal-Driven Implementation

## Recommended policy

Keep `gpt-5.6-sol` at `max` in the main planning/orchestration session. That session is the control
plane, not a spawned agent, and it must not edit product code.

Use Terra exclusively for ordinary spawned agents:

- Implementation: `goal-implementer-terra`, `gpt-5.6-terra`, `xhigh`.
- Read-only exploration: `goal-explorer`, `gpt-5.6-terra`, `medium`.
- Focused review: `goal-reviewer`, `gpt-5.6-terra`, `high`.

Do not spawn a Sol implementer, explorer, reviewer, or peer reasoning agent, and do not allow an
ordinary child to inherit the Sol main-session route. When a section needs more judgment than the
Terra implementer can safely apply, decompose it, strengthen its contract and tests, or stop for a
material user decision. Keep the same Terra implementer for every in-scope correction round; an
approved EXECUTE run or active Codex `/goal` already authorizes routine review fixes.

Allow a Sol child only as a delegated orchestrator when all of these hold:

- The runtime explicitly confirms that the child can spawn, wait for, and steer its own subagents.
- The plan assigns it a bounded multi-section subtree that benefits from independent coordination.
- The thread cap leaves room for its Terra implementer, explorer, or reviewer children.
- It performs orchestration only: no product edits, section acceptance, or commits.

Do not launch this exception as a second opinion or a substitute for the main orchestrator. The
main session retains contract decisions, independent verification, final acceptance, and commits.
If nested delegation is unavailable or unconfirmed, keep the main Sol session as the only
orchestrator.

## Runtime configuration (verified on Codex CLI 0.144.6, 2026-07-20)

Subagents are forks of the parent session and inherit its routing unless a declared override is
actually honored. Role TOMLs on disk are inert unless registered. Treat the spawn schema exposed to
the current session as the routing contract for that session: a session opened before enabling v2
or registering roles can continue to expose the legacy surface until it is reloaded. Registered-role
routing requires:

1. `multi_agent_v2` enabled under `[features]` in `~/.codex/config.toml` (still marked "under
   development" in 0.144.5 — validate with a scratch session before a production dispatch).
2. `[agents.<name>]` entries in `~/.codex/config.toml` whose `config_file` points at a role
   TOML. On Codex 0.144.6 the role file must define non-empty `name` and `description` values and
   otherwise holds config-style keys (`model`, `model_reasoning_effort`, `sandbox_mode`,
   `developer_instructions`). Keep the file `name` equal to the `[agents.<name>]` registry key.
   A malformed role is ignored with a startup warning, and unregistered names fail the spawn with
   `unknown agent_type`. Verify by starting a strict-config scratch session after editing roles.
3. Bounded forks for routed spawns: `fork_turns: "none"` or a positive integer string. A
   full-history fork (`fork_turns: "all"`) inherits the parent agent type, model, and reasoning
   effort. Because the parent is Sol, full-history forks are prohibited for spawned roles.

When the current v2 spawn schema declares direct `model`, `reasoning_effort`, or `service_tier`
overrides, they can be used without a registered role; prefer the registry so model, effort, and
role instructions stay centralized. Never send undeclared routing keys as a probe. Some clients can
ignore unknown fields while still returning a successful spawn, which proves only that a child was
created.

## Routing verification protocol

Keep three facts distinct:

- **Requested route**: the role, model, and effort the orchestrator tried to select.
- **Role-confirmed route**: the current schema declared the role selector, the call accepted it, and
  either tool/runtime metadata reports the selected role or the child returns the profile-only
  attestation embedded in that registered role's instructions.
- **Model-confirmed route**: tool/runtime metadata identifies the effective model and reasoning
  effort. A role TOML, profile attestation, prompt echo, or child self-description does not prove the
  runtime model.

Before the first production dispatch in a run:

1. Verify feature configuration, role registration, referenced TOMLs, and a clean `codex doctor`
   startup report.
2. If configuration changed after the current session started, reload the session before testing.
3. Inspect the current spawn schema. Do not send `agent_type`, `model`, `reasoning_effort`, or other
   routing keys unless that schema declares them.
4. Run one bounded, read-only scratch dispatch for each production role that needs verification.
   The scratch task must request the standard routing report but must not reveal the expected
   profile attestation literal.
5. Capture tool/runtime routing metadata when exposed. A matching profile-only attestation confirms
   that the registered role instructions loaded; it does not confirm model or effort. Without
   runtime metadata, record model/effort as unknown or inherited/unconfirmed.
6. Record requested routing, role evidence, model/effort evidence, and any fallback separately in
   the progress ledger.

Fail closed before implementation when the Terra implementer role cannot be confirmed. A successful
spawn, matching task name, bare approval, or generic model self-report is insufficient routing
evidence. Do not use inherited Sol as a fallback. If Terra exploration or review routing is
unavailable, perform that read-only work in the main session or pause; never spawn an unconfirmed
Sol child.

For an older approved plan, change only unchecked `goal-implementer-sol` assignments to
`goal-implementer-terra` at `xhigh` before dispatch. Preserve completed ledger entries as historical
evidence. This routing migration does not authorize changes to section scope, contracts, gates, or
acceptance criteria.
