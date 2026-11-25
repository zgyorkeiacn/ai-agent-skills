---
name: test-pipeline
description: 'Scaffold a scheduled test-execution and reporting pipeline into any repo, then analyse the results. Interviews for tests root, environments, time slot and reports; generates a headless runner, result ingestion, HTML/PDF reports and a scheduled task (Windows Task Scheduler or cron). Runner-agnostic (Playwright JSON or JUnit XML). Also provides on-demand failure analysis that separates environment faults from product faults, flags flaky tests, and suggests fixes. No Teams, webhooks or publishing.'
argument-hint: '"init" | "doctor" | "analyse" | "report" | "uninstall" | "status"'
user-invocable: true
---

# test-pipeline Skill (`/test-pipeline`)

Turns any test suite into a scheduled pipeline that records every run, builds cross-referencing
reports, and can explain its own failures. Results come from running the suite locally, or from
**CI intake**: finished Azure DevOps or GitHub Actions runs read through their REST APIs.

The skill runs the **interview and the analysis**. It does not sit in the loop of every run - `init`
scaffolds plain PowerShell/shell/node scripts into the target repo and registers a scheduled task,
after which the pipeline runs headless with no agent involved. `analyse` is invoked on demand
against the recorded history.

---

## Operating rules

Apply to every mode, in any agent (Claude Code, Copilot, Cursor).

1. **One slice per turn under Copilot.** See [incremental execution](references/mechanisms/incremental-execution.md).
   This is the default whenever the runtime is not clearly Claude Code.
2. **Never invent config.** Every value in `pipeline.config.json` comes from the interview, a
   detected fact, or a stated default the user accepted. If a value cannot be determined, ask.
3. **Never write into the target repo before the config is confirmed.** The interview completes and
   the config is written first; templates land only after.
4. **Scaffolded scripts must run without the agent.** No step may depend on an LLM being present.
   If something genuinely needs judgement, it belongs in `analyse`, not in the runner.
5. **A non-run is not a failure.** A skipped slot is recorded in the skip log and as a cycle marker,
   never in `history.jsonl`. Blurring the two makes every report wrong. This rule is load-bearing;
   see [run-lifecycle](references/mechanisms/run-lifecycle.md).
6. **No em-dash.** Use a regular hyphen. Applies to generated code, docs and report copy.
7. **Preserve the reason.** Where a template carries a comment explaining why something is the way
   it is, keep it. Those comments record incidents, not preferences.

---

## Mode dispatch

