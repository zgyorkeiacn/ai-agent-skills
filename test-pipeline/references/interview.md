# Interview

Five question groups, `I2`-`I5` in the `init` slice table (`I2` is one group, `I5` is two). Ask one
group per turn under Copilot. Show every default. Accept a bare "yes"/"default" as acceptance.

Record each answer into `./.test-pipeline/progress.md` under `## Answers` as it is given, so no
question is ever asked twice across turns.

---

## I2 - tests root and runner

### Q2.1 Tests root

> Where do your tests live, relative to the repo root?
> Default: the detected test directory, or `tests/`

Validate: the path exists and contains at least one file. If empty, say so and re-ask.

### Q2.2 Runner confirmation

State what was detected and ask for confirmation rather than assuming:

> I found `playwright.config.ts`, so I will read results from Playwright's JSON reporter.
> Is that right? (alternative: JUnit XML, which covers Cypress, pytest, Maven Surefire and most CI
> runners)

If JUnit XML is chosen, ask where the XML lands:

> Where does your runner write its JUnit XML?
> Default: `test-results/junit.xml` (glob patterns are fine)

### Q2.0 Where do the results come from?

Ask this first, before the runner and the command:

> Should the pipeline run the suite itself, or read results from a CI pipeline that already runs it?
> Options: run locally (default) / read from Azure DevOps / read from GitHub Actions

Local: continue with Q2.2 and Q2.3. CI intake: skip Q2.3 (no command, no probe) and ask instead:

- Azure DevOps: organization, project, pipeline (definition) id, optional branch. Then: published
  test results (default) or a JUnit/Playwright artifact (artifact name, and the file or glob inside it).
- GitHub Actions: owner, repo, workflow file name, optional branch, artifact name, JUnit or Playwright.
- Which environment name the runs belong to (it is the `env` of every record; with several pipelines,
  one CI environment each).
- **The token:** the NAME of the environment variable that holds it (defaults `AZURE_DEVOPS_PAT` /
  `GITHUB_TOKEN`). Never ask for the token value, never write it anywhere: it lives in the user's
  environment (or OS keychain exported into it). Read-only scopes only.

Write it as an environment with `"source": "ci"` and a `ci` block (see `ciEnvironmentExample` in the
config template). The schedule questions still apply: the poll is scheduled like a local run, and a
poll that finds no new completed run is recorded as a skip, never as a run.

### Q2.3 Test command (local runs only)

> What command runs the suite? Use `{env}` where the environment name goes, and `{baseUrl}` for its
> URL.
> Default (Playwright): `npx playwright test`
> Default (JUnit): the detected package script, else ask

Two things must be true and are worth stating plainly:

- The command must **exit non-zero when tests fail**, or it must be fine that it does not. The
  pipeline derives pass/fail from the results file, never from the exit code, so either is workable
  - but a command that hangs will stall the schedule.
- If the suite needs a tag or subset filter, include it here. Do not add a separate filter setting;
  one command string is easier to reason about than a command plus three modifiers.

---

## I3 - environments

### Q3.1 How many, and named what

The shipped `pipeline.config.json` carries seven eCare DAL environments - `dev1`, `int1`, `qc1`,
`qc2`, `qc5`, `qcx`, `prodsup` - each with its base URL, its `VOXI_BASE_URL` companion, and a health
probe. **All are disabled by default.** Offer them:

> Seven environments are pre-configured: `dev1`, `int1`, `qc1`, `qc2`, `qc5`, `qcx`, `prodsup`.
> All are currently off. Which should I enable?
> Default: none - pick at least one

Set `enabled: true` on exactly the ones chosen. Do not enable anything the user did not name.

Nothing is enabled by default on purpose: how many environments fit inside one cycle depends on how
long the suite takes, and the answer is checked in **Q4.5** once the count and the timings are both
known.

If the user wants their own instead, ask for names:

> Which environments should this run against? Give each a short name.
> Examples: `dev1`, `int1`, `qc2`, `prodsup`, `staging`, `prod`
> Default: one environment named `default`

Any number from one upward. Names become directory suffixes, task names and report filenames, so
validate: lowercase, alphanumeric plus hyphen, no spaces, unique.

**Say this once, plainly:** `dev1` and `int1` are extrapolated from the `dal.dx-<env>-blue` pattern
and have not been verified against a live host. If either skips every run with a probe failure, its
hostname is the first thing to check.

### Q3.2 Base URL per environment

Only for environments not already in the config. Ask once each:

> Base URL for `<name>`?

Optional. Some suites get their target from their own config; if so, leave blank and the runner will
not set `BASE_URL`.

### Q3.3 Extra environment variables

Pre-filled for the four shipped environments with `VOXI_BASE_URL`. For anything new:

> Does `<name>` need any other environment variables set? (e.g. a second service URL, credentials
> reference, a region)
> Default: none

Stored per environment as a flat map and exported before the command runs. This exists because real
suites often need a second URL that must stay in lockstep with the first - and stating it per
environment is deliberate. The source pipeline derived that second URL with a regex duplicated in
six places whose copies disagreed on the fallback value, which is exactly the kind of thing that
works until it silently does not.

### Q3.4 Health probe

> Before running, should the pipeline check the environment is up? Skipping a run beats recording a
> wipeout caused by a dead environment.
> Options: none / TCP connect / HTTP GET expecting a status
> Default: HTTP GET on the base URL expecting 200, when a base URL was given

