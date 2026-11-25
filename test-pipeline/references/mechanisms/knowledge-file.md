# The knowledge file

`<pipelineDir>/knowledge.yaml` is where a team records what it has actually established about its
own failures. It starts empty and grows.

## Why it exists

The reports can always describe a failure from its signature grammar - "a 503 from this endpoint",
"a value came back wrong". That is correct, and it is shallow. What a reader actually needs is the
thing somebody learned the third time they investigated it: that this endpoint is down every night
for maintenance, that this 400 is a fixture whose reference data expired, that this timeout is a
downstream batch job and not the application at all.

That knowledge has nowhere to live otherwise. It ends up in one person's head, or in a Teams thread,
and the next person re-derives it from scratch.

**A curated entry always beats a heuristic.** The heuristics in `lib/classify.mjs` are priors and
are wrong often enough to say so out loud. An entry here is a finding.

## Schema

```yaml
signatures:
  "HTTP_503 api/auth/getToken":
    owner: ENVIRONMENT          # ENVIRONMENT | TEST | UNKNOWN
    title: Auth service unavailable out of hours
    what: >
      The identity service is taken down nightly between 20:00 and 21:00, so any run in that
      window fails at the first call and every test fails with it.
    fix: Exclude the maintenance hour via analysis.excludeHours rather than retrying.
    probe: tools/auth-probe.spec.ts
```

| Field | Required | Purpose |
|---|---|---|
| key | yes | The **normalised** signature, exactly. Copy it from a report, not from a raw log. |
| `owner` | yes | Overrides the classifier. `UNKNOWN` is allowed and means "investigated, still unclear". |
| `title` | no | Short plain-English name. Used as the heading in the one-pager. |
| `what` | no | Two or three sentences. Written for someone who will not read a stack trace. |
| `fix` | no | The action that resolves it, or the decision taken. |
| `probe` | no | A path to re-runnable evidence. This is what turns a claim into a finding. |

## The probe field is the important one

An entry with a probe can be re-verified by anyone. An entry without one is an assertion that
decays quietly: the environment changes, the claim stops being true, and nothing signals it. Where
there is a script, a query, a dashboard or a saved log that demonstrates the cause, name it.

## Rules

1. **Key on the normalised signature.** With `analysis.normaliseSignatures` on, volatile ids are
   masked - the key must include the `<n>` / `<uuid>` / `<timestamp>` placeholders as the report
   shows them, or it will never match.
2. **Record what was established, not what was suspected.** If it is a hypothesis, say so in
   `what`. The file is worth more than the heuristics precisely because it contains findings.
3. **Prune it.** An entry that has stopped being true is worse than no entry, because it is
   believed. Revisit entries whose signature has not appeared in a long time.
4. **Commit it.** It is team knowledge, not local state.

## How entries get created

`/test-pipeline analyse` drafts one for any recurring failure with no existing entry, shows it, and
appends **only on confirmation**. Never written silently: a file full of the agent's guesses loses
the exact property that makes it authoritative.

## Parser note

The scaffolded pipeline reads this with a deliberately minimal parser (`reports/_history.mjs`), not
a YAML library, so the generated pipeline has no install-time dependencies. It supports exactly the
shape above: two levels of indentation, `key: value`, and quoted keys. Anchors, flow mappings and
multi-document files are not supported. Keep to the shape in the example.
