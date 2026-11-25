# Gap analysis and enhancement opportunities

The same rules as the Defect Analyzer app (`src/core/gaps.ts`). Use them in both modes, after the per-bug analysis.

## Input

Run `python scripts/defect_tool.py gap-input ...`. It writes `gap-input.json`, which contains:
- **facts:** counted exactly by the script. Use these numbers as they are. Never recount or estimate.
- **items:** one entry per bug with everything relevant to how it escaped.

The facts differ by mode:
- **ADO mode** includes production escapes, ST Miss = Yes, bugs first raised against another team, median days to close, root cause, bucket, layer, environment, test phase and the most affected services.
- **Excel mode** includes production escapes, bugs first raised against another team (Area Path differs from Corrected Area Path), root cause, Sub-RCA, bucket, layer, environment, PI and owning teams. ST Miss and days to close are not available from the DefectTracker.

## Output

Write `gaps.json`:

```json
{
  "summary": "...",
  "gaps": [{ "ref": "G1", "category": "Process", "title": "...", "detail": "...", "evidence": ["4696354", "4560176"], "impact": "..." }],
  "actions": [{ "ref": "A1", "priority": "High", "title": "...", "detail": "...", "addresses": ["G1"], "owner": "Delivery lead", "effort": "S", "measure": "..." }]
}
```

Then run `defect_tool.py gap-report`. It does the following:
- drops gaps whose evidence is not from this run;
- drops unknown categories;
- renumbers the refs;
- flags any gap that has no action.

## Rules

Look for **patterns across bugs**, not restatements of single bugs.

Each gap's **category** must be exactly one of these:
- `Process`: how work flows between people and teams. This covers requirement and acceptance-criteria clarity, design handover and Figma changes, defect triage and routing to the right team, ownership, release and environment coordination, deployment verification, and communication between teams.
- `Testing`: how testing is done. This covers missing kinds of testing (unit, contract, integration, negative and error-path, accessibility, analytics, cross-microsite), test data, environment parity with production, regression packs and automation, and story-level testing before SIT. Bugs recorded as "ST Miss = Yes" should have been caught at story level.
- `Coverage`: what is not tested. This covers specific journeys, customer segments (for example MBB, business, sole trader), product types, boundary values, services, devices and breakpoints, and data that only exists in production.

Testing is about **how**; coverage is about **what**. Never file the same weakness under two categories.

For every gap:
- **ref:** `G1`, `G2`, ... in order of importance.
- **title:** a short noun phrase.
- **detail:** 2 to 3 sentences describing the pattern and its cause.
- **evidence:** the IDs of the bugs that show it. Prefer patterns seen in two or more bugs. A single bug only justifies a gap when it reached production or its impact was severe.
- **impact:** one sentence on what it costs: production escapes, rework, delay or customer impact.

**Enhancement opportunities** are the improvement actions. Every gap needs at least one. For every action:
- **ref:** `A1`, `A2`, ... in priority order.
- **priority:** `High` (prevents production escapes, or the problem recurs often), `Medium` or `Low`.
- **title:** an imperative, specific action. For example, "Add contract tests between dal-jcs-care-plandetails and the product catalogue", never "improve testing".
- **detail:** 1 to 2 sentences on what to do and how.
- **addresses:** the gap refs it closes.
- **owner:** the role best placed to own it, for example "Development team", "SIT team", "Product owner", "Test automation", "Release management" or "Delivery lead".
- **effort:** `S` (days), `M` (a sprint) or `L` (more than a sprint).
- **measure:** how success would be seen, ideally as a number. For example, "no production escapes from catalogue changes over the next PI".

**summary:** 3 to 5 sentences for a delivery lead, covering the overall picture, the most important gaps and the first actions to take.

Writing rules:
- Ground every statement in the bugs given.
- British English and plain sentences.
- No bullet points inside values, and no en or em dashes.
- Quote bug IDs only in `evidence`, not in the text.
