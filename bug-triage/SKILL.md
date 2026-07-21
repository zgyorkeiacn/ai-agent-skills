---
name: bug-triage
description: 'Investigate a failing-test or error log against the current codebase, classify it as a CODING issue (implementation missing/incorrect) or a TEST issue (wrong/over-specified assertion or a mock/import that does not match the code), and give root cause + a precise fix. Auto-logs genuine CODING bugs to a portable coding-bug catalogue. Paste the error log; use "check" for read-only, "fix" to apply the fix, "catalog" to view/init the catalogue.'
argument-hint: 'Paste the error log; optional lead keyword: "check" | "fix" | "catalog"'
user-invocable: true
---

# bug-triage Skill (`/bug-triage`)

Investigate an inputted error log (a failing unit/integration test, a build error, a stack trace)
against the code in the current working repository, then decide whether the failure is a **CODING**
issue (the implementation is missing or incorrect) or a **TEST** issue (the test asserts the wrong
thing, is over-specified, or imports/mocks something that does not match the codebase). Report the
classification, the root cause, and a precise fix. Genuine CODING bugs are appended to a portable
coding-bug catalogue so the project accumulates a durable record of real defects found by triage.

This skill is codebase-agnostic: it works in any language or test framework, in single repos or
monorepos. The purpose of a run is always the same - **explain the failure and locate
responsibility (code vs test) with evidence**, not to blindly make the test pass.

---

## Mode detection

Inspect the argument. The bulk of the argument is normally the pasted error log; an optional leading
keyword selects the mode. If the argument is only a keyword with no log, ask the user to paste the
log (or give a path/test name).

| Argument | Mode |
|----------|------|
| an error log (no lead keyword) | **Mode 1** - Analyze + auto-log CODING findings (default) |
| `check` [+ log] | **Mode 2** - Analyze + report only, **no writes** |
| `fix` [+ log] | **Mode 3** - Analyze, apply the fix, then log if CODING |
| `catalog` | **Mode 4** - Locate / initialize the catalogue and report its path + entry count |

The error log may be pasted text, a path to a log file (read it), or a described failure. Whatever
the form, extract: the failing test name, the test file, the error type/message, the failing
assertion, and the file:line the stack points at on **both** sides (test-side and
code-under-test-side). If the referenced source is not available in the repo, still classify from
the log alone and state the reduced confidence explicitly.

---

## Mode 1: Analyze + auto-log (default)

The core method. Runs the full investigation, reports, and appends an entry to the catalogue **only
if** the verdict is CODING (see Mode 4 for catalogue location). Does **not** modify source or test
code - it proposes the fix; use `fix` to apply it.

### Step 1 - Parse the error log
Identify: failing test name, test file path, error type (assertion / TypeError / timeout / module
not found / render error / ...), the exact failing assertion or expression, and the file:line
references. Note both the test-side frame and the deepest code-under-test frame. In a monorepo,
resolve which package/app the source frame belongs to.

### Step 2 - Read the failing test and the specific assertion(s)
Open the test file and read the failing test plus its setup (fixtures, mocks, `beforeEach`). Read
the exact assertion(s) named in the log - do not guess. Note what the test imports and what it
mocks, and the shapes/signatures it assumes.

### Step 3 - Locate and read the code under test
Resolve the imports/paths the test exercises against the real repo and read the relevant
implementation. If the test mocks a collaborator, read the real collaborator to see if the mock's
path, exported names, signature (sync/async), and data shape match reality.

### Step 4 - Trace the mechanism
Explain precisely what value or behavior produced the observed error - walk the failing path from
input to the asserted output. When it is cheap and removes doubt, confirm empirically with a
throwaway repro script (see Rules: repros must be non-destructive). Reproducing the exact failure
(and that the proposed fix removes it) turns a plausible verdict into a confirmed one.

### Step 5 - Classify (CODING vs TEST)
Apply the rules in **## Classification**. State the verdict first, with a single-sentence
justification.

