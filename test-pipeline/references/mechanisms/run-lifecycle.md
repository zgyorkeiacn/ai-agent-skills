# Run lifecycle

What one scheduled firing does, in order. Implemented in `templates/runner/run-cycle.ps1` and its
POSIX twin `run-cycle.sh`.

| # | Step | Gate? |
|---|---|---|
| 1 | Resolve repo root, load config, resolve this environment | fails fast if the name is unknown |
| 2 | **Gate A - hold.** Read `<runsDir>/hold-until.txt` | future timestamp -> skip |
| 3 | **Gate B - health probe.** TCP or HTTP per config | not healthy -> skip |
| 4 | **Gate C - overlap lock.** `<runsDir>/.running-<env>` | live owner process -> skip |
| 5 | Take the lock, set `BASE_URL` / `TEST_ENV` / configured extras |  |
| 6 | Run the test command, tee to a per-run log | exit code deliberately ignored |
| 7 | `collect-run.mjs` appends one record to `history.jsonl` | unreadable results -> skip |
| 8 | Write a cycle marker (`ran`) |  |
| 9 | Wait for the other environments, bounded |  |
| 10 | Try to claim the reporting | lost the claim -> exit quietly |
| 11 | Build reports under a per-checkout mutex |  |
| 12 | `finally`: release the lock, trim old logs | always runs |

## The skip-vs-fail invariant

**A skipped slot is recorded in `skipped.log` and as a cycle marker. It NEVER reaches
`history.jsonl`.**

A non-run and a failed run mean opposite things. Blur them and an environment outage becomes a
product regression, permanently, in every chart built from that history afterwards. There is no way
to unpick it later, because the record no longer distinguishes them.

Every skip also writes a cycle marker. Without it, the other environments wait the full timeout for
a run that is never coming - and the symptom is a twenty minute unexplained delay that nobody
attributes to the environment that quietly bailed.

## Why the exit code is ignored

A suite with failing tests exits non-zero, and that is a perfectly good run. Pass and fail are
derived from the results file, which is the only source that can tell "three tests failed" apart
from "the runner could not start". Trusting the exit code conflates the two.

The corollary: if the results file is unreadable, the run is recorded as a **skip**, not as zero
passes. A fabricated empty record would enter the history as a real datapoint and quietly drag every
average down.

## The claim

Exactly one environment per cycle builds the reports. The claim is an atomic file create
(`FileMode.CreateNew` on Windows, `set -o noclobber` on POSIX) - the failure to create IS the mutual
exclusion. It is deliberately not a check followed by a create: every environment can clear the wait
in the same instant.

## Why the report mutex is named per checkout

`Global\` names are machine-wide. A fixed name means two checkouts of this pipeline on one host
serialise their reporting against each other for no reason, and the symptom is a ten-minute
unexplained stall. The name is hashed from the repo path so the guard still does its real job -
stopping two environments of the SAME pipeline writing reports concurrently.

## Pausing

Write an ISO timestamp into `<runsDir>/hold-until.txt`. Firings before it are skipped and logged,
and the file clears itself once the time passes.

Preferred over disabling the scheduled task, because a disabled task needs a human to remember to
switch it back on - and a schedule that silently stopped weeks ago is the failure mode `doctor`
exists to catch.
