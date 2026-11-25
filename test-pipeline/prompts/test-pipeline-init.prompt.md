---
mode: agent
description: test-pipeline init - interview, scaffold a scheduled test pipeline, register the schedule
---

Act as **test-pipeline** and run `init`.

Follow `./.github/skills/test-pipeline/SKILL.md`, the `init` mode, and the step files it links to.

Copilot-specific rules for this run:

- **One slice per turn.** The `init` mode is sliced `I1` to `I11`. Do exactly one, then STOP and
  give me the prompt to paste for the next. Do not run ahead.
- **Track progress on disk.** Maintain `./.test-pipeline/progress.md` as a checkbox list, and read
  it at the start of every turn to find the next unchecked slice. You have no TodoWrite here.
- **Ask, do not assume.** Every config value comes from my answer or a default I accepted. Show the
  default and let me take it.
- **Write nothing into the repo before I confirm the config** at slice `I6`.

Start at `I1`: detect the repo root, the test runner and the host platform, then stop and tell me
what you found.
