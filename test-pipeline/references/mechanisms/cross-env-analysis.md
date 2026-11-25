# Multi-environment analysis

Implemented in `templates/lib/cross-env.mjs`. Answers the only question that matters when a test
fails in more than one place: is this the product, or is it that environment?

## The four buckets

| Bucket | Condition | Read as |
|---|---|---|
| `product` | failed on every environment that ran it, **same cause** | the product or a shared dependency |
| `divergent` | failed on several, **different causes** | several separate faults sharing a test |
| `perEnv` | failed on one environment only | that environment's data or configuration |
| `coverageGaps` | did not run everywhere | a gap, not a result |

## The rule that is easy to get wrong

Comparing pass/fail alone overstates the shared case. Two environments can fail the same test for
completely unrelated reasons. Reporting that as "fails everywhere, therefore platform-wide" sends
somebody hunting a single root cause that does not exist.

**A shared failure is only evidence of a shared cause if the CAUSE matches.** That is why
`divergent` is a separate bucket and is never folded into `product`.

## Cumulative, not paired

The comparison report deliberately does not line up today's run on each environment and diff them.

That was tried in the pipeline this was extracted from and it does not survive contact with the
data. On one recorded day, thirteen of twenty-five tests changed status between two runs ninety
minutes apart **on the same environment**, and another went from 19 passed / 6 failed to 0 / 25
within three hours as the platform degraded. A paired report would have presented that outage as a
permanent property of an environment.

Pass rate over many runs survives that. `n` is printed on every figure, because a rate over two
samples is not evidence and the report should not imply otherwise.

Both figures are shown per environment - the cumulative rate and the most recent outcome - because
they answer different questions. A test can sit at 2/44 cumulative and still be passing right now.

## Skipped is not failed

A gated or skipped test is excluded from every rate. It is a data gap, not a result, and counting it
as a failure blames the environment for a decision the harness made before the test ever started.

## N environments, not two

Nothing in the library or the report is limited to a pair. Columns are generated from
`config.environments`, and `compareAll` handles any number. Adding a third environment requires no
code change.
