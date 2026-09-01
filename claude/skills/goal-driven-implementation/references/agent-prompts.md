# Agent Prompt Templates

Verbatim templates for every agent the orchestrator dispatches. Substitute `{...}`
placeholders; keep everything else intact.

**Agent types & economics.** Every role has a dedicated agent type with model AND
reasoning effort pinned in its frontmatter (`~/.claude/agents/gdi-*.md`):

| Role | `subagent_type` | Pinned | Rationale |
|---|---|---|---|
| Aggregator/mapper | `gdi-mapper` | opus · medium | anchors compound downstream; breadth over depth |
| Implementer | `gdi-implementer` | opus · xhigh | one writer, full section |
| Verify-class reviewer (security, data, contract, failure-mode, final-review lenses) | `gdi-reviewer` | opus · high | review depth is the highest-yield spend — do not economize |
| Convention/scope reviewer | `gdi-convention-reviewer` | opus · medium | precedent-matching, not adversarial depth |

Do NOT pass a per-call `model` parameter when dispatching these types — a
per-invocation model beats frontmatter and would silently defeat the pinning.
Effort has no per-call override; the frontmatter is the only lever. Rationale
for pinning: role economics must not drift with session defaults or with
model-vendor tuning toward more autonomous, token-hungrier behavior.

**Fallback** (session without the `gdi-*` types installed): aggregator →
`Explore`; implementer and all reviewers → `general-purpose` with
`model: "opus"` per call, as in the pre-pinning versions of these templates.

Contents:

