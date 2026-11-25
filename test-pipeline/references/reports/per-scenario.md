# Per-scenario breakdown

`reports/per-scenario-<env>.html` - one per environment.

## What you see

One collapsed row per test, worst pass rate first. The closed row alone carries the pass rate, the
pass/fail/gated counts, a stacked bar splitting that test's failures by what was to blame, and a
flake verdict (`BROKEN` / `FLAKY` / `HEALTHY` / `INSUFFICIENT`).

Expanded: a table of that test's causes with share, attribution, plain-English meaning, owner, and -
where `knowledge.yaml` has an entry - the suggested fix and the probe that proves it.

## When to reach for it

A specific test is failing and you want its history and its reasons, rather than the whole day.

## Reading the bar

The stacked bar is the quickest signal in the report. One wide band means a single fault to chase.
Four thin ones mean the test is simply exposed to everything, and fixing any one cause will barely
move its pass rate.

## Why a pass rate can look worse than the test is

The rate counts executions, not days. A test that ran thirty times during one bad afternoon and has
passed ever since still reads poorly for a while. Check the verdict column and the per-run grid
before concluding a test is broken - that is what the flake verdict is there for.