Worth explaining if the user hesitates: a TCP probe passes while an environment answers 503 to
everything, which produces a full red run that means nothing. An HTTP probe with an expected status
catches that; it is the difference between "skipped, environment down" and 25 false failures in the
history.

---

## I4 - schedule window

### Q4.1 Time slot

> What slot in the hour should runs start in? A range spreads the start randomly inside it.
> Default: `:10-:20`

Explain why a range rather than a fixed minute, because it is not obvious and it matters:

> Starting exactly on the hour makes platform problems hard to read - you cannot tell "the
> environment is broken" from "the environment is busy with everything else scheduled at :00". A
> jittered start inside a window removes that confound.

Maps to `startMinute` and `jitterMinutes`.

### Q4.2 Hours and days

> Between which hours, on which days?
> Default: 09:00 to 19:00, Monday to Friday

Say what the defaults buy, so they are a choice rather than an accident:

> Weekends add idle records that dilute day-over-day comparison without anyone acting on them. If a
> particular hour is reliably dead in your environment - a nightly deploy, a service that is down
> out of hours - exclude it here rather than letting it drag every average down.

### Q4.3 Frequency

> How often inside that window?
> Default: hourly

### Q4.4 Staggering (only when more than one environment)

> Your environments will otherwise start in the same minute. Stagger them?
> Default: yes, 5 minutes apart

Only worth doing when the environments share a gateway or the runner host is small. Ask, do not
assume - environments on genuinely separate infrastructure are better off running together, because
then their results are comparable at the same instant.

### Q4.5 Does the schedule actually fit? (computed, not asked)

Run this check before writing the config. It is the difference between a pipeline that works and
one that reports an incomplete cycle every hour forever.

1. Ask how long one run of the suite takes, if it is not already known:

   > Roughly how long does one full run take?
   > Default: 30 minutes

2. Compute the spread of start times:

   ```
   lastStart = startMinute + (enabledCount - 1) * staggerMinutes + jitterMinutes
   lastFinish = lastStart + runMinutes
   cycleBudget = everyHours * 60
   ```

3. Compare and act:

| Condition | Meaning | Do |
|---|---|---|
| `lastFinish <= cycleBudget` and `cycleWaitMinutes >= lastFinish - runMinutes` | fits | continue |
| `lastFinish > cycleBudget` | the last environment finishes after the next cycle starts | **stop and offer the three fixes below** |
| `cycleWaitMinutes < lastFinish - runMinutes` | the first finisher gives up before the last one is done | raise `cycleWaitMinutes`, or reduce the stagger |

4. When it does not fit, state the arithmetic plainly and offer the choices. Do not silently pick
   one:

   > Seven environments at a 5 minute stagger start between :10 and :50. At 30 minutes a run, the
   > last one finishes around :80 - past the start of the next hourly cycle. Every cycle would
   > report incomplete. Three ways to fix it:
   >   1. Drop the stagger to 0 so they all start in the same window and run concurrently. Only
   >      safe if they do not share a gateway that sheds load under load.
   >   2. Run every 2 hours instead of hourly, keeping the stagger.
   >   3. Enable fewer environments.

**Why this check exists:** the failure is entirely silent. Everything runs, records and reports -
the reports are just built from a partial cycle, every time, and the comparison quietly compares
whichever environments happened to finish first.

---

## I5a - reports

Present the list with descriptions, then let the user multi-select. Offer the comparison report
**only when more than one environment was configured**.

> Which reports should the pipeline build? All are HTML; PDFs are rendered alongside if a browser is
> available.

| Report | What it shows | Reach for it when |
|---|---|---|
| **Per-run detail** | One row per run with pass/fail/skip and duration, plus a test-by-run grid. Green tick, grey dash for skipped, red key for failed - the key points at the reason. | You want to see whether a test is flaky or consistently broken. The grid makes the difference obvious at a glance. |
| **Daily one-pager** | One fixed A4 page per day, written for someone who will not read a stack trace. Ranked causes in plain English, a split of environment-caused vs suite-caused, and which hours ran best. | Sending a status update, or someone asks "how is it going" and wants one page. |
| **Per-scenario breakdown** | Inverted: one row per test, worst pass rate first, each expanding into its causes with a share bar. | A specific test is failing and you want its history and its reasons, not the whole day. |
| **Environment comparison** | Cumulative pass rate per environment per test, ranked by biggest divergence, with each environment's failure causes side by side. | Deciding whether a failure is the product or just one environment. Two environments failing the same test for *different* reasons is two faults, and this is where that shows. |

Details for each: [references/reports/](reports/).

If the user asks why the comparison is cumulative rather than comparing today's runs directly, the
answer is in [cross-env-analysis.md](mechanisms/cross-env-analysis.md) - pairing single runs was
tried in the source pipeline and did not survive contact with the data.

## I5b - retention

> How much history should be kept?
> Defaults: 200 run logs, 24 runs' worth of failure artefacts, all history records

Explain the asymmetry, because it is deliberate:

> The history file is one line per run and is worth keeping forever - it is what every report is
> built from, and it is small. Logs and failure artefacts are megabytes each and are reproducible by
> re-running, so those get trimmed.

---

## After I5

Summarise every answer as a table and get confirmation before writing the config in `I6`. Cheap to
correct now, annoying to correct after the scaffolding lands.
