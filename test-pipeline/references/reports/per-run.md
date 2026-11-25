# Per-run detail

`reports/per-run-<env>.html` - one per environment.

## What you see

**KPI strip** - runs recorded, pass rate, failed executions, retry-passes, flaky test count.

**Per run** - one row per run grouped under a clickable day summary: time, duration, and the
pass / fail / retry-pass / skip split with a rate.

**Per test, run by run** - the grid, and the reason this report exists. One row per test, one column
per run:

| Cell | Means |
|---|---|
| tick | passed |
| dash | not executed (gated or skipped) |
| tilde | passed on retry |
| `F3` | failed, pointing at cause F3 in the legend |

**Failure causes** - the legend. Each `F`-key with its signature, what it is attributed to, how many
tests it hit, its owner, and why the classifier said so.

## When to reach for it

When you want to know whether a test is flaky or consistently broken. A pass-rate column cannot tell
you whether 60% means "fails every afternoon" or "fails at random", and those need completely
different responses. Reading across a row answers it immediately; reading down a column tells you
whether one particular run went wrong everywhere.

The `F`-keys are stable across reports, so `F3` means the same failure in the per-scenario
breakdown.