| Argument | Mode | Agent needed? |
|----------|------|---------------|
| `init` (or no argument) | [init](#mode-init) - interview, scaffold, schedule | yes |
| `doctor` | [doctor](#mode-doctor) - is the pipeline actually running? | no |
| `analyse` | [analyse](#mode-analyse) - explain failures, suggest fixes | yes |
| `report` | [report](#mode-report) - regenerate reports from history | no |
| `uninstall` | [uninstall](#mode-uninstall) - remove tasks and scripts | no |
| `status` | print resolved config and exit | no |

---

## Mode: init

Scaffolds the pipeline. Sliced into discrete steps; under Copilot do **one per turn** and stop.

| Slice | Step | Writes |
|-------|------|--------|
| `I1` | Detect repo root, test runner and existing config | nothing |
| `I2` | Interview: results source (local or CI), tests root + runner confirmation | nothing |
| `I3` | Interview: environments | nothing |
| `I4` | Interview: schedule window | nothing |
| `I5` | Interview: reports + retention | nothing |
| `I6` | Write `pipeline.config.json` and show it back | config |
| `I7` | Scaffold `lib/` + `ingest/` | templates |
| `I8` | Scaffold selected `reports/` | templates |
| `I9` | Scaffold `runner/` for the host platform | templates |
| `I10` | Scaffold + register `schedule/` (one task per environment) | templates, scheduled task |
| `I11` | Smoke test: run once, confirm a history record and reports | run artefacts |

Full question wording, defaults and validation: [references/interview.md](references/interview.md).

### Step I1 - detect

1. Resolve the repo root: `git rev-parse --show-toplevel`, else the current directory.
2. Look for an existing `pipeline.config.json`. If found, print it and ask whether to
   reconfigure, extend (add an environment / report), or abort. Do not silently overwrite.
3. Detect the runner: a `playwright.config.*` at the root means Playwright; otherwise assume
   JUnit XML and say so. Always confirm with the user rather than proceeding on the guess.
4. Detect the platform: Windows means Task Scheduler, anything else means cron.

**STOP.** Report what was detected. Next slice is `I2`.

### Steps I2-I5 - interview

Work through [references/interview.md](references/interview.md) in order. Ask one group per turn.
Show every default and let the user accept it. Never ask a question whose answer is already
determined (with one environment, do not ask about the comparison report - it is not applicable).

### Step I6 - write config

Write `pipeline.config.json` to the repo root using the schema in
[templates/config/pipeline.config.json](templates/config/pipeline.config.json). Print it back in
full. Get explicit confirmation before `I7`.

### Steps I7-I10 - scaffold

Copy from `templates/`, substituting config values. Land files under `<pipelineDir>/` (default
`test-pipeline/`) in the target repo. Register one scheduled task **per environment** -
`install-schedule` takes the environment name and passes it to the runner. A single task that can
only run defaults is the bug this skill exists to avoid.

### Step I11 - smoke test

Trigger one run manually, then assert: a line was appended to `history.jsonl`, and every selected
report regenerated. Report the paths. If the suite itself fails, that is fine and expected - the
pipeline is working. Say so explicitly so a red suite is not mistaken for a broken install.

---

### CI intake (environment with `source: ci`)

Instead of running the suite, the scheduled task runs `ingest/ci-intake.mjs`: it lists the newest
completed runs of the configured pipeline (Azure DevOps build runs, GitHub Actions workflow runs),
fetches each unseen run's results (published test results or an artifact), normalises them through the
same `collect-run.mjs` and adapters, and appends to the same `history.jsonl`. Run ids look like
`ci-ado-<buildId>` and `ci-gh-<runId>` and are never ingested twice. Rules that stay true here:
read-only API use; the token comes only from the environment variable named in `ci.tokenEnv`
(Rule 13), never a file, command line or log; a poll with nothing new, no token or an HTTP error is a
skip (skip log + cycle marker), never a history record. Tests: `node --test tests/` (recorded
fixtures; the live test runs only when a token is already set).

---

## Mode: doctor

Read-only health check. Answers "is this actually running?" - the question nobody asks until the
reports have been silently stale for a week. No agent judgement required; it is a fixed checklist.

1. Config found and parseable?
2. For each environment: is a scheduled task registered, and is it enabled?
3. For each environment: when did it last run, and did it exit cleanly?
4. Gaps: expected firings in the schedule window with no history record and no skip-log entry.
   **A firing that produced neither is the dangerous case** - it means something exited before the
   runner could record anything.
5. History integrity: unparseable lines, records with no environment, clock going backwards.
6. Disk: size of the run directory against the retention policy.

Print a table, one row per check, `OK` / `WARN` / `FAIL` with the specific finding. Exit non-zero
on any `FAIL` so it can be wired into monitoring.

---

## Mode: analyse

The agent-facing mode, and where "present the failures and suggest fixes" lives. Read-only with
respect to the pipeline; the only thing it may write is a proposed `knowledge.yaml` entry, and only
after the user confirms.

Sliced per failure signature under Copilot. See
[references/mechanisms/analysis.md](references/mechanisms/analysis.md) for the full method.

1. Load history, apply [signature normalisation](references/mechanisms/signature-taxonomy.md).
2. Rank distinct failures by journeys affected, then occurrences.
3. For each, establish: **owner** (environment or suite), **age** (new / recurring / flaky), and
   **spread** (one environment or all).
4. Where more than one environment ran, apply the
   [four-bucket split](references/mechanisms/cross-env-analysis.md) - a failure on every environment
   with the *same cause* is the product; on one environment it is that environment's data or config;
   on several with *different* causes it is several faults and must not be merged.
5. Consult `knowledge.yaml` for a curated entry. If one exists it replaces the generated
   explanation and carries its probe.
6. Suggest a next action. Be honest about confidence: name the evidence, and say plainly when the
   data cannot distinguish two candidate causes.
7. For a recurring failure with no knowledge entry, draft one and offer to append it.

---

## Mode: report

Regenerate every selected report from the recorded history without running the suite. A thin wrapper
over the same node scripts the runner calls. Useful after editing `knowledge.yaml`, and as the fast
path when someone asks "what does it look like now".

---

## Mode: uninstall

1. List what will be removed - tasks by name, directories by path - and **ask before removing
   anything**.
2. Unregister the scheduled task for each environment.
3. Optionally remove the scaffolded scripts.
4. **Never remove `history.jsonl` without a second, explicit confirmation.** It is the accumulated
   record, it is usually committed, and it cannot be regenerated.

---

## Reference map

| Topic | File |
|---|---|
| Copilot slicing, progress file, stop protocol | [mechanisms/incremental-execution.md](references/mechanisms/incremental-execution.md) |
| Interview questions, defaults, validation | [interview.md](references/interview.md) |
| Run lifecycle, gates, skip-vs-fail invariant | [mechanisms/run-lifecycle.md](references/mechanisms/run-lifecycle.md) |
| Signature kinds and normalisation | [mechanisms/signature-taxonomy.md](references/mechanisms/signature-taxonomy.md) |
| Multi-environment comparison method | [mechanisms/cross-env-analysis.md](references/mechanisms/cross-env-analysis.md) |
| Knowledge file schema and growth | [mechanisms/knowledge-file.md](references/mechanisms/knowledge-file.md) |
| Failure analysis method | [mechanisms/analysis.md](references/mechanisms/analysis.md) |
| What each report shows | [reports/](references/reports/) |
