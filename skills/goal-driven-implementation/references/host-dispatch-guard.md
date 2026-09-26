# Optional host writing dispatch guard

This reference applies to **writing implementer dispatch**. Planning, mapping, and review are
read-only and do not require a writing lane. Discover a host guard from the repository's
instructions and documented tool path. Check a documented conventional path if instructions do
not name one. If neither declares nor supplies an integration, use the normal dispatch flow.
If instructions declare a guard but its file or required command cannot be read or run, stop
writing dispatch visibly and report the failing path or command. Do not treat an unreadable
integration, failed GitHub read, or malformed result as an absent guard.

Before a guarded writing dispatch, record the task ID, repository-relative plan path, and a
nonempty list of explicit approved write paths. Normalize paths relative to the repository;
reject absolute paths, `..` traversal, ambiguous module roots, or glob patterns. Use the
host's path classifier; labels such as `CORE SCOPE` in plan prose do not classify a path.
Include every approved write path, including explicit registry files outside the module. If an
older plan lacks this list, collect it from its approved section and current task scope before
writing. Keep the same task ID and plan path on every reserve and release for that task.

Immediately before **each** writing implementer dispatch or writing resume, invoke the host's reserve
operation over the complete approved path list and inspect its successful result. This includes
a first implementer, decision relay, resumed or fresh section correction, final-review
correction, escalation, and replacement after a lost agent.
The reserve operation must perform the host's current conflict recheck as well as reservation;
a past `check`, cached clear result, or old reservation is not dispatch admission. If reserve
fails, stop that writing dispatch and preserve any existing reservation for its owner. Pass the
guard result, approved paths, task ID, and plan identity in the implementer brief. The worker
must pause before writing outside those paths and return the proposed expansion to the
orchestrator. For an expansion, approve the added paths and re-run reserve with the **entire**
new scope before the same worker continues or a replacement starts. Apply the host's module and
registry rules to the complete scope.

Keep a successful reservation through report validation, review, corrections, and section
acceptance. At PR handoff or deliberate abandonment, invoke host release with the matching
task and plan identity and check success. A timeout, stopped agent, failed reserve, or foreign
owner is not authority to release or steal a reservation. When resuming an existing PR, supply
the exact PR number only after verifying it belongs to the current repository and branch;
reuse that same argument for later guarded dispatches. The host must verify that resume claim
against live PR data. A same-PR exemption does not waive conflicts with other PRs.

For example, Tyxter Messaging documents `scripts/harness/core-dispatch.mjs` in its
`scripts/README.md`. From that repository root, with its authenticated CLI path when needed:

```bash
node scripts/harness/core-dispatch.mjs reserve --task <task-id> --plan <repo-relative-plan-path> --write-path <approved-repo-relative-path> [--write-path <another-path>] [--same-pr <verified-number>] [--gh <authenticated-cli>]
node scripts/harness/core-dispatch.mjs release --task <same-task-id> --plan <same-plan-path>
```

For core paths, that host's `reserve` checks open PR files, enforces its
one-module-plus-explicit-registries rule, then creates or resumes an exclusive reservation in
the shared Git directory. For its non-core paths, a successful result has no reservation and
permits dispatch.
Its CLI prints JSON on success and a plain stderr error on failure; inspect the exit status
and output, without assuming an error-code field. This classification and CLI are an example,
not a universal core-module list or interface for other hosts.
