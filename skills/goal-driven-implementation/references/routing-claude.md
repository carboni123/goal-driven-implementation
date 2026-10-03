# Routing — Claude Code

## Roles

| Role                                                                                                                | `subagent_type`           | Pinned model · effort    | Notes                                                                                            |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------ |
| Plan author                                                                                                         | `gdi-planner`             | inherit · session        | Concise goals/order and filtered mapper context; writes only plan/graph artifacts                |
| Implementer                                                                                                         | `gdi-implementer`         | claude-opus-5-5 · high   | One writer per section; may spawn ≤5 read-only helpers via the Agent tool                        |
| Mapper                                                                                                              | `gdi-mapper`              | sonnet · medium          | Read-only; verifies anchors before reporting; no delegation                                      |
| Verify-class reviewer (security, data, contract, failure-mode, doc-truth, capacity, evaluator, final-review lenses) | `gdi-reviewer`            | claude-opus-5-5 · medium | Read-only; may run tests and probes to verify; no delegation                                     |
| Convention/scope reviewer                                                                                           | `gdi-convention-reviewer` | claude-opus-5-5 · medium | Read-only; no delegation                                                                         |

Model and effort pins are set in the agent definitions' frontmatter. **Never pass a per-call
`model`** to these types: it overrides the definition. Effort has no per-call override. If
`CLAUDE_CODE_SUBAGENT_MODEL_FORCE` is set in the environment, the harness ignores every
definition's `model`; check it in preflight. When forced, the effective model comes from
`CLAUDE_CODE_SUBAGENT_MODEL`, or the main session when that variable is absent; record this
route deviation rather than the force flag's value as a model.

The planner runs on `model: inherit` with no `effort` key: it uses the main session's model and
effort. Its fresh context holds the validated mapper evidence, rulings, and open questions.
It returns concise goals, execution order, and filtered section context to the orchestrator.
See the official [subagent configuration](https://code.claude.com/docs/en/sub-agents) for full
model IDs and inheritance.

## Tool allowlists

A definition with no `tools` key inherits every tool in the session, MCP servers included, and
the role re-reads those tool definitions on every turn. Four roles pin an allowlist:

| Role                                                     | `tools`                                                                                               |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `gdi-implementer`                                        | `Read, Edit, Write, NotebookEdit, Bash, PowerShell, Grep, Glob, Agent, ToolSearch, Monitor, TaskStop` |
| `gdi-mapper`, `gdi-reviewer`, `gdi-convention-reviewer`  | `Read, Grep, Glob, Bash, PowerShell`; `disallowedTools` also names the writers and `Agent`            |
| `gdi-planner`                                            | none: it inherits every tool, because the rendered-graph pass needs browser and image tools           |

When a gate needs a tool a role lacks, such as a browser MCP server for a live-flow probe, the
host repository adds it in a project-scope copy of the definition (`mcp__<server>` grants a whole
server). Record that copy under role-confirmed as `host override: tools (<what was added>)`; it
is not a stale role. _Origin:_ `gdi-*` roles with no `tools` key started their first turn at 47k
to 50k tokens; a role on the same machine with a six-tool allowlist started at 7.8k.

## Installing the roles

The definitions are included at `assets/agents/claude/gdi-*.md`. Claude Code loads agents
from `~/.claude/agents/` (user scope) or `.claude/agents/` (project scope); on a name clash the
project copy wins. If a `gdi-*` type is not listed in the session's available agents, copy the
five files there:

```bash
cp <skill-root>/assets/agents/claude/gdi-*.md ~/.claude/agents/
```

Do this in PLAN mode preflight, before preparing the plan for approval, then dispatch the type.
Claude Code picks up a definition added during the session. If the dispatch still rejects the
type as unknown, use the fallback below for this session and record it. Record the outcome in the
plan's Harness routing table. _Origin:_ a run found no `gdi-*` definitions, recorded that
installing them needed a new session, and ran every role on the `general-purpose` fallback: its
first-round reviews took 103 to 516 seconds. In the next run the definitions were installed
mid-session and dispatched three minutes later; `gdi-reviewer` first-round reviews took 52 to 90.

## Verification protocol (before the first dispatch)

Keep three facts distinct and record them per role in the plan's Harness routing table:

- **Requested** — the `subagent_type`, and the model and effort in
  `<skill-root>/assets/agents/claude/<type>.md`.
- **Role-confirmed** — the type is listed in the session's available agents, the dispatch names
  it, **and** the loaded definition is current. Listing alone is not enough: `diff` the installed
  file (`.claude/agents/` in the project when present, else `~/.claude/agents/`) against the
  skill's copy. A project copy that differs only by a recorded `tools` host override (Tool
  allowlists above) is current. Any other differing file is a stale role: reinstall it, or record
  `role-confirmed: stale (<what differs>)`. A stale role still reads the current rules from its
  prompt file; what stays stale is its model, effort, and tool allowlist. _Origin:_ on
  2026-09-13 the installed `gdi-implementer.md` on the maintainer's machine predated 0.4.0 and
  lacked the RETIRES, sensitivity, and evidence-reuse rules the source definition carries; every
  Claude run since had dispatched to the older contract while its plan recorded the current
  release.
