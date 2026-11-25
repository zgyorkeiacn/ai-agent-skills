# Incremental execution (Copilot-first slicing)

Most runs happen under GitHub Copilot, which produces better results from many small prompts than
one large one. Execution is therefore **incremental by default**: do ONE slice per turn, then stop
and hand back a copy-paste prompt for the next. Claude Code handles long autonomous turns well and
runs **one-shot** instead.

## Runtime default

- **Assume Copilot/Cursor -> incremental.** The default whenever the runtime is not clearly
  Claude Code.
- **Claude Code -> one-shot.** Detected when native `TodoWrite` + `Skill` tools are available and a
  `~/.claude/` directory exists. Run each mode to completion in the turn.
- **Overrides** (either runtime): `--increment` forces slicing, `--autopilot` forces one-shot.

## Slice units

| Mode | Slice per turn |
|---|---|
| `init` | one step from the `I1`-`I11` table in SKILL.md, then STOP |
| `analyse` | one failure signature, then STOP |
| `doctor` | not sliced - one read-only pass |
| `report` | not sliced - one operation |
| `uninstall` | not sliced, but confirm before removing |
| `status` | not sliced |

`init` is the mode that matters here. Eleven slices is deliberate: each one produces a checkable
artifact, so a run that dies midway can be resumed from the progress file rather than restarted.

## Progress tracking

Copilot has no `TodoWrite`, so progress lives on disk.

- **Claude Code**: use `TodoWrite`, one item per slice.
- **Copilot/Cursor**: maintain `./.test-pipeline/progress.md` as a checkbox list. Write it at the
  start of `I1`, tick each item as its slice lands, and **read it at the start of every turn** to
  find the next unchecked item.

Initial content, written during `I1`:

```markdown
<!-- test-pipeline init | started: 2026-01-01T00:00:00Z | repo: <abs path> -->
- [ ] I1  detect repo, runner, platform
- [ ] I2  interview: tests root
- [ ] I3  interview: environments
- [ ] I4  interview: schedule window
- [ ] I5  interview: reports + retention
- [ ] I6  write pipeline.config.json
- [ ] I7  scaffold lib/ + ingest/
- [ ] I8  scaffold reports/
- [ ] I9  scaffold runner/
- [ ] I10 scaffold + register schedule
- [ ] I11 smoke test
```

Answers collected during `I2`-`I5` are appended to the same file under an `## Answers` heading as
they are given, so a later turn never has to re-ask a question the user already answered.

## Resume rules

At the start of every turn:

1. Read `./.test-pipeline/progress.md`. Absent means this is a fresh run - start at `I1`.
2. Take the first unchecked item.
3. If `pipeline.config.json` already exists but `I6` is unchecked, the config was written by a
   previous run. Show it and ask whether to reuse or redo, rather than silently overwriting.
4. Never silently redo a completed slice. If asked to, confirm first.

## Stop protocol

After completing a slice, output exactly:

1. **Done** - what was produced, with paths.
2. **Next** - the next slice id, or "all slices complete".
3. **Continue** - the exact prompt to paste, e.g. `/test-pipeline init` (the skill resolves the next
   slice from the progress file, so the same prompt advances the run).

Then STOP. Do not begin the next slice. Under `--autopilot` and the Claude Code default, skip the
stop: run slices back to back with a one-line checkpoint between each, and finish with the normal
end-of-mode report.

## Writing style for every step in this skill

Because the primary runtime is Copilot, every instruction in `references/` is written as:

- **numbered atomic steps**, one action each - not prose paragraphs
- **explicit inputs and outputs** per step
- **an explicit stop marker** where a turn should end
- **no forward references** - a step never depends on having read a later one

If a step cannot be stated in one sentence, it is two steps.
