---
name: bdd-authoring-single
description: 'Single-file, stack-agnostic BDD test authoring pipeline - fetch/parse Azure DevOps story acceptance criteria (or paste them in), analyze any repo, plan journeys, compose Gherkin scenarios + step definitions, and report AC traceability. No local codebase or external CLI required; compatible with GitHub Copilot.'
argument-hint: '"story <url>" | "analyze" | "plan" | "bdd" | "steps" | "coverage" | "generate" | "guided"'
user-invocable: true
---

Single-file edition of the `bdd-authoring` skill: the lean core plus every reference
(mechanisms, framework templates, report template) inlined into one document for easy
portability and Copilot embedding. Behavior is identical to the multi-file version. The agent
reads this document and uses native tools (Read, Grep, Glob, Write, Bash/PowerShell).

The core is stack-neutral. Framework-specific code blocks and heavyweight mechanisms are
clearly sectioned; use only the block matching the detected stack.

---

## Operating Rules

Apply to every mode, in any agent (Claude Code, Copilot, Cursor).

1. **No filler.** Start with the answer or artifact. Prefer tables over prose. Use a regular
   hyphen (`-`); never the em-dash.
2. **Surgical output.** Edit as unified diffs. Never rewrite unchanged functions or whole
   files. No decorative comments or JSDoc in generated code.
3. **Orient before scanning.** Read `AGENT_CONTEXT.md` (repo root) and any
   `docs/CODEBASE_INDEX.md` if present. Use the step catalog before grepping blindly.
4. **Scope restraint.** Touch only referenced paths / active tabs. Treat lockfiles,
   auto-generated API clients, and massive mock JSON as empty.
5. **Bounded autonomy.** Max 3 execution loops. Do not fix test/build failures in a loop -
   show the first failure output and stop. Reject vague prompts; require a concrete target. Do
   not scrape the web.
6. **Verify.** Mental syntax check before emitting code. Output the exact validate command
   (per detected stack) as the last line after any code generation.
7. **Secret hygiene.** Never commit secrets/tokens/passwords in plaintext. Passwords are
   encrypted at rest (AES-256-GCM; key derived per request from a passphrase via Argon2id +
   random salt; passphrase never stored). Hashing is one-way and irreversible. Other secrets
   go in env vars or a secrets manager; commit only `.env.example` placeholders. In features
   and steps use test-data **aliases** and auth-level notes, never real credentials/tokens.
   Test-user credentials are exempt unless the account is administrator-or-higher.

---

## Configuration

Resolved on first use; ask only if not discoverable.