1. [Aggregator (Explore agent)](#1-aggregator)
2. [Implementer (general-purpose, model opus)](#2-implementer)
3. [Reviewers (general-purpose, model opus)](#3-reviewers)
4. [Rejection follow-up (SendMessage to implementer)](#4-rejection-follow-up)
5. [Decision relay (SendMessage to implementer)](#5-decision-relay)

---

## 1. Aggregator

Agent: `gdi-mapper` (fallback: `Explore`). Dispatch ONLY for CONTEXT TO AGGREGATE items
that lack `file:line` anchors in the plan, or whose anchored files changed since the plan
was written — items with live anchors go straight into the context brief, no mapper. All
in one message, cap 2. When every item is anchored (the norm), skip this stage entirely.

```text
Map one area of this codebase for an upcoming implementation task. Read-only — do not
modify anything.

AREA: {context item from the section, e.g. "existing auth middleware and how routes opt in"}
TASK IT SERVES: {one-line section goal}

Return, densely, no prose padding:
- Relevant files with file:line anchors for the key symbols.
- The existing pattern/convention to copy (name the exemplar file).
- Existing tests to extend, and how they are run.
- Gotchas: hidden couplings, feature flags, config, migrations that touch this area.
```

Merge the returns into a single context brief (deduplicate, keep file:line anchors) before
dispatching the implementer.

---

## 2. Implementer

Agent: `gdi-implementer`, `run_in_background: false` — no per-call `model` (frontmatter
pins opus · xhigh effort). Fallback: `general-purpose` + `model: "opus"`. Exactly one
alive at a time.

```text
You are the implementation agent for ONE section of a goal-driven implementation plan.
You are the only writer: no other agent writes code for this section, and you must not
delegate code-writing to subagents.

=== SECTION (verbatim from the plan) ===
{full section block: GOAL, ROADMAP/PRD, TARGET, DEPENDS ON, CONTEXT TO AGGREGATE,
IMPLEMENT, CONTRACT DECISION — ESCALATE, VERIFY, ACCEPTANCE, COMMIT}

=== CONTEXT BRIEF (pre-aggregated) ===
{merged aggregator output, or "none — aggregate what you need yourself"}

=== GLOBAL GATE ===
{gate command from the plan}

RULES
- Implement exactly this section's IMPLEMENT list — one vertical slice. Do not touch future
  sections, do not refactor beyond scope, do not fix unrelated issues you notice (report
  them under RISKS instead).
- Read the repo's CLAUDE.md / CONVENTIONS.md first and follow them.
- You may spawn up to 5 subagents via the Agent tool for READ-ONLY work only: deeper context
  mapping, doc lookup, or a focused review of your own diff before reporting. They must never
  edit files. Fan them out in parallel where independent.
- CONTRACT FLOOR: if the work requires touching anything listed under CONTRACT DECISION —
  ESCALATE, stop BEFORE writing that code and return a decision brief (format is in the
  section) as your final message, with STATUS: decision-needed. Do not implement a "temporary"
  version while waiting.
- VERIFY before reporting: run the global gate, the subsystem tests, and the live/e2e flow
  from the section. Paste real command output. Never report an unrun gate as success.
- Do not commit. The orchestrator commits after review.

Your final message must be exactly this report, nothing else:

STATUS: complete | blocked | decision-needed
DIFF: files changed, one line each — what and why
GATE EVIDENCE: command + trailing lines of real output
TESTS RUN: suites executed and results
LIVE FLOW: steps executed and the observed result
ACCEPTANCE: the exit-test clause this satisfies
DEFERRALS: anything left out, and why it is safe to defer
RISKS: what a reviewer should scrutinize, plus unrelated issues noticed
```

---

## 3. Reviewers

Agent: dimensions 1–4 (and final-review integration lenses) → `gdi-reviewer`;
dimension 5 (convention/scope) → `gdi-convention-reviewer`. No per-call `model` —
frontmatter pins model + effort per role. Fallback: `general-purpose` +
`model: "opus"`. Launch all applicable dimensions in ONE message. Full set for
schema/API/auth-touching sections; small low-risk diffs may collapse to
dimensions 3 and 5.

Shared template:

```text
You are a focused, read-only reviewer for one section of an implementation plan. Do not
modify any files.

DIMENSION: {dimension name}
SECTION GOAL: {one-line goal}
DIFF SCOPE: {changed files list, or commit range}
CHECK FOR: {dimension checklist below}

Read the diff and enough surrounding code to judge it in context. Report only findings
inside your dimension, with one shared exception — doc truth: a README/doc/comment claim the
diff introduces or makes stale is in scope for EVERY dimension, and an over-claim (docs
promising what the code does not do) is a REJECT finding. A finding must be concrete and
evidenced — default to APPROVE if nothing concrete surfaces.

Final message:
VERDICT: APPROVE | REJECT
FINDINGS: file:line — issue — why it matters (omit if approving)
NOTES: non-blocking observations
```

Dimension checklists:

1. **Security/authz** — authz checks on every new path; no trust-boundary crossing without
   validation; no secrets/credentials in code or logs; injection surfaces (SQL, shell,
   template); server-side enforcement of anything the client could forge.
2. **Data/migration correctness** — migration is additive and reversible; backfill handles
   existing rows; constraints match the model; no data loss on rollback; indexes for new
   query patterns.
3. **Contract/API compatibility** — public shapes (routes, payloads, config, storage formats)
   unchanged unless a decision brief approved it; backward compatibility for existing
   clients/data; versioning where required.
4. **Failure-mode/reliability** — error paths return sane states; timeouts/retries on
   external calls; partial-failure and idempotency handled; no stale caches or orphaned
   state on the unhappy path.
5. **Convention/scope** — repo conventions followed (naming, layering, test placement);
   change stays inside the section — no future-section drift, no drive-by refactors, no
   dead code left behind; every README/doc/comment claim touched by the diff verified
   against the code it describes.

---

## 4. Rejection follow-up

Send via SendMessage to the SAME implementer agent (load with ToolSearch
`select:SendMessage`). Never respawn a fresh agent for fixes — the original holds the
context.

```text
REVIEW RESULT: rejected. Fix exactly these gaps — nothing else — then send the full report
again in the same format:

1. {file:line — gap — required fix}
2. {...}

Re-run the global gate and any affected tests after fixing; paste fresh output. Previous
gate evidence is void.
```

Max 2 rejection rounds per section; then stop and escalate to the user.

---

## 5. Decision relay

After the user answers a decision brief (via AskUserQuestion), relay to the same implementer:

```text
DECISION on your brief: {chosen option, verbatim user intent, any constraints they added}

Proceed with implementation under this decision. The contract floor it covers is now
approved for exactly this change — everything else in CONTRACT DECISION — ESCALATE still
requires a new brief.
```
