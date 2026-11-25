# test-pipeline

Scaffold a scheduled test-execution and reporting pipeline into any repo, then analyse the results.

Interviews you for the tests root, environments, time slot and reports; generates a headless runner,
result ingestion, HTML/PDF reports and a scheduled task. Runner-agnostic and cross-platform.

```
/test-pipeline init        interview, scaffold, register the schedule
/test-pipeline doctor      is it actually running?
/test-pipeline analyse     explain the failures, suggest fixes
/test-pipeline report      rebuild reports from recorded history
/test-pipeline uninstall   remove tasks and scripts
```

## What it builds

One scheduled task **per environment**. Each run: probe the environment, run the suite, append one
record to an append-only history, then - for exactly one run per cycle - rebuild the reports.

No agent is involved after `init`. The scaffolded pipeline is plain PowerShell, shell and node with
**no install-time dependencies**.

| | |
|---|---|
| Test runners | Playwright JSON reporter, or JUnit XML (Cypress, pytest, Surefire, most CI) |
| Result sources | run locally, or read from Azure DevOps / GitHub Actions runs (CI intake) |
| Schedulers | Windows Task Scheduler, or cron |
| Environments | any number, arbitrarily named |
| Reports | per-run detail, daily one-pager, per-scenario breakdown, environment comparison |
| Not included | Teams, webhooks, publishing, preflight, self-healing |

## CI intake: read results from Azure DevOps or GitHub

Instead of running the suite, an environment can read the results of finished CI runs.
`init` asks "run locally or read from CI?"; a CI environment is `"source": "ci"` plus a `ci` block in
`pipeline.config.json` (`ciEnvironmentExample` shows the shape).

| Provider | What is read |
|---|---|
| Azure DevOps | the build's published test results (REST, turned into JUnit and normalised by the junit adapter), or a JUnit/Playwright artifact zip |
| GitHub Actions | the run's artifact zip (JUnit XML or Playwright JSON) |

- Scheduled like a local run (one task per environment). Each poll takes the newest completed runs,
  records those not yet seen (`ci-ado-<id>`, `ci-gh-<id>`) and skips the rest, so a run is never
  recorded twice. Reports and `analyse` then cover CI runs like any other.
- **Credentials:** only from the environment variable named in `ci.tokenEnv` (default
  `AZURE_DEVOPS_PAT` or `GITHUB_TOKEN`), read-only scopes. Never stored in a file, passed on a
  command line or logged.
- Nothing new, a missing token or an API error is recorded as a skip, never as a run.
- Tests: `node --test tests/` replays recorded API responses; a live call happens only when a token is
  already set and `TP_LIVE_ADO_ORG`, `TP_LIVE_ADO_PROJECT`, `TP_LIVE_ADO_PIPELINE` are given, read only.

## The reports

- **Per-run detail** - a test-by-run grid that separates a flaky test from a consistently broken
  one. A pass-rate column cannot tell you whether 60% means "fails every afternoon" or "fails at
  random"; the grid can.
- **Daily one-pager** - one page per day for a reader who will not open a stack trace. Ranked causes
  in plain English, platform-vs-suite split, best hour to run.
- **Per-scenario breakdown** - one row per test, worst first, each expanding into its causes with a
  share bar.
- **Environment comparison** - *(2+ environments)* cumulative pass rate per environment, ranked by
  divergence, with each environment's causes side by side.

Details in [references/reports/](references/reports/).

## Three things it gets right that are easy to get wrong

**A skipped run is not a failed run.** Skips go to a skip log and a cycle marker, never to the
history. Blur the two and an environment outage becomes a permanent product regression in every
chart built afterwards.

**Volatile ids are masked before grouping.** An error carrying a UUID or a timestamp otherwise
produces a new signature every run, so recurring faults present as a long tail of one-offs - exactly
backwards. Masking happens at read time, never at write time, so the history stays one consistent
key space.

**Two environments failing the same test for different reasons is two faults.** The comparison keeps
them apart. Merging them into "fails everywhere" sends someone hunting a root cause that does not
exist.

## Failure explanations

Generated from the signature grammar by default - shallow, but never wrong. A team grows
`knowledge.yaml` over time with what it has actually established; a curated entry always beats a
heuristic and can carry a probe that re-proves it. `analyse` drafts entries for recurring unknowns
and appends them only on confirmation.

See [references/mechanisms/knowledge-file.md](references/mechanisms/knowledge-file.md).

## GitHub Copilot

Written for Copilot first. Every mode is sliced into small steps, progress is tracked in
`./.test-pipeline/progress.md` (Copilot has no TodoWrite), and each turn ends with a pasteable next
prompt. Claude Code runs the same modes one-shot.

Copy [prompts/](prompts/) into `.github/prompts/` and copy this skill folder into
`.github/skills/test-pipeline/` so Copilot can read it - Copilot only sees files inside the open
workspace.

See [references/mechanisms/incremental-execution.md](references/mechanisms/incremental-execution.md).

## Layout

```
SKILL.md                     mode dispatch and the interview
references/
  interview.md               questions, defaults, validation
  reports/*.md               what each report shows, and when to reach for it
  mechanisms/*.md            slicing, lifecycle, signatures, comparison, knowledge, analysis
templates/
  lib/                       signature, normalise, classify, flake, cross-env
  ingest/                    collect-run + playwright and junit adapters; ci-intake + ci/providers + zip (CI intake)
tests/                       node --test suite for CI intake, with recorded fixtures
  reports/                   four generators, shared HTML and history helpers
  runner/                    run-cycle, cycle rendezvous, build-reports, doctor, uninstall
  schedule/                  install-schedule for Task Scheduler and cron
  config/                    pipeline.config.json schema, knowledge.yaml seed
prompts/                     Copilot slash-command wrappers
```