| Item | Default / source |
|---|---|
| `<TeamTag>` | `@AutomationTeam_Test`; if the repo already uses a team tag, match its exact casing |
| `<StoryNumber>` | ADO work item ID for `@US_<n>` tags (or `US0` placeholder) |
| `<slug>` | domain slug inferred from the story title + repo folder names (kebab-case) |
| `AZURE_DEVOPS_PAT` | env var; required only for `story`/`generate` fetch. Absent -> paste-in fallback |
| `<branchName>` | `feature/<slug>-bdd`; auto-created/switched in the target repo before the first write (`--no-branch` to skip). See [Auto-branch](#auto-branch-before-any-write) |
| operator identity | `<OperatorName>` / `<ExperienceLevel>` (`junior|medior|senior`) / `<Area>`, from flags `--operator-name`/`--experience`/`--area`, else `~/.claude/bdd-authoring-operator.json`, else ask once + save. See [Work Log](#work-log-automatic) |
| work-log baseline | estimation constants in [Work log model](#work-log-model--template) (tunable). `--no-work-log` disables logging |

**Output convention** (all modes):
- Reports + bundle -> `./docs/<slug>/` (story-context.md, journeys.md, test-generation.md)
- Feature files -> repo `featuresDir` if detected, else `./docs/<slug>/features/`
- Step defs -> repo `stepDefsDir` if detected, else `./docs/<slug>/steps/`
- Work log -> `./docs/<slug>/work-log-<run-id>.md` (human) + `./docs/work-log/<run-id>_<slug>.{csv,json}` (PowerBI); unique per run; see [Work Log](#work-log-automatic)

---

## Mode Dispatch

| Argument starts with | Mode |
|---|---|
| `story ` (+ URL) | [story](#mode-story) |
| `analyze` / `baseline` | [analyze](#mode-analyze) |
| `plan` | [plan](#mode-plan) |
| `bdd` | [bdd](#mode-bdd) |
| `steps` | [steps](#mode-steps) |
| `coverage` | [coverage](#mode-coverage) |
| `generate` | [generate](#mode-generate) |
| `log` / `worklog` | [log](#mode-log) |
| none / unrecognized | [guided](#mode-guided) |

---

## Clarify Gate (blocking, before any write)

Before writing feature files or step defs, ALWAYS confirm with the user:
1. Extend an existing feature file (which one?) or create a new file?
2. Show the candidate existing feature files and reusable step definitions found during
   `analyze` (by domain match), so the user chooses knowingly.

Do not proceed until the user confirms. Skip only when the user has pre-stated the target
file, or when running headless `generate` with an explicit `--yes` flag.

---

## Auto-branch (before any write)

Automatically, before the **first file write** of any mode (`plan`/`bdd`/`steps`/`coverage`/
`generate`, and report writes), isolate the work on a feature branch in the **target repo**
(`--repoPath`, else cwd). No prompt. This only isolates the work - it does NOT commit or push
(committing stays a separate explicit action).

Branch name: `feature/<slug>-bdd` (`<slug>` from [Configuration](#configuration)). Run in the
target repo root (git command syntax is identical in PowerShell and Bash):

```
git rev-parse --is-inside-work-tree            # errors -> not a git repo -> SKIP (note it), keep writing
# BR=feature/<slug>-bdd ; current=$(git rev-parse --abbrev-ref HEAD)
#   current == BR                                 -> no-op
#   git show-ref --verify --quiet refs/heads/BR   -> git checkout BR
#   else                                          -> git checkout -b BR
```

Guards: not a git repo -> skip silently (the skill supports no-repo runs); already on the branch
-> no-op; branch exists -> `checkout`; else create. Uncommitted changes carry into the new branch
(git default) - do not stash. Detached HEAD is fine (`checkout -b` branches from it). Opt-out:
`--no-branch`.

---

## Work Log (automatic)

Every mode records who ran it, what it did, how long the tool took, and an estimated
engineer-time equivalent (junior/medior/senior) grounded in published authoring baselines.
Always on; opt out with `--no-work-log`.

- **Operator identity**: before the first work-log write, resolve `<OperatorName>` /
  `<ExperienceLevel>` (`junior|medior|senior`) / `<Area>` - flags first, else
  `~/.claude/bdd-authoring-operator.json`, else ask the user once, validate, and save that file.
  Skip this when `--no-work-log`. These stamp the log header and the CSV/JSON dimensions.
- Capture a **run-id** timestamp once at the start of the run and one start/end pair per stage.
- As each stage finishes, record a stage entry (units produced, per-artifact complexity tier,
  one-line "work achieved", tool seconds). Classify each scenario/step-def Simple/Moderate/
  Complex at composition time; `analyze` also records a repo-complexity factor.
- A single-mode run writes its own log; `generate` writes ONE consolidated multi-stage log.
- Write three files per run (unique per run - never overwrite): the human
  `./docs/<slug>/work-log-<run-id>.md`, plus PowerBI-consumable
  `./docs/work-log/<run-id>_<slug>.csv` and `.json` (one central folder for folder-combine).

See [Work log model](#work-log-model--template) for the operator-config snippet, the timing
snippets, the tunable estimation constants, the formula, the `.md` template, and the CSV/JSON
schema.

---

## Mode: story

Fetch an ADO work item graph and extract acceptance criteria. If `AZURE_DEVOPS_PAT` is unset
or the user has no ADO access, use the **paste-in fallback** (below); then run AC parsing.

### 1. Parse the URL
Extract `org`, `project`, `storyId` from:
- `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}`
- `.../_workitems/edit/{id}?workitem={id}`
- saved query: `.../_queries/query/{queryId}`

### 2. Fetch the work item
`$expand=relations` is mandatory (without it child links are absent). A 3xx redirect means
auth failure - print a descriptive error and stop.

**PowerShell:**
```powershell
$pat = $env:AZURE_DEVOPS_PAT
$enc = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat"))
$headers = @{ Authorization = "Basic $enc"; "Content-Type" = "application/json" }
$url = "https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}?`$expand=relations&api-version=7.1"
Invoke-RestMethod -Uri $url -Headers $headers -Method Get | ConvertTo-Json -Depth 10
```

**Bash:**
```bash
curl -s -u ":$AZURE_DEVOPS_PAT" \
  "https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}?\$expand=relations&api-version=7.1" \
  -H "Content-Type: application/json"
```

### 3. Extract fields
- `fields["System.Title"]` - title
- `fields["System.Description"]` - description (HTML-stripped)
- `fields["Microsoft.VSTS.Common.AcceptanceCriteria"]`; fallback `fields["Custom.AcceptanceCriteria"]`
- child IDs: `relations[]` where `rel.rel` includes `Hierarchy-Forward` or `attributes.name == "Child"`; id = `url.split('/').pop()`

### 4. Parse acceptance criteria (from the raw AC HTML)
1. Remove content in `<s>`, `<strike>`, `<del>` (strikethrough = withdrawn).
2. Replace block tags (`<p><div><br><li><tr><h1>-<h6>`) with newlines.
3. Strip remaining HTML tags.
4. Decode entities (`&nbsp;`->space, `&amp;`->`&`, `&lt;`->`<`, `&gt;`->`>`).
5. Split on newlines; trim; drop blanks.
6. Drop section-label lines matching `^[A-Za-z][A-Za-z\s-]*-Level\s+\S[^\n]*:\s*$`.
7. Group by AC header (case-insensitive):
   `^(?:AC|Acceptance\s+Criteria|Scenario)\s*#?\s*(\d+)\s*[:\-)]\s*(.*)$` - one header = one AC;
   following non-header lines join into it.
8. Fallback: group by `^Given\b` lines. Final fallback: one line = one AC.
9. Assign IDs `<storyId>-ac-<1-based-index>`.

### 5. BFS child traversal (when depth > 1)
For each child ID: fetch with the same call; skip 404/401 (TF401232) with a warning; use a
visited set; repeat to `storyDepth` levels (default 1).

### 6. Write
`./docs/<slug>/story-context.md` (title, ID, description excerpt, numbered ACs, child titles).

### Paste-in fallback
Ask the user for:
```
Story number:            US_<n>            (or US0 placeholder)
Feature description:     <1-2 lines>
Acceptance Criteria:     <numbered list, one AC per line/block>
Team tag:                @<TeamTag>         (default @AutomationTeam_Test)
AC test-data matrix:     (optional)
  | AC  | Needs data | alias/key      | auth level |
  |-----|------------|----------------|------------|
  | AC1 | Yes/No     | <ALIAS>        | L2/L3      |
```
Then run AC parsing step 4 on the pasted list and assign the same `<storyId>-ac-<n>` IDs.

Record a [Work Log](#work-log-automatic) stage entry: AC count extracted + child stories.

---

## Mode: analyze

Baseline scan of the target repo (`--repoPath`, default cwd). If absent, emit a "no-repo"
baseline (`exists=false`) - `story`/`plan`/`bdd` still work from raw ACs; only `steps`
code-gen needs a repo.

1. **Framework signals** (root files -> ecosystem): `package.json` -> JS/TS; `pom.xml` /
   `build.gradle(.kts)` -> JVM; `*.csproj` / `*.sln` -> .NET; `go.mod` -> Go;
   `requirements.txt` / `pyproject.toml` -> Python; `Cargo.toml` -> Rust.
2. **Primary language** by source-file count; preserve secondary languages.
3. **Composition pattern**: playwright-bdd (`createBdd()`), karate (`karate-config.js` +
   `io.karatelabs`/`com.intuit.karate`; `.feature` files ARE the tests, no step-def classes),
   cucumber-step-defs
   (`@Given/@When/@Then` or equivalents), page-object-model (pages/ dir), call-chain
   (`.feature` calling shared flows), mixed, or unknown.
4. **Structure map** (repo-relative paths): journeys/orchestrators, reusable API steps,
   assertions, request payloads, test data/fixtures, helpers, config.
5. **Monorepo + API surface** (optional): when sibling service and test subtrees exist,
   extract the in-house API surface (Spring/Express/FastAPI/ASP.NET route annotations),
   union+dedupe by `METHOD path`. Reconcile orphans (see below).
6. **Convention inference**: sample 3-5 feature files for naming case, tag pattern, step
   numbering, auth-header pattern, and inline-assertion style (outline/quoted/numeric/table).
7. **Step catalog**: grep every step-def file for registrations; record pattern text, file,
   line, framework, action label, HTTP signature, tokens, and payload descriptors. Build
   indexes: `byApi`, `byResponseObject`, `byActionVerb`, `byNoun` (schema below).
8. **Emit + cache**: write `./docs/<slug>/baseline.md` and the step catalog; cache to
   `.agent-cache/baseline-<sha256-of-repoPath>.json` (7-day TTL; `--refresh-baseline` forces
   rescan). On later runs, if the catalog is missing, do a lightweight catalog-only scan
   (step 7) before `bdd`/`steps`.
9. **Framework convention sync** (`--no-framework-sync` to skip): derive the repo's learned
   practices for the detected framework and reconcile them into the matching
   [Framework patterns](#framework-patterns) block - see below.

### Orphan reconciliation (monorepo only, deterministic, no LLM)
After the API-surface union, an endpoint the TESTS call but the SERVICE surface does not
declare is an "orphan". Do NOT report it as dead until reconciled. First **canonicalize** both
sides: replace path params and numeric/hex/mixed-id segments with `{id}`; keep version
segments (`v1`, `v2`) literal. Then classify in precedence:

| Class | Test | Action |
|---|---|---|
| scan-gap | the path's most specific literal segment appears in the SERVICE source | treat as DECLARED; record `file:line`. Grep the SERVICE subtree ONLY (grepping tests matches the very test that reached it -> false scan-gap). |
| renamed | not in source, but a declared endpoint of the SAME method is a close segment match (>= 0.6 similarity) | superseded path / stale wording. Record `closestDeclared` + similarity. |
| dead | no source hit and no close declared match | stale test / other service. |

**Feedback loop (primary accuracy win):** fold every scan-gap path back into the API surface
(and `byApi`) BEFORE emitting the baseline, so downstream modes bind against the real route set
instead of re-flagging it.

### Step database schema
```json
{
  "entries": [{
    "id": "sha256-hash", "pattern": "the customer sends a {string} request to {string}",
    "file": "test/steps/basket.steps.ts", "line": 42, "framework": "playwright-bdd",
    "actionLabel": "HTTP POST with payload", "httpSignature": "POST /api/basket/add",
    "tokens": ["customer","sends","request","basket"],
    "payloads": [{"source":"fixture","path":"test/fixtures/add-item.json",
      "shape":{"productId":"string","quantity":"number"},"requiredFields":["productId","quantity"]}]
  }],
  "indexes": {
    "byApi": {"POST /api/basket/add": ["entry-id-1"]},
    "byResponseObject": {"basket": ["entry-id-1"]},
    "byActionVerb": {"create": ["entry-id-1"]},
    "byNoun": {"basket": ["entry-id-1"]}
  }
}
```
`source` is one of fixture|inline|factory|datatable|none. `shape` uses dot notation for nested
keys and `[]` for arrays. Preserve `requiredFields` when reusing a payload.

### Framework convention sync (step 9; `--no-framework-sync` to skip)
Turn the practices observed in the repo into **suggested edits** to the matching
[Framework patterns](#framework-patterns) block, so the next `bdd`/`steps` run starts from
repo-accurate guidance. Proposals surface automatically; **apply only what the user confirms**
(these blocks are shared, checked-in skill assets reused across every repo).

1. **Extract** the repo's *practice* (not literal code) per axis, skipping any with no clear
   signal: assertion style (AssertJ/Hamcrest/JUnit/`expect().toBe`), method naming, step
   signature/registration, scenario-state sharing (context bean/DI/`ThreadLocal`/fixture), base
   class or shared util, HTTP-client idiom, import ordering, tag casing, test-data aliasing.
2. **Reconcile** each against the current Framework patterns block:

   | Class | Condition | Proposed edit |
   |---|---|---|
   | absent | not covered by the block | ADD a bullet/line |
   | existing-better | block's guidance is stronger/more general | KEEP - propose nothing |
   | new-better | repo's practice is clearly stronger/more current | REPLACE (diff + rationale) |
   | merge | both carry value | MERGED version (diff + rationale) |
3. **Generalization guard (mandatory):** the block is reused on OTHER repos - strip repo-specific
   class names / package paths (phrase as a pattern); frame stack variants additively ("repo uses
   AssertJ; block shows Hamcrest - offer both") rather than hard-replacing a valid default;
   `existing-better` wins ties (replace only when *universally* better for the stack).
4. **Output** a `framework-convention-sync` report row per non-`existing-better` axis
   (`axis | class | rationale | diff`); apply only approved diffs to the Framework patterns block.

Record a [Work Log](#work-log-automatic) stage entry: detected stack, step-catalog size, and the
repo-complexity factor (sizeFactor x techFactor x monorepoFactor) from these signals.

---

## Step matching + consolidation

Used by `bdd` (rule 9) and `steps` (rule 5) to decide whether a candidate step already exists
before inventing one, and how to collapse variants. `{string}/{int}/{float}/{word}` map to
whatever the target runner uses (Cucumber expressions, regex groups, SpecFlow params, behave
format fields).

### Normalization
1. Strip the leading keyword (`Given|When|Then|And|But`).
2. Replace every parameter placeholder with `__PARAM__`.
3. Lowercase.
4. Expand synonyms (table) to the canonical token.
5. Remove stop words (`a an the is are was were be been being have has had do does did will
   would shall should may might must can could of in on at to for with by from`).
6. Tokenize -> a sorted set of content tokens.

### Synonym table (canonical <- synonyms)
| Canonical | Synonyms |
|---|---|
| visible | rendered, loaded, displayed, shown, open, present |
| hidden | absent, closed, gone |
| click | tap, press, select (UI action) |
| navigate | go to, visit, open (URL) |
| verify | check, assert, confirm, validate |
| create | add, insert, register, submit |
| delete | remove |
| clear | reset |
| update | edit, modify, change |
| get | fetch, retrieve, read, query |
| redirect | forward, route |
| shows | displays, reads, contains (text assertion) |

### Scoring (0-100) and thresholds
```
A. EXACT   normalized candidate tokens == entry tokens            -> 100 (stop)
B. PATTERN entry.pattern (with __PARAM__ wildcards) regex-matches the raw candidate -> 90 (stop)
C. JACCARD (|cand ∩ entry| / |cand ∪ entry|) * 70
D. INDEX BONUS (added to C when < 90): +15 byApi signature, +10 byActionVerb, +8 byNoun
FINAL = min(A|B|C+D, 100)
```
| Score | Decision |
|---|---|
| >= 90 | Strong match - REUSE verbatim (mandatory). Wording differences do not justify a new step. |
| 70-89 | Candidate - show the existing pattern, ask reuse-or-create. |
| 50-69 | Weak - informational; create a new step. |
| < 50 | No match - create a new step. |

When several entries score >= 70, rank by score desc; break ties toward the lower line number;
present at most the top 3.

### Consolidation catalog (P1-P16): emit ONE parameterized step, never a file per variant
Use a regex/branching step when polarity or optional clauses apply.
- **P1** numeric-suffix exact duplicates -> one step.
- **P2** keyword-only collisions (Given vs When of the same phrase) -> register once.
- **P3** polarity (X / no X / not X / equals / contains) -> capture the verb and branch.
- **P4** numeric literal in the phrase (30, all 17, 1st, 0%) -> `{int}`.
- **P5** datatype adjective (`a boolean/integer/string field {name}`) -> `a(n) {word} field {string}`, branch on the type token.
- **P6** thing-noun variants (object/entry, box/object) -> `{word}`.
- **P7** enum/style/tier/ordinal baked in the phrase -> value param / `{word}`.
- **P8** property name baked in the phrase -> `{string}`.
- **P9** count/quantifier (exactly/at least/at most/only/all N) -> comparator `{word}` + `{int}`.
- **P10** value present/absent -> `(contains|does not contain) {string}` (substring on the serialized body).
- **P11** stub a service to return status/network/delay -> endpoint + `{word}` kind.
- **P12** no-client-error family (runtime/JS/console/crash) -> one absence step + one collected-errors step.
- **P13** attribute-accretion fixtures -> one `Given('... exists with:', DataTable)`.
- **P14** optional trailing clause -> optional regex group.
- **P15** verb synonyms (renders/is loaded/is visible) -> one canonical verb.
- **P16** `a`/`an` grammar split -> `an?`.

### Shared step library (bdd + e2e = ONE vocabulary)
Emit exactly one step-def per canonical step into a style-agnostic step dir (no `bdd/`|`e2e/`
segment); both bdd and e2e feature files bind by step text. Never emit a per-style twin - a
single step world loads once, so the same pattern under two folders is an ambiguous/duplicate
definition error. Compose BDD first, then compose E2E by REUSING the BDD phrasings (an E2E
scenario is a broader multi-page/multi-API journey assembled from shared steps, not a re-worded
per-API twin).

### Payload reuse
When a new HTTP step matches an existing `byApi` entry, start from that entry's payload
descriptor: reuse the same fixture/factory, preserve its `requiredFields`, make the rest
optional, and parameterize only the fields that vary across scenarios.

---

## Mode: plan

Group the story's ACs into end-to-end journeys. Prerequisite: `story` (or ACs in context);
run `analyze` first if a target repo exists.

1. **Build the prompt**: epic id/title + description (clip to 4000 chars) + each work item's
   id/title/ACs. Omit stories with zero ACs.
2. **Compose journeys** (you act as the analyst). A journey is a coherent customer flow from a
   trigger to a measurable outcome, with 2+ ordered steps. Infra/analytics/dependency-only
   stories are not journeys. Output JSON only:
   ```json
   {"journeys":[{"id":"kebab-id","name":"...","description":"...",
     "primaryActor":"Customer|Internal user|System",
     "steps":[{"order":1,"description":"...","relatedStoryIds":["..."],
       "acceptanceCriteriaIds":["..."]}]}],
    "unmappedAcceptanceCriteriaIds":["..."]}
   ```
   Rules: cite only AC IDs present in the input (never invent); each AC in at most one journey;
   cross-cutting ACs go to `unmapped`; aim for 3-12 narrow journeys; 2+ steps each; order by
   customer flow, not creation order.
3. **Validate**: drop unknown AC IDs, drop duplicate AC claims, drop journeys with < 2 steps,
   route unassigned ACs to `unmapped`. If JSON fails to parse, retry once demanding a single
   valid JSON object.
4. **Target folder** (generic, no hard-coded domain vocabulary): tokenize the journey name +
   description; score candidate subfolders under the detected journeys/features dir by token
   overlap with each folder's existing feature tags and names; pick the highest score. If none
   scores > 0, ask the user to confirm the target folder.
5. **Write**: `./docs/<slug>/journeys.md` (+ `.json`), a per-AC map (AC id, text, journey,
   status), one stub `.feature` per journey (headers only), and an `_unmapped.feature` bucket.

Record a [Work Log](#work-log-automatic) stage entry: journey count.

---

## Mode: bdd

Compose complete Gherkin feature files for one or more journeys (or from raw ACs). Honor the
[Clarify Gate](#clarify-gate-blocking-before-any-write) first.

**Composition rules:**

1. **Format**: emit a complete `.feature` as plain text - no Markdown fences, no prose, and NO
   reasoning/analysis preamble above the header (no paragraphs, `**Derived ACs:**`, `- AC_N:`
   bullets, `---`, or `##` headings). The FIRST line must be the feature-tag line or `Feature:` -
   a leading preamble breaks the Gherkin parser. Step keywords are ONLY
   Given/When/Then/And/But/`*` - never `Or`/`Nor` (Gherkin has no disjunction; use And/But).
2. **Structure**: feature-tag line -> `Feature: <name>` -> 1-line description.
3. **Background dedup**: when 2+ scenarios share the same leading Given(s) / initial When, lift
   them into one `Background:`. Do not repeat them per scenario.
4. **One scenario per AC (INVARIANT)**: default N ACs -> N scenarios. Collapse only when ACs
   describe the same observable behavior, one is a necessary precondition of another, or the
   same error surfaced two ways - then list every covered AC tag. Every AC covered by exactly
   one scenario; none uncovered, none twice; never invent scenarios beyond the AC list.
5. **Mandatory tags**, in this order, on one line above `Scenario:`:
   `@<TeamTag> @US_<n> @AC_<n> [@AC_<m> ...]`. Optional category tags follow (`@smoke`,
   `@happy-path`, `@alternate-path`, `@error-path`, `@edge-case`, `@validation`). Never use the
   raw AC ID (e.g. `1234-ac-2`) as a tag - it appears only in the `# Covers:` comment.
6. **Traceability comment**: one line above each scenario - `# Covers: <ac-id>[, <ac-id>]`.
7. **Concrete assertions**: every scenario ends with explicit success or rejection Then
   assertions (status code, visible banner, error message, response field). A non-asserting
   Then ("Then the journey is complete") is unacceptable.
8. **Mandatory negative coverage**: for every happy-path AC, also emit ONE companion error
   scenario tagged `@AC_<n>_err @error-path`, driven by the applicable failure type
   (unauthenticated/unauthorized, validation failure, not-found, precondition-not-met). Skip
   only when the AC already describes a failure or is purely informational. Companions are
   EXCLUDED from the coverage invariant.
9. **Step reuse**: before inventing a step, match against the catalog (see [Step matching](#step-matching--consolidation)).
   A strong match (score >= 90) MUST be reused verbatim - wording differences never justify a
   new step. If a strong match genuinely cannot be used, document why before creating a new one.
10. **Step count/quality**: aim 6-15 steps; a 3-step "when exercised, then it works" scenario
    is unacceptable. A tester must be able to execute the scenario manually with no other
    context.
11. **Concrete data**: use realistic values in plain Scenarios (no angle-bracket placeholders);
    use `Scenario Outline` + `Examples` only where it genuinely reduces duplication.
12. **Scope guardrail**: treat the detected in-house API surface as the only APIs a step may
    directly invoke; rephrase out-of-scope calls as Givens ("Given the eligibility service
    returned 'eligible'"). Do not compose multi-service flows that span teams.
13. **Canonical vocabulary**: normalize verb synonyms to one canonical form before accepting a
    step (`renders`/`is loaded`/`is displayed`/`is shown` -> `is visible`; one `{word}` state
    parameter covers a polarity pair). Optional three-axis execution tags
    (`@be-only`/`@fe-only`/`@combined`) only when existing feature files already use them.

**AC coverage validation** (after composing): every expected AC has exactly one covering
scenario; no AC covered twice (unless legitimately collapsed); every `@AC_<n>` maps to a real
AC; `@AC_<n>_err` companions excluded. Fix the output before writing if violated.

**Author checklist** (self-verify before writing): 1 scenario per AC; title `AC_<n> - <behavior>`;
mandatory tag triple present; happy path covered with business validations in Then; strong
matches reused; scenario focused (6-15 steps).

**Scope/layer filters** (optional): `stepScope=functional|nonfunctional` limits scenario
kinds; `testLayer=frontend|backend` forces the matching execution tag and step style.

Write to the [output convention](#configuration) feature path.

Record a [Work Log](#work-log-automatic) stage entry: scenario count across features, with each
scenario's complexity tier (Simple/Moderate/Complex) tallied.

---

## Mode: steps

Generate step-definition code for the target `.feature` files. Run `analyze` first (or load
the cached baseline). For each step pattern, match the catalog ([Step matching](#step-matching--consolidation)):
reuse if found; otherwise add to "needs implementation".

**Generation rules:**

1. **Valid code only** for the detected framework + language; no fences, no prose.
2. **Mirror the repo**: match existing imports, naming, base classes, and the step-registration
   mechanism exactly.
3. **Reuse infrastructure**: prefer existing page objects, helpers, and shared base utilities;
   keep steps thin (complex request/assertion logic goes in helpers/utils).
4. **No re-implementation**: never redefine a catalog step; register/export each new step per
   framework convention.
5. **Parameterize**: never hardcode a value that varies across scenarios. Use the framework's
   expression types (`{string}`, `{int}`, `{float}`, `{word}`). Prefer one broad parameterized
   step over many narrow ones; collapse polarity, datatype-adjective, and verb-synonym variants
   into a single step (P-catalog above). A concrete feature line still matches the parameterized
   expression, so feature files are not rewritten. Anti-patterns (FORBIDDEN -> RIGHT):
   ```
   Then('the achievements field value is not null')      -> Then('the {string} field value is not {word} in the response', field, condition)
   Given('the GET {string} endpoint returns {int}')       -> Given('the {string} {string} endpoint returns {int}', verb, path, code)
   Given('the GET /challenges/meta/daily endpoint returns {string}') -> Given('the {string} {string} endpoint returns {string}', verb, path, val)
   When('the hero section renders')                       -> When('the {string} is visible', component)
   Then('the ExplanationModal is open')                   -> Then('the {string} modal is {word}', modal, state)
   ```
   A raw `/` in a step pattern is Cucumber-expression ALTERNATION and breaks parsing - never bake a URL
   path; parameterize as `{string}` (or escape each `/` as `\/`).
6. **No hardcoded URLs/credentials**: read config and fixtures; use test-data aliases.
   **Real routes only**: an HTTP step's endpoint MUST be a real route the app exposes - read the app's route
   table (Express `router.*` + `app.use` mounts, Spring/FastAPI annotations) and use its exact METHOD+path
   INCLUDING any mount prefix (e.g. `POST /api/auth/register`, never a guessed `POST /api/users` and never
   dropping `/api` - a prefixless path hits the SPA fallback and returns HTML); if none fits, mark
   `MISSING_ROUTE: <intent>` instead of inventing a path.
   **Real auth/state/data**: use the app's real auth endpoint + body (register often needs username, email,
   password); prefer register-first (unique user) so no seeded account is needed; store the token in the
   framework's real state field (e.g. `state.token`, not `state.authToken`); draw path-param/enum values from
   the app's real ids (e.g. a real category slug), never invented; never leave a `{name}`/`<name>` placeholder
   in a plain Scenario - write a concrete literal.
   **Reused steps are candidates, not guarantees**: a pre-existing/library step (esp. a generic auth step) may
   hit the wrong endpoint or read the wrong token field for THIS app - verify it against the real
   routes/contract before reusing; if it does not fit, generate a grounded replacement instead of trusting it.
7. **Missing locators**: mark any UI locator absent from the page objects with a language-
   appropriate `MISSING_LOCATOR: <name>` comment.
8. **Category tag** (optional): top-of-file comment `// @functional|@nonfunctional @frontend|@backend`.
9. **Seam fidelity**: bind generated tests to the REAL exports and collaborators; never
   fabricate a pass (see [Seam & mock fidelity](#seam--mock-fidelity)).
10. **Framework block**: use the matching block in [Framework patterns](#framework-patterns).
11. **Validate + write**: no duplicated step patterns across files; then output the exact
    validate command as the last line:

| Stack | Validate command |
|---|---|
| TypeScript/JS | `npm run typecheck` or `tsc --noEmit` |
| JVM | `mvn compile` (or `gradle compileTestJava`) |
| .NET | `dotnet build` |
| Python | `python -m py_compile <files>` |
| Go | `go build ./...` |

Record a [Work Log](#work-log-automatic) stage entry: new vs reused step-defs, with each new
step-def's complexity tier tallied (reused contribute 0 effort).

### Framework patterns

Use ONLY the block for the detected stack. Match the repo's existing style over these defaults.

**playwright-bdd (TypeScript)** - output `test/bdd-steps/<domain>.steps.ts`:
```typescript
import { createBdd } from 'playwright-bdd';
import { test } from '../bdd-steps/bdd';
const { Given, When, Then } = createBdd(test);
// createBdd exposes no And/But registrars; alias them (step matching is keyword-agnostic) so And/But
// continuation steps register. Mirror the repo's fixtures barrel if it already exports them.
const And = Given, But = Given;
// Fixtures: page, request, token, stash, lastResponse, baseUrl, beUrl, wsUrl. No class/default exports.

When('I navigate to {string}', async ({ page }: ScenarioState, url: string) => {
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
Then('the {string} is {word}', async ({ page }: ScenarioState, name: string, state: string) => {
  const loc = page.locator(`[data-testid="${name}"], .${name}`).first();
  state === 'visible' ? await expect(loc).toBeVisible() : await expect(loc).toBeHidden();
});
When('I click the {string}', async ({ page }: ScenarioState, name: string) => {
  await page.getByRole('button', { name }).or(page.getByText(name)).first().click();
});
Given('I am logged in as the test user', async ({ page, request }: ScenarioState) => {
  // MISSING_LOCATOR: auth endpoint + token storage key (project-specific)
});
```

**Cucumber-JVM (Java/Kotlin)** - output `<stepDefsDir>/<Journey>Steps.java`; extend the repo's
base step class; reuse its HTTP client and scenario-state mechanism; `final var`, thin steps:
```java
@When("<pattern>")
public void descriptiveMethod(<params>) {
    final var response = httpClient.get(String.format("<endpoint>", param)); // reuse repo helper
    scenarioContext.setResponse(response);
}
@Then("<pattern>")
public void descriptiveMethod(<params>) {
    assertThat(scenarioContext.getResponse().statusCode(), equalTo(200)); // + business assertions
}
```

**SpecFlow / Reqnroll (.NET)** - output `<stepDefsDir>/<Journey>Steps.cs`; `[Binding]`; share
state via injected `ScenarioContext`; reuse the repo's HTTP client + assertion lib; `async Task`:
```csharp
[When(@"<pattern>")]
public async Task DescriptiveMethod(<params>) {
    var response = await _http.GetAsync($"<endpoint>");
    _ctx["response"] = response;
}
```

**behave / pytest-bdd (Python)** - output `features/steps/<domain>_steps.py`; `context` carries
state; reuse the repo's client; thin steps:
```python
@when('<pattern>')
def step_impl(context, <params>):
    context.response = context.client.get(f"<endpoint>")
@then('<pattern>')
def step_impl(context, <params>):
    assert context.response.status_code == 200  # + business assertions
```

**Cypress + cucumber-preprocessor (JS/TS)** - step files under `cypress/e2e/**`; use Cypress
commands + existing custom commands; alias responses (`.as('resp')`), no module globals:
```typescript
import { Given, When, Then } from '@badeball/cypress-cucumber-preprocessor';
When('I navigate to {string}', (url: string) => { cy.visit(url); });
Then('the {string} is {word}', (name: string, state: string) => {
  const el = cy.get(`[data-testid="${name}"]`);
  state === 'visible' ? el.should('be.visible') : el.should('not.exist');
});
Then('the response status is {int}', (code: number) => { cy.get('@resp').its('status').should('eq', code); });
```

**Karate (JVM - API + UI)** - the `.feature` IS the test (no step-def classes); compose/extend
features, tag reusable ones `@ignore`, keep steps thin (logic in `fn.*` JS / `Java.type` helpers);
assert with `match`/`status`; read config/locators, no hardcoded creds; validate `mvn test`:
```gherkin
Feature: <resource> retrieval
  Background:
    * url baseUrl
    * configure headers = { 'Content-Type': 'application/json' }
  Scenario: Get <resource> by id
    Given path 'customers', accountId
    And header Authorization = 'Bearer ' + token
    When method get
    Then status 200
    And match response.id == accountId
# UI: driver verbs (waitFor/retry/locate/click/input/optional/screenshot); locators from JSON;
# orchestrator drives sub-features via karate.call('x.feature', { data }); called features @ignore.
```

### Seam & mock fidelity
When generating unit or mock-based tests, bind to the code that actually exists - never an
invented seam.
- **Real exports.** Import only members the module actually exports. Do not invent a
  repository/CRUD contract, split one function into two, or fabricate a param DTO/shape. If the
  behavior lives in another unit (a route handler, a sibling module), test it THERE, not against
  an imagined helper.
- **Retarget by role.** When the module implements the behavior under a different name/shape,
  bind to the REAL member (read/list -> collection reader; get-by-id -> by-key getter;
  update -> updater; create -> creator; save -> writer). Adapt shape at the seam (unwrap a
  wrapper, wrap a flat arg; drop `await` if the real member is sync). You may rewire the called
  name inside `expect(...)`, but NEVER change the matcher or expected value to force a pass. If
  no real export plays the role, leave it failing and cover it in its real unit.
- **Mock only real collaborators, at the real shape** (sync vs async). A virtual mock of a
  non-dependency is a silent no-op; never leave a real collaborator unmocked.
- **External-package mocks target the exact import specifier** the code uses; repoint a
  wrong/uninstalled name to the SUT's real dependency (wiring only, never touch assertions).
- **jest: sync vs async.** Default a collaborator mock to `mockReturnValue` (a plain value is
  awaitable); use `mockResolvedValue`/`mockRejectedValue` only when the real collaborator is
  async.
- **jest: mock-factory TDZ.** A `jest.mock` factory is hoisted and fires during import; its
  object must not read a module-scope `const`/`let` directly - define inline or defer behind a
  function.
- **Never fabricate a pass.** If the code deliberately does not implement an asserted contract,
  leave the assertion and flag the spec-vs-code gap; do not modify application source to satisfy
  a generated test.

---

## Mode: coverage

Report AC traceability. Read `./docs/<slug>/story-context.md` for the AC list (ask for the
story id if absent). Scan feature files (`--featureDir` override) for `@AC_<n>` and
`@AC_<n>_err` tags. For each AC collect happy scenarios (`@AC_<n>` without `_err`) and error
scenarios (`@AC_<n>_err` or `@AC_<n>` + `@inferred-negative`), then classify:

| Status | Condition |
|---|---|
| covered | >= 1 happy AND >= 1 error scenario |
| partial | >= 1 scenario but missing happy or error companion |
| missing | 0 scenarios carry this AC tag |
| over-specified | > 3 scenarios cover the same AC |

Write the report to `./docs/<slug>/test-generation.md` using this template (quote the original
text of every `missing` AC as a follow-up `bdd` prompt; flag `over-specified` for dedup):

```markdown
# Test Generation Report - <slug>
Story: <US_n> - <title>
Summary: covered <C> / partial <P> / missing <M> / over-specified <O>  (total <T> ACs)

## Traceability Matrix
| # | AC | Scenario | Feature File | Step Def | New Steps | Reused Steps | Status | Type |
|---|----|----------|--------------|----------|-----------|--------------|--------|------|
| 1 | <ac-id>: <desc> | `Scenario: <name>` | `<file>.feature` | `<Class/module>` | `stepA` | `<Existing#reused>` | covered | Happy |
| 2 | <ac-id>: <desc> | `Scenario: <name> (error)` | `<file>.feature` | `<Class/module>` | `stepC` | `<reused>` | covered | Negative |

## Coverage Summary
| Metric | Count |
|--------|-------|
| Total ACs | <T> | | Scenarios | <n> | | New Steps | <n> | | Reused Steps | <n> | | Files | <n> |

## Gaps / Risks
- Missing ACs (quote text): <ac-id>: "<verbatim AC>"
- Over-specified ACs: <ac-id> - <k> scenarios
- Data / environment dependencies: <notes>

## Implementation Notes
| File | Action | Path |
|------|--------|------|
| `<Name>.feature` | Create/Modify | `<featuresDir>` |
| `<Name>` step def | Create/Modify | `<stepDefsDir>` |
Run command: `<runner> --tags "@<TeamTag> and @US_<n> and @AC_1"`
Pre-requisites: target service/app reachable; test data available; no skip tag on new scenarios.
```

Record a [Work Log](#work-log-automatic) stage entry: AC count classified.

---

## Mode: generate

Full pipeline: `story -> analyze -> plan -> bdd -> steps -> coverage`, feeding each stage into
the next. Flags: `--repoPath <path>`, `--stepScope`, `--testLayer`, `--no-step-gen` (stop after
bdd), `--fresh` (ignore cache), `--yes` (skip the clarify gate), `--no-branch` (skip
[auto-branch](#auto-branch-before-any-write)), `--no-framework-sync` (skip framework convention
sync), `--no-work-log` (skip the [Work Log](#work-log-automatic)), `--operator-name`/
`--experience`/`--area` (operator identity for the log). Do NOT otherwise auto-chain
`bdd -> steps` without confirmation. Accumulate every stage's [Work Log](#work-log-automatic)
entry across the run and write ONE consolidated set (`./docs/<slug>/work-log-<run-id>.md` +
`./docs/work-log/<run-id>_<slug>.{csv,json}`). Final report: feature-file count, step-def count,
AC coverage summary (covered/partial/missing/total), artifact paths, validate command, and the
time-savings summary (estimated engineer effort junior/medior/senior vs tool wall-clock, and the
work-log paths).

---

## Mode: log

Render or re-render a run's [Work Log](#work-log-automatic) without regenerating tests. With no
argument, summarize the most recent `./docs/<slug>/work-log-<run-id>.md`. Use this to review a
prior run or to compose a log from stage entries recorded piecemeal across single-mode runs.
See [Work log model](#work-log-model--template) for the estimation model and template.

---

## Mode: guided

```
bdd-authoring - modes:
  1. story <ado-url>  - Fetch/parse ADO story ACs (or paste them in)
  2. analyze          - Scan the repo: framework, language, step catalog
  3. plan             - Group ACs into journeys
  4. bdd              - Compose Gherkin feature files
  5. steps            - Step definitions for existing .feature files
  6. coverage         - AC traceability report
  7. generate         - Full pipeline (1 -> 6)
  8. log              - Work log + time-savings estimate for a run
Which mode? (number or keyword)
```

---

## Rules

- Never mention internal implementation details (MCP, provider names, SDK imports).
- Do not auto-chain modes without asking (except within `generate`).
- Output artifact paths, counts, and the validate command. No narration.
- If `AZURE_DEVOPS_PAT` is unset for `story`/`generate`, offer the paste-in fallback rather
  than failing.
- `@AC_<n>_err` companions never count against the AC coverage invariant.
- Fix any missing/duplicated AC coverage before writing.
- Always write a per-run [Work Log](#work-log-automatic) (unique file, never overwrite) unless
  `--no-work-log`; present the engineer-time estimate as a planning figure, not a measured
  benchmark.

---

## Work log model & template

The operator-identity resolution, estimation model, timing snippets, output template, and
PowerBI export schema for the [Work Log](#work-log-automatic). The estimate is a planning figure
from published authoring baselines, not a controlled benchmark. Record the caveat in every log:
tool wall-clock includes interactive latency; the engineer figure is independent work-effort,
not a measured race.

### Operator identity (ask once, then persist)
Resolve `<OperatorName>` / `<ExperienceLevel>` (`junior|medior|senior`) / `<Area>`, first hit
wins: (1) flags `--operator-name`/`--experience`/`--area`; (2) user file
`~/.claude/bdd-authoring-operator.json` = `{ "name","experienceLevel","area" }`; (3) ask once,
validate the level, then write the file. Flags override the file for this run but do NOT rewrite
it. Skip entirely under `--no-work-log`.
```
# PowerShell
$cfgPath = "$env:USERPROFILE\.claude\bdd-authoring-operator.json"
if (Test-Path $cfgPath) { $op = Get-Content $cfgPath -Raw | ConvertFrom-Json }
else { # ...ask Name / Experience (junior|medior|senior) / Area...
  $op = [PSCustomObject]@{ name=$name; experienceLevel=$level; area=$area }
  New-Item -ItemType Directory -Force (Split-Path $cfgPath) | Out-Null
  $op | ConvertTo-Json -Depth 5 | Set-Content $cfgPath -Encoding UTF8 }
# Bash
cfg="$HOME/.claude/bdd-authoring-operator.json"
[ -f "$cfg" ] || { mkdir -p "$(dirname "$cfg")"; printf '{"name":"%s","experienceLevel":"%s","area":"%s"}\n' "$name" "$level" "$area" > "$cfg"; }
```

### Timing capture (cross-shell)
Capture one **run-id** at the very start of the run; reuse it to name every file. Capture
start/end per stage and diff.
```
# PowerShell
$runId = Get-Date -Format 'yyyyMMdd-HHmmss'   # names the files, once per run
$t0    = Get-Date                              # per stage: start
$sec   = [int]((Get-Date) - $t0).TotalSeconds  # per stage: elapsed seconds
# Bash
runId=$(date +%Y%m%d-%H%M%S); t0=$(date +%s); sec=$(( $(date +%s) - t0 ))
```
Render durations human-friendly in the `.md` (`<1s`, `41s`, `1m30s`, `1h04m`); CSV/JSON use raw
numeric minutes/seconds so PowerBI can aggregate.

### Stage record schema
Record one row per stage as it finishes:
```
{ stage, startedAt, endedAt, toolSeconds, units, complexity: {simple,moderate,complex},
  repoComplexity?, workAchieved }   # workAchieved = one plain-language line
```
`units` = the countable output of the stage; `complexity` = per-artifact tier tally;
`repoComplexity` is set only by `analyze`.

### Estimation model (constants - tunable; edit here to retune)
Base engineer minutes at the **medior** level, per unit:

| Stage | Unit | Medior min/unit |
|-------|------|-----------------|
| AC gathering (`story`) | per AC extracted + structured | 12 |
| Repo analysis (`analyze`) | per run x repoComplexity | 60 |
| Journey composition (`plan`) | per journey | 25 |
| Test composition (`bdd`) | per scenario | 15 |
| Step-def generation (`steps`) | per NEW step-def (reused = 0) | 25 |
| Coverage (`coverage`) | fixed 20 + 2 per AC | 20 + 2/AC |

**Experience multiplier** (applied to the whole total): junior `x1.6`, medior `x1.0`, senior `x0.6`.

**Artifact complexity weight** (Moderate = 1.0); classify each scenario / step-def (and, when a
clear signal exists, each AC / journey) as it is composed:

| Tier | Weight | Scenario signals | Step-def signals |
|------|--------|------------------|------------------|
| Simple | 0.5 | <=6 steps; one status / single-field assertion; no data table; no outline | single client call or one equality assertion; reuses an existing helper |
| Moderate | 1.0 | 6-12 steps; a few assertions; <=1 precondition/fixture | a couple of operations; some param handling |
| Complex | 2.5 | >12 steps, or multi-field / collection / nested assertions, or `Scenario Outline` with multiple `Examples`, or multiple preconditions / cross-entity setup | stream/filter/map over collections, multi-field or nested assertions, multiple mocked collaborators, or a new helper/util is required |

Default an artifact to Moderate when no clear signal. Reused step-defs never contribute.

**Repo complexity** (weights `analyze` only; from signals `analyze` already collects - file/LOC
counts, detected stack, step-catalog size, monorepo detection).
`repoComplexity = sizeFactor x techFactor x monorepoFactor`:

| Factor | Values |
|--------|--------|
| sizeFactor (test+source subtree) | Small `<~50 files / <~5k LOC` = 0.5; Moderate `~50-300 / ~5k-30k` = 1.0; Large `>~300 / >~30k` = 2.0 |
| techFactor (readability of detected stack) | conventional (Java Cucumber-JVM, C# SpecFlow, Python behave, TS playwright-bdd) = 1.0; Karate (dense DSL, embedded JS, orchestration) = 1.4; mixed / unknown = 1.3 |
| monorepoFactor | single repo = 1.0; monorepo with API-surface + orphan reconciliation = 1.25 |

**Formula** (per experience level `E`):
```
perArtifact = Σ over ACs, journeys, scenarios, new step-defs of  baseMin(stage) x weight(artifact)
perRun      = 60 x repoComplexity            (analyze; omit if analyze did not run)
            + 20 + 2 x acCount               (coverage; omit if coverage did not run)
effort(E)   = experienceMult(E) x (perArtifact + perRun)
saved(E)    = effort(E) - toolWallClock ;  speedUp(E) = effort(E) / toolWallClock
```

### Output template (human `.md`)
Write to `./docs/<slug>/work-log-<run-id>.md`. Keep the section order.
```markdown
# Work Log - <slug> - <run-id>

Run: <mode|generate>   Story: <US_n> - <title>
Operator: <name> (<experienceLevel>)   Area: <area>
Started: <ISO>   Finished: <ISO>   Tool wall-clock: <human>

## Stages
| Stage | Work achieved | Units | Complexity (S/M/C) | Tool time | Eng junior | Eng medior | Eng senior |
|-------|---------------|-------|--------------------|-----------|------------|------------|------------|
| AC gathering | Extracted N ACs from M stories | N ACs | 3/6/3 | 41s | <h> | <h> | <h> |
| Repo analysis | Cataloged <stack>, N steps (repoCx <r>) | 1 repo | - | 22s | <h> | <h> | <h> |
| Journey composition | Composed N journeys | N | 1/3/1 | 28s | <h> | <h> | <h> |
| Test composition | N scenarios across M features | N | 6/8/3 | 1m30s | <h> | <h> | <h> |
| Step-def generation | N new step-defs (R reused) | N new | 5/6/2 | 1m10s | <h> | <h> | <h> |
| Coverage | Traceability for N ACs | N ACs | - | 15s | <h> | <h> | <h> |
| **TOTAL** | | | | **<human>** | **<h>** | **<h>** | **<h>** |

## Time savings (tool vs engineer)
| Experience | Est. manual effort | Tool wall-clock | Saved | Speed-up |
|------------|--------------------|-----------------|-------|----------|
| Junior | <h> | <human> | <h> | ~<N>x |
| Medior <- you | <h> | <human> | <h> | ~<N>x |
| Senior | <h> | <human> | <h> | ~<N>x |
(flag the operator's own tier with `<- you`.)

## Basis
Baselines: ~10 min/manual test case; 1.5-2.5 h (avg 2.0) per automated test-case-point; QA
spends 30-45% of a sprint authoring/maintaining tests. Weights applied - complexity: simple 0.5
/ moderate 1.0 / complex 2.5; experience: junior 1.6 / medior 1.0 / senior 0.6; repo complexity:
size <s> x tech <t> x monorepo <m>. Planning estimate, not a controlled benchmark; tool
wall-clock includes interactive latency.
```

### PowerBI export (CSV + JSON per run)
Alongside the `.md`, write `./docs/work-log/<run-id>_<slug>.csv` and `.json` into ONE central
folder for PowerBI `Get Data -> Folder -> Combine`. Unique per run, never overwritten.

CSV = one row per STAGE, NO total row (PowerBI aggregates); stable header; `run_date` as
`yyyy-MM-dd`; effort/saved numeric minutes, tool as seconds; quote free-text and double embedded
quotes:
```csv
run_id,run_date,operator_name,experience_level,area,story_id,story_title,mode,stage,work_achieved,units,unit_count,complexity_simple,complexity_moderate,complexity_complex,repo_complexity,tool_seconds,eng_junior_min,eng_medior_min,eng_senior_min,saved_junior_min,saved_medior_min,saved_senior_min
20260717-1_login,2026-07-17,Zoltan,medior,Care,12345,"Login flow",generate,bdd,"16 scenarios across 3 features",scenarios,16,6,8,2,,120,384,240,144,382,238,142
```
(`repo_complexity` blank except on the `analyze` row.)

JSON = one run object:
```json
{ "runId":"20260717-1_login","runDate":"2026-07-17","mode":"generate",
  "operator":{"name":"Zoltan","experienceLevel":"medior","area":"Care"},
  "story":{"id":"12345","title":"Login flow"},
  "stages":[{"stage":"bdd","units":"scenarios","unitCount":16,
    "complexity":{"simple":6,"moderate":8,"complex":2},"repoComplexity":null,
    "toolSeconds":120,"engJuniorMin":384,"engMediorMin":240,"engSeniorMin":144,
    "savedJuniorMin":382,"savedMediorMin":238,"savedSeniorMin":142}],
  "totals":{"toolSeconds":0,"engJuniorMin":0,"engMediorMin":0,"engSeniorMin":0} }
```
Load: PowerBI Get Data -> Folder -> the `work-log/` folder -> Combine; set `run_date` to Date
and effort/saved/tool to whole number; each stage row is a fact; operator_name / area /
experience_level / stage / mode / story_id are the dimensions. New runs = new files; Refresh.
