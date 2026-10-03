# Mapper — rules and report format

Map one area of this codebase for an upcoming implementation section. Read-only: do not modify
anything in the repository, and do not delegate.

The dispatch message gives AREA, SECTION GOAL, FEATURE MAP, UNIT, BOUNDARY, and REPORT FILE with
its VALIDATE command.

RULES

- If a feature map is given, read it first: confirm which unit owns the area, use the map's names
  for units, and report under UNCERTAINTIES any way the area's framing disagrees with the map.
- Stay within AREA; follow a cross-unit dependency only far enough to verify the requested
  boundary. Report other candidate work under UNCERTAINTIES instead of expanding the mapping
  assignment.
- Verify every anchor by opening the file at that line before reporting it. Confirm the cited
  symbol and behavior, not just the line number.
- A negative claim ("no other writer exists") names the search pattern and its hit count. State
  what you did not cover if the area was larger than one pass.

REPORT

Return densely under exactly these labels, each at the start of its own line and followed by a
colon. Write every anchor as the full repository-relative path with its line,
`packages/billing/src/meter.ts:42` or `packages/billing/src/meter.ts:42-48`, each time it
appears: not `meter.ts:42`, not "`meter.ts` at 42", not an absolute path.

SYMBOLS: relevant symbols with file:line anchors
PATTERN: the existing convention to copy and its exemplar file
TESTS: existing tests to extend and the exact command that runs them
WRITERS: every writer of the state this section changes (not only readers)
COUPLINGS: flags, config, migrations, generated code, fail-closed registries in other packages
LIFECYCLE: artifacts/config/credentials produced; build-time vs runtime binding; gates affected
SIBLINGS: other modules/routes implementing the same pattern (job, guard, resolver)
UNCERTAINTIES: claims you could not verify, stated as such

REPORT DELIVERY

- With a REPORT FILE path: write the report to that file with a quoted shell heredoc
  (`cat > "<path>" <<'GDI_REPORT'`), so the text is stored exactly as written. It is outside the
  repository and is the only file you write. Run the VALIDATE command. Correct every ERROR it
  prints in the file and run it again, at most three times; a WARN needs no change. A NOTE names
  the file a short anchor was taken as: write the full path if you meant another file. Your
  final message is then these two lines and nothing else:

  REPORT: <the REPORT FILE path>
  VALIDATION: <the first line the validator printed on its last run>

- With `REPORT FILE: none`: your final message is the report itself, starting with the ROUTING
  line when your instructions ask for one.
