# Failure analysis method

The method behind `/test-pipeline analyse`. Read-only except for a proposed `knowledge.yaml` entry,
and only after the user confirms.

Under Copilot, do ONE signature per turn and stop.

---

## Step 1 - load

1. Read `pipeline.config.json`.
2. Run `node <pipelineDir>/reports/_history.mjs`-backed helpers, or read
   `<runsDir>/history.jsonl` directly and apply `normaliseSignature` from `lib/normalise.mjs`.
3. Read `<pipelineDir>/knowledge.yaml` if it exists.

**Do not skip normalisation.** Without it the same fault appears once per run and the ranking in
step 2 is meaningless.

**STOP** if there are no runs. Say so; do not speculate about a pipeline that has not run.

---

## Step 2 - rank

1. Count each normalised signature by **distinct test files affected**, then by occurrences.
2. Sort descending.
3. Report the top N (default 5) with counts, and state how much of the total they represent.

One cause dominating is the single most useful thing to say first. If one signature is 60% of all
failures, that is the headline and everything else is detail.

---

## Step 3 - per signature

Work through the ranked list, one per turn. For each, establish four things in this order.

### 3a. Owner - environment or suite?

1. Check `knowledge.yaml` first. A curated entry **always wins** over any heuristic, and carries its
   probe. Say the owner was established by investigation, and name the probe.
2. Otherwise apply `buildClassifier` from `lib/classify.mjs`.
3. Report the classifier's own rationale alongside the verdict, not just the verdict.

State the confidence honestly. `UNKNOWN` is a valid and useful answer - it means "this needs a human
to look", which is information. Inventing a plausible owner sends someone to the wrong team, and
they come back a day later having proved nothing.

### 3b. Age - new, recurring, or flaky?

1. `daysSeen(signature)` gives the distinct days it has appeared on.
2. `classifyFlakes` from `lib/flake.mjs` gives per-test `BROKEN` / `FLAKY` / `HEALTHY`.
3. Say which, and why it matters:
   - **New** - appeared today. Correlate with anything that changed.
   - **Recurring** - present for days. Not an incident; something structural.
   - **Flaky** - oscillates. Often the most expensive, because it trains people to re-run rather
     than read, and real regressions then hide inside noise everyone has learned to ignore.

### 3c. Spread - one environment or all?

Only when more than one environment ran. Apply `compareAll` from `lib/cross-env.mjs` and read the
bucket it lands in:

| Bucket | Means | Say |
|---|---|---|
| `product` | failed everywhere it ran, same cause | the product or a shared dependency |
| `divergent` | failed on several, **different** causes | several faults sharing a test - do not merge |
| `perEnv` | failed on one only | that environment's data or configuration |
| `coverageGaps` | did not run everywhere | a gap, not a result |

The `divergent` case is the one worth being careful about. Reporting it as "fails everywhere,
therefore platform-wide" sends somebody hunting a single root cause that does not exist.

### 3d. Suggested next action

Be specific and be honest about what the data can and cannot settle.

Good:
- "Every occurrence is inside one hour. Check what runs on that schedule before treating it as a
  code fault."
- "Failing on `int1` only, while `qc2` passes the same test. Compare the two environments' data for
  this scenario rather than reading the application code."
- "Three distinct causes on one test. Fix them separately; the pass rate will not move until the
  dominant one is gone."

Avoid:
- "Investigate the root cause." - says nothing.
- A confident cause when the evidence supports two. Name both and say what would distinguish them.

---

## Step 4 - propose a knowledge entry

Only for a failure that is **recurring** (seen on more than one day) and has **no** existing entry.

1. Draft the entry in the schema from [knowledge-file.md](knowledge-file.md).
2. Show it to the user.
3. Append only on confirmation. Never write silently - the file is the team's record of what they
   have actually established, and filling it with the agent's guesses destroys the one property
   that makes it worth more than the heuristics.

---

## Output shape

Per signature:

```
<signature>
  Impact   : N tests, M occurrences, X% of all failures
  Owner    : ENVIRONMENT | TEST | UNKNOWN  (how it was established)
  Age      : new | recurring since <date> | flaky (<evidence>)
  Spread   : product | one environment (<name>) | divergent causes
  Suggest  : <specific next action>
```

Then one closing paragraph: what to do first, and what to ignore for now. A list of ten equally
weighted problems is not actionable; ranking them is the value being added.