### Step 6 - Root cause and precise fix
Give the root cause, then the exact change:
- **CODING** -> the production file + the change to make. Never edit the test to hide a real defect.
- **TEST** -> the test file + the change (retarget the import/mock, fix the fixture, relax an
  over-specified matcher). Do **not** change production code or its error wording to satisfy an
  arbitrary assertion.
- **If TEST**, also note whether the test *contradicts* the spec/acceptance criteria it cites, or
  merely under/over-specifies them. If it cites an AC whose behavior genuinely is not implemented,
  say so - that part is a separate CODING gap.

### Step 7 - Catalogue (CODING only)
If the verdict is CODING, append an entry to the catalogue (locate/create per Mode 4). TEST verdicts
are **not** logged, except a genuinely instructive lessons-learned case - mark those clearly (see
## Catalogue). Report the catalogue path and the entry number added.

---

## Mode 2: Check (read-only)

Run Steps 1-6 exactly as Mode 1, but write nothing at all - no catalogue entry, no code changes.
Use this for a pure diagnosis. End by stating what *would* be logged (a CODING entry) or that
nothing would be logged (TEST).

---

## Mode 3: Fix (analyze, apply, log)

Run Steps 1-6, then apply the precise fix to the working tree:
- CODING -> edit the production file per Step 6.
- TEST -> edit the test file per Step 6.

Then, when feasible, verify by re-running the affected test or a targeted repro and report the
result. Finally, if the verdict was CODING, append the catalogue entry (Step 7) and record the fix
as applied. Follow the repo's conventions; make the smallest change that resolves the root cause.

---

## Mode 4: Catalogue (locate / initialize)

Locate or create the portable coding-bug catalogue and report its path and current entry count. Also
the shared subroutine used by Steps 7 of Modes 1/3.

### Locate order
1. An existing `bug-triage-coding-bugs.md` anywhere in the repo -> use it.
2. Else, a legacy `tdd-coding-bugs.md` in the repo -> use it (avoid fragmenting an existing log).
3. Else create the canonical file: `docs/bug-triage-coding-bugs.md` if a `docs/` directory exists at
   the repo root, otherwise `<repo-root>/bug-triage-coding-bugs.md`. Seed a new file from
   `templates/bug-catalogue.template.md` (bundled alongside this SKILL.md; resolve its path relative
   to this file).

### Reporting
Print the resolved catalogue path and the number of existing `## Entry N` sections. In Mode 4 make
no other change.

---

## Classification

### Definitions
- **CODING** - the implementation is missing or incorrect. Tells: a wrong result on valid,
  in-contract inputs; a missing export/function/module that has no counterpart anywhere; a genuine
  logic bug (for example a vacuous-truth `[].every(...)` returning `true` and awarding a "completed
  everything" state to a subject that has completed nothing). Fix the production code.
- **TEST** - the test asserts the wrong thing, is over-specified/brittle, or imports/mocks a
  module, path, exported name, signature, or data shape that does not match the codebase; or it uses
  a fixture that violates a data invariant the production code legitimately relies on. Fix the test.

### The over-specification (semantic-equivalence) rule
A failure whose ONLY discrepancy is semantically-equivalent wording - the error says "timed out"
but the matcher wants `/timeout/`, or an equivalent message/label differs by phrasing - is a **TEST**
issue: an over-specified/brittle assertion, not a CODING bug. Relax the matcher to be
tolerant/semantic. **Never change production error wording** just to satisfy an arbitrary assertion -
UNLESS the spec/AC mandates that exact string, in which case the wording is part of the contract.

### The invariant test (decisive heuristic)
Ask: *does the real codebase guarantee the precondition that makes the code correct?*
- If yes, and the code is correct given that precondition, then a fixture/mock that violates it is a
  **TEST** issue - fix the fixture to match reality (for example: a user record that always has
  `progress: {}` on creation; a test that omits it is malformed).
- If the code produces a wrong result on an input its own collaborators can **legitimately** produce
  (for example a loader that legitimately returns `[]` before init), then it is **CODING** - the
  code must handle that input.

### Heuristics catalogue
| Symptom in the log | Usual verdict | The tell |
|--------------------|---------------|----------|
| Imported symbol "is not a function" / undefined | CODING if the function genuinely does not exist anywhere; TEST if it exists under another name or module | Grep the codebase - renamed/relocated -> retarget the test; truly absent -> implement it |
| `Cannot find module '<x>'` in a `jest.mock`/import | TEST | The mock path/module name does not match the real dependency (e.g. `anthropic` vs `@anthropic-ai/sdk`) |
| `received value must be a promise` / `mockResolvedValue`/`.resolves` on a sync fn | TEST | The test models an async seam the code implements synchronously (or vice-versa) |
| Fixture is a flat map but code reads an envelope (`{ users: {...} }`) or vice-versa | TEST | Data-shape mismatch between fixture and the real persisted shape |
| `Cannot read properties of undefined` inside prod code, from a hand-built fixture | TEST if the fixture omits a field every real record has; CODING if the value legitimately can be undefined | Apply the invariant test |
| Wrong result with an empty collection (`[].every`/`.some`/reduce default) | CODING | Vacuous truth / missing empty-case guard on an in-contract empty input |
| Assertion sees `""`/stale value; timing-sensitive fake (events emitted before listeners attach) | TEST | Eager vs lazy fake construction / microtask race in the harness, not a product bug (real streams buffer) |
| `argument handler must be a function` / module-not-found for an assumed router | TEST | Test assumes an architecture/module that does not exist (e.g. a separate router when the route is inline); retarget, or optionally refactor if the team wants that structure |
| Frontend "older version of React" / multiple copies | TEST/tooling | Harness resolves duplicate React copies; environment/config, not product code |

Use the table as a starting point, not a lookup - always confirm against the actual code in Steps
2-4 before deciding.

### Output format
1. **Classification** first: `CODING` or `TEST`, plus a one-sentence justification.
2. **Root cause** - the mechanism, tied to specific file:line references.
3. **Precise fix** - the file and the exact change (production-only for CODING, test-only for TEST).
4. **If TEST** - whether it contradicts, or merely under/over-specifies, the spec/AC it cites.
Keep it terse and evidence-based.

---

## Catalogue

A single Markdown file that accumulates **CODING** classifications found by triage, so a project
keeps a durable, reviewable record of real defects. Located/created per **Mode 4**.

### What gets logged
- **CODING** verdicts: always (in Modes 1 and 3).
- **TEST** verdicts: excluded, EXCEPT a genuinely instructive lessons-learned case (a subtle
  harness/over-specification trap worth remembering). Mark those `**Classification:** TEST (lessons
  learned)` so they are visibly distinct from real defects.

### Entry format
Read the catalogue first to get the next `## Entry N` number and to avoid duplicating an entry for
the same test+error. **Append**, never rewrite the file. Convert relative dates to absolute
(`YYYY-MM-DD`). If the log starts to span multiple modules/areas, keep the H1 title general. Each
entry follows `templates/catalogue-entry.template.md`:

```markdown
## Entry N

**Date:** YYYY-MM-DD
**Test:** <describe/quote the failing test>
**Test file:** <path>
**Error:** <the error type + key message>

**Classification:** CODING

**Root cause:** <what was missing/incorrect and why>

**Fix applied:** <file + the change> (or **Fix proposed:** in check/analyze-only runs)
```

---

## Rules

- **No writes in `check` mode**: Mode 2 is strictly read-only - no catalogue entry, no code edits.
- **Classify before fixing**: state CODING/TEST with justification before proposing or applying any
  change. The goal is correct attribution, not merely a green test.
- **Never change production error wording** to satisfy an over-specified matcher; relax the matcher
  instead, unless the spec/AC mandates the exact string.
- **Do not fabricate production code to satisfy a test** that assumes a non-existent module/function -
  only implement when the functionality is genuinely missing (a true CODING gap).
- **Repros are non-destructive**: when verifying empirically, use a scratch/temp location; if a
  script touches a real data file, back it up first and restore it byte-for-byte afterward.
- **Catalogue is CODING-only and append-only**: log real defects (plus clearly-flagged
  lessons-learned); read it before appending; never rewrite existing entries.
- **Terse output**: report classification, root cause, fix, and the catalogue path/entry - no
  narration.
