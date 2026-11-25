---
mode: agent
description: test-pipeline analyse - explain recorded test failures and suggest fixes
---

Act as **test-pipeline** and run `analyse`.

Follow `./.github/skills/test-pipeline/SKILL.md` and
`references/mechanisms/analysis.md`.

Rules for this run:

- **Read-only.** The only thing you may write is a proposed `knowledge.yaml` entry, and only after I
  confirm it.
- **One failure signature per turn**, then STOP with the next prompt.
- **Normalise before ranking.** Without it the same fault appears once per run and the ranking is
  meaningless.
- **Be honest about confidence.** `UNKNOWN` is a valid answer. Name the evidence behind each verdict,
  and where the data cannot distinguish two candidate causes, say so and say what would.

Start by loading the history and giving me the ranked list of distinct failures with counts, then
stop before analysing the first one.