- **Model-confirmed** — the Agent tool result reports neither the model nor the effort that ran.
  The user can read the model on the agent's row in `/tasks` (and the effort when the definition
  pins one); record that when they report it. Otherwise record
  `definition: <model/effort>; runtime: unknown`. A subagent's self-description is not evidence.

A first real bounded mapper dispatch serves as role preflight; do not run a throwaway dispatch.
Reuse the routing record while the definition files and environment are unchanged.

## Fallback (recorded, never silent)

- Plan author: the main session authors the plan under the planner contract in
  `assets/prompts/planner.md`. It is the model the
  user selected, so this is not a downgrade, but the author and the approver are then the same
  session; record `fallback: main-session planner` in the routing table and name that risk in
  Graph Findings.
- Mapper → `Explore` with `model: "sonnet"` (read-only by construction); record its session-default
  effort if the fallback cannot select medium.
- Implementer and reviewers → `general-purpose` with `model: "opus"` per call. The Agent tool's
  `model` parameter takes a family alias (`opus`, `sonnet`, `haiku`, and any others its schema
  lists) and rejects a full model ID; full IDs belong in definition frontmatter only.
  Effort cannot be set per call and runs at the session default. Use this only when session effort matches
  the role's frontmatter or an explicit user override covers the deviation; otherwise install
  the role definition first. A generic child has no standing contract and can write files: the
  prompt file named in the stub is its contract, so add, for a reviewer or mapper, an explicit
  instruction that it writes nothing except its REPORT FILE. Record the fallback model and effort
  in the routing table and on every affected ledger row.
- If no read-only reviewer can be dispatched at all, the orchestrator may review a section itself
  only with `review: self (<reason>)` on the row and an accepted risk in Graph Findings; the final
  review must then run with an independent agent, or the run stops.

## Run directory and reports

- **Run directory.** Use `<session scratchpad>/gdi/<plan-slug>/` when the session has a
  scratchpad or temporary directory, otherwise `<system temp dir>/gdi/<repo-name>/<plan-slug>/`.
  Create it in PLAN preflight and record the absolute path in the plan header. Subagents share the
  session's filesystem and write their reports there.
- **Reports.** Every `gdi-*` role and every fallback writes its report to the `REPORT FILE` the
  stub names, runs the `VALIDATE` command, and returns a pointer. `gdi-mapper` and the reviewers
  have no `Write` tool; they write that one file with a shell heredoc. The plan author returns a
  free-form handoff and has no report file.
- **Orchestrator.** When a completion notification arrives, run the validator on the report file
  with `--fix` and read the file. The notification's `<result>` is the pointer, not the report. If
  an agent returned its report in the final message instead of the file, save that message to the
  report path with one shell command and validate it; do not send it back for the file alone.

_Origin:_ the skill named no place for an agent's return, so one run wrote its own `jq` script
over the harness's task output to get each return into a file. Across three runs the
orchestrator typed 103 dispatch prompts, 533k characters: on average 12k per implementer (the
section block, the rules, and the corrections in force) and 3.7k per reviewer.

## Dispatch mechanics

- Parallel dispatch = multiple `Agent` calls in one message. Outside a parallel batch, an
  implementer is one call: wait for its report before any other implementer dispatch. Batch
  members follow **Parallel implementation** below. The harness chooses foreground or
  background; a background agent's report arrives in a completion notification.
- Never pass `isolation` to a `gdi-*` dispatch. A worktree child branches from the default branch,
  not the current HEAD, and its edits land in another checkout: the orchestrator's `git diff`,
  the reviewers, and the section commit would all miss the work.
