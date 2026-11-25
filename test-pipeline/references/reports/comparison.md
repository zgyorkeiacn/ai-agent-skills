# Environment comparison

`reports/comparison.html` - generated only when more than one environment is configured.

## What you see

**Current verdict** from the latest run on each environment, split three ways:

- **Failing everywhere, same cause** - treat as the product or a shared dependency.
- **Failing on several, different causes** - separate faults that happen to share a test.
- **Failing on one only** - that environment's data or configuration.

**Cumulative pass rate per test** - one column group per environment showing the latest outcome, the
cumulative rate, and `n`. Sorted by spread, so the tests the environments most disagree about come
first.

**Failure causes per environment** - the same tests with each environment's causes side by side.

## When to reach for it

Deciding whether a failure is the product or just one environment. That single distinction usually
determines which team picks it up.

## Why it is cumulative rather than paired

Pairing today's runs was tried and does not survive the data: on one recorded day thirteen of
twenty-five tests changed status between two runs ninety minutes apart on the same environment. A
paired report would have presented that as a permanent difference between environments.

`n` is printed on every figure. A rate over two runs is not evidence and the report does not pretend
it is.

## The trap this report is designed around

Two environments failing the same test for **different** reasons is two faults, not one. Compare the
two cause columns rather than the row. Merging them into a single "fails everywhere" line sends
somebody looking for a root cause that does not exist.

## More than two environments

Fully supported. Columns are generated from the config, so a third or fourth environment needs no
code change.