- Planner: one `Agent` call with the §0 body after the PLAN-mode mapper returns validate (or with
  the verified orchestrator anchors under the mapping exception). When it returns, run
  `git status --porcelain`: only the plan path, plus the feature map and render output already
  listed under baseline exclusions, may have changed. Any other path is a boundary violation:
  restore it, record it in Graph Findings, and re-issue the handoff. Run `validate-plan.mjs` and
  the anchors check yourself; the planner's report is a claim, not the evidence. If the planner
  reports missing browser or image tools, capture the rendered graphs with the orchestrator's
  tools and send the image paths to the **same** planner for the visual pass.
- Follow-ups go to the **same** agent via `SendMessage` (load it with
  `ToolSearch select:SendMessage`): decision relays, report-validation errors, planner captures,
  re-reviews, and a rejection unless the correction-carrier rule below sends it to a fresh
  agent. A follow-up that asks for a new report names a new `REPORT FILE`. Never replace an
  implementer whose section work is in progress; if the agent is lost, record it and resume with
  a new one given the prior report file.
- Reports carry no `ROUTING` line in Claude Code: the harness exposes no routing metadata to the
  child, and the type named at dispatch identifies the definition. Routing evidence lives in the
  plan's table under the protocol above.

## Parallel implementation

Claude Code implements the members of a parallel batch (`SKILL.md`, **Parallel batches**) at the
same time in the session's one checkout.

- **Width.** At most three implementers at a time, within any agent concurrency limit the
  session has. A member's reviewers and read-only helpers do not count against the three.
- **Dispatch.** Send the picked members' implementers as `Agent` calls in one message and keep
  one handle per section. Each runs in the background. When a completion notification arrives,
  validate that member's report and dispatch its reviewers in the same turn; do not wait for the
  other members.
- **One checkout.** Never pass `isolation` and do not create a worktree for a member. The
  reviewers, the join check, and the section commits all read the checkout the implementers
  write. While a batch implementer is active, run no Git command there that changes the index,
  the working tree, or the branch.
- **Follow-ups.** Each follow-up goes to that member's own agent. A rejection follows the
  carrier rule below, and a fresh carrier replaces only that member's handle. A write-set relay
  resumes the same agent, like a decision relay.
- **Usage.** Record each member's `<usage>` block on its own ledger row. At completion, report
  the batch's elapsed time from first dispatch to last commit.

## Correction carrier

A background implementer's completion notification carries a `<usage>` block: `subagent_tokens`
(the agent's context size when it stopped, not a billed total), `tool_uses`, and `duration_ms`.
The field names are undocumented: when the block or `subagent_tokens` is missing, apply the
no-usage-block branch. On a rejection, read `subagent_tokens` from the notification of the report
being rejected:

- **150k or less, or no usage block** → resume the same implementer with `SendMessage` and the
  first body of prompts reference §5.
- **Above 150k** → dispatch a fresh `gdi-implementer` with the carrier stub that
  `section-brief.mjs --round <n>` prints (prompts reference §5). Never message the first handle
  again in this section. Later rounds apply the same test to the fresh agent.

Decision relays, write-set relays, and report-validation errors always resume the same agent,
whatever its size.
Sign-off uses the same carrier rule for required corrections, at the usual implementer route.

_Origin:_ in 16 measured implementer runs, work after the first report was 43% of implementer
spend. Every later turn re-read a context of 183k to 543k tokens, and 22 of 28 follow-ups arrived
after the five-minute subagent prompt cache had expired, so the whole context was written again.

## Economics

Keep worker models and efforts from the definitions; the planner inherits the session route.
Do not promote a worker when review stalls. Apply orchestrator sign-off under `SKILL.md` step 6,
retaining independent reviewer verdicts and acceptance evidence. The mapper keeps Sonnet and
its anchors are checked before implementation and review.

Before resuming an older plan, update unchecked assignments to the current worker pins and
inherited planner route; replace pending model-escalation instructions with sign-off mode.
Preserve completed history, historical escalation records, and explicit plan-specific overrides.

The Agent tool result exposes no token counts. A background agent's completion notification
carries the `<usage>` block described under Correction carrier. Record it per return in the
ledger `cost:` field as observed, for example `ctx 212k / 135 tools / 15 min` (`duration_ms` in
minutes), and write `cost: unknown` when the block is absent. `subagent_tokens` is a context
size, not billed usage; billed usage comes only from `/tasks` or usage reporting.
