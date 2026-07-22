---
name: automation-agent-standalone
description: 'BDD test generation pipeline (ADO story fetch, repo analysis, journey planning, BDD scenario + step-def generation, AC traceability coverage) - no local codebase needed; compatible with GitHub Copilot'
argument-hint: '"story <url>" | "analyze" | "plan" | "generate" | "bdd" | "steps" | "coverage"'
user-invocable: true
---

This skill implements the BDD test generation pipeline as embedded AI instructions. No external CLI, no npm package, no local codebase required. Claude reads this document and uses its native tools (Read, Grep, Write, Bash/PowerShell) to execute the pipeline.

---

## Operating Rules

These rules apply to every mode. Any AI invoking this skill - Claude Code, GitHub Copilot, Cursor, or another agent - must follow them throughout the session.

### 1. Stop Wasting Tokens
Drop all conversational filler, pleasantries, and transitions (e.g., "Sure, I can help," "Important to note"). Start directly with the answer or code block. If data fits in a table, use a Markdown table instead of paragraphs. Use a regular hyphen (`-`) for prose; never the em-dash.

### 2. Surgical Output Only
Format all code edits as unified diffs. Never rewrite unchanged boilerplate, entire functions, or full files. No inline documentation, lengthy JSDoc blocks, or conversational comments in code outputs.

### 3. Session Resume & Codebase Orientation
Before the first response in a new session, read `AGENT_CONTEXT.md` at the repo root if present. When modifying source files, read the module index (`docs/CODEBASE_INDEX.md` or `docs/AGENT_MODULE_INDEX.md`) before grepping blindly.

### 4. Context & Scope Restraints
Only look at explicitly referenced file paths or active editor tabs. Do not scan adjacent directories unless explicitly commanded. Treat lockfiles (`package-lock.json`, `pnpm-lock.yaml`), auto-generated API clients, and massive mock JSON files as totally empty.

### 5. Strict Autonomous Agent Restrictions
Hard iteration cap: never exceed 3 execution loops in a multi-step workflow. Do not fix test/build failures in a continuous cycle - show the initial failure stack trace and stop. Reject broad prompts like "improve performance"; require a specific service or class target. Do not scrape external docs or search the web.

### 6. Architectural Preferences
Write highly atomic, modular code. Avoid large monolithic blocks. Separate concerns cleanly and make data flow obvious. Avoid generic abstractions that make code hard to follow.

### 7. Verification & Syntax
Do a mental syntax check before outputting any code. Do not rely on the user to report errors to fix cascading syntax issues. Following any code generation, output the exact terminal command needed to validate changes (`npm run typecheck`, `tsc --noEmit`, `mvn compile`) as the very last line.

### 8. Credential Storage & Secret Hygiene
Never commit secrets, access keys, tokens, or passwords in plaintext. Store passwords encrypted at rest (AES-256-GCM; key derived at request time from a developer passphrase via Argon2id + a random salt - passphrase never stored). Hashing is one-way and cannot be reversed. Other secrets go in env vars or a secrets manager; commit only `.env.example` placeholders. Test-user credentials are exempt unless the account is administrator-or-higher.

---

## Prerequisites

**Environment variables** (set in your shell before invoking):
- `AZURE_DEVOPS_PAT` - required for `story`, `generate` modes
- LLM provider (auto-detected; Claude Code session is used by default)
- `FIGMA_TOKEN` - optional, for Figma flow enrichment (not yet implemented in this skill)

**Team configuration** (asked on first run if not provided):
- `<TeamTag>` - your team's mandatory scenario tag (e.g. `MyTeam_Test`). Set as an argument or answer when prompted.
- `<StoryNumber>` - the ADO work item ID to use for `@US_<n>` tags.

**Operator identity** (for the work log; asked once, then persisted): `<OperatorName>` / `<ExperienceLevel>` (`junior|medior|senior`) / `<Area>`. Resolved from flags `--operator-name`/`--experience`/`--area`, else `~/.claude/bdd-authoring-operator.json`, else asked once and saved there. See [Work Log](#work-log-automatic).

---

## Mode Dispatch

Inspect the argument passed to this skill:

| Argument starts with | Mode |
|---|---|
| `story ` (followed by a URL) | [story mode](#mode-story) |
| `analyze` or `baseline` | [analyze mode](#mode-analyze) |
| `plan` | [plan mode](#mode-plan) |
| `generate` | [generate mode](#mode-generate) |
| `bdd` | [bdd mode](#mode-bdd) |
| `steps` | [steps mode](#mode-steps) |
| `coverage` | [coverage mode](#mode-coverage) |
| `log` or `worklog` | [log mode](#mode-log) |
| no argument or unrecognized | [guided mode](#mode-guided) |

---

## Work Log (automatic)

Every mode records who ran it, what it did, how long the tool took, and an estimated
engineer-time equivalent (junior/medior/senior) grounded in published authoring baselines.
Always on; opt out with `--no-work-log`.

- **Operator identity**: before the first work-log write, resolve `<OperatorName>` /
  `<ExperienceLevel>` (`junior|medior|senior`) / `<Area>` - flags first, else
  `~/.claude/bdd-authoring-operator.json`, else ask the user once, validate, and save that file.
  Skip this under `--no-work-log`. These stamp the log header and the CSV/JSON dimensions.
- Capture a **run-id** timestamp once at the start of the run and one start/end pair per stage.
  PowerShell: `$runId = Get-Date -Format 'yyyyMMdd-HHmmss'`; `$t0 = Get-Date`;
  `$sec = [int]((Get-Date) - $t0).TotalSeconds`. Bash: `runId=$(date +%Y%m%d-%H%M%S)`;
  `t0=$(date +%s)`; `sec=$(( $(date +%s) - t0 ))`.
- As each stage finishes, record a stage entry (units produced, per-artifact complexity tier,
  one-line "work achieved", tool seconds). Classify each scenario/step-def Simple/Moderate/
  Complex at composition time; `analyze` also records a repo-complexity factor.
- A single-mode run writes its own log; `generate` writes ONE consolidated multi-stage log.
- Write three files per run (unique per run - never overwrite): the human
  `artifacts/<storyId>-work-log-<run-id>.md`, plus PowerBI-consumable
  `artifacts/work-log/<run-id>_<storyId>.csv` and `.json` (one central folder for folder-combine).
  See [Work log model](#work-log-model--template) for the operator-config snippet, estimation
  model, `.md` template, and CSV/JSON schema.

---

## Mode: story

Fetch an ADO work item graph and display the story title + extracted acceptance criteria.

### Step 1 - Parse the URL

From the user's argument extract:
- `org` - the Azure DevOps organization name
- `project` - the project name
- `storyId` - the numeric work item ID

URL formats:
- `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}` - standard work item URL
- `https://dev.azure.com/{org}/{project}/_workitems/edit/{id}?workitem={id}` - query param form
- Saved query: `https://dev.azure.com/{org}/{project}/_queries/query/{queryId}`

### Step 2 - Fetch the work item

Run via PowerShell (Windows) or Bash (Unix):

**PowerShell:**
```powershell
$pat = $env:AZURE_DEVOPS_PAT
$encoded = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat"))
$headers = @{ Authorization = "Basic $encoded"; "Content-Type" = "application/json" }
$url = "https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}?`$expand=relations&api-version=7.1"
$r = Invoke-RestMethod -Uri $url -Headers $headers -Method Get
$r | ConvertTo-Json -Depth 10
```

**Bash:**
```bash
curl -s -u ":$AZURE_DEVOPS_PAT" \
  "https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{id}?\$expand=relations&api-version=7.1" \
  -H "Content-Type: application/json"
```

`$expand=relations` is mandatory - without it child story links are absent.

**Redirect detection:** HTTP 3xx response = authentication failure. Print a descriptive error and stop.

### Step 3 - Extract fields

From the JSON response:
- `fields["System.Title"]` - story title
- `fields["System.Description"]` - description (strip HTML)
- `fields["Microsoft.VSTS.Common.AcceptanceCriteria"]` - primary AC field; fallback: `fields["Custom.AcceptanceCriteria"]`
- `relations[]` where `rel.rel.includes("Hierarchy-Forward") || rel.attributes?.name === "Child"` - child story IDs via `url.split('/').pop()`

### Step 4 - Parse acceptance criteria

Apply this procedure to the raw AC HTML string:

1. Completely remove any content wrapped in `<s>`, `<strike>`, or `<del>` tags (strikethrough = withdrawn)
2. Replace block HTML tags (`<p>`, `<div>`, `<br>`, `<li>`, `<tr>`, `<h1>`-`<h6>`) with newlines
3. Strip all remaining HTML tags
4. Decode HTML entities (`&nbsp;` → space, `&amp;` → `&`, `&lt;` → `<`, `&gt;` → `>`)
5. Split on newlines; trim each line; filter blank lines
6. Filter lines matching `^[A-Za-z][A-Za-z\s-]*-Level\s+\S[^\n]*:\s*$` (section labels, not ACs)
7. Group lines by AC header - headers match this pattern (case-insensitive):
   ```
   ^(?:AC|Acceptance\s+Criteria|Scenario)\s*#?\s*(\d+)\s*[:\-–)]\s*(.*)$
   ```
   One header = one AC; all subsequent non-header lines join into that AC's text.
8. Fallback if no headers found: try grouping by `^Given\b` lines
9. Final fallback: one line = one AC
10. Assign IDs: `{storyId}-ac-{1-based-index}`

### Step 5 - BFS child traversal (when storyDepth > 1)

For each child story ID found in relations:
- Fetch the child work item with the same API call
- Skip work items that return 404 or 401 (TF401232) - log a warning and continue
- Use a visited set to prevent re-fetching
- Repeat up to `storyDepth` levels (default: 1)

### Step 6 - Display

Print a structured summary:
- Story title and ID
- Description (first 300 chars)
- Numbered AC list with IDs
- Child story titles (if any were fetched)

Write `artifacts/{storyId}_story-context.md` with the full content.

Record a [Work Log](#work-log-automatic) stage entry: AC count extracted + child stories.

---

## Mode: analyze

Run the Stage 0 repository baseline scan on the current directory (or a `--repoPath` the user provides).

### Procedure

```
PROCEDURE discover_repo_baseline(repoPath):

  IF repoPath is missing or does not exist:
    EMIT a "no-repo" baseline (exists=false). Story and journey planning can still
    run, but step-definition code-gen requires a target repo.
    RETURN.

  1. SCAN the repo root for framework signals:
     - package.json (npm/pnpm/yarn)  -> JS/TS test frameworks
     - pom.xml / build.gradle(.kts)  -> JVM (Karate, Cucumber-Java, JUnit)
     - *.csproj / *.sln              -> .NET (SpecFlow, Reqnroll)
     - go.mod                        -> Go (godog)
     - requirements.txt / pyproject.toml -> Python (behave, pytest-bdd)
     - Cargo.toml                    -> Rust (cucumber-rs)

  2. DETECT the primary language(s):
     - Count source files by extension across non-vendor folders
     - Top language by source file count -> primary
     - Always preserve presence of secondary languages

  3. DETECT the composition pattern:
     - playwright-bdd      : createBdd() imports in step files
     - karate-call-chain   : .feature files containing `* call read('classpath:...')`
     - cucumber-step-defs  : @Given/@When/@Then annotated methods or step registrations
     - page-object-model   : pages/ or page-objects/ directory with class files
     - mixed               : multiple patterns present
     - unknown             : no test framework detectable

  4. MAP the project structure (record repo-relative paths):
     - journeys / orchestrators directory
     - reusable API steps directory (jcs, api, services)
     - assertions directory
     - request payloads directory
     - test data / fixtures directory
     - helpers directory
     - configuration directory (playwright.config.ts, karate-config.js, etc.)

  4b. MONOREPO detection:
     If repoPath contains a top-level subfolder ending in '-svc' AND another ending in '-test':
       - serviceRoot = the -svc subfolder (repo-relative)
       - testRoot    = the -test subfolder (repo-relative)
       - Restrict test-artifact walk to the -test/ subtree
       - Extract in-house API surface primarily from the -svc/ subtree:
           Spring: @(Get|Post|Put|Patch|Delete)Mapping("...") with class-level @RequestMapping prefix
           Express: router.(get|post|put|patch|delete)('...')
           FastAPI: @(app|router).(get|post|put|patch|delete)('...')
           ASP.NET: [Http(Get|Post|Put|Patch|Delete)("...")] 
       - UNION service-side and test-side endpoints; dedupe by "METHOD path"

  4c. INLINE ASSERTION STYLE detection:
     Scan each .feature file for four patterns:
     - scenario-outline-examples : <placeholder> + Examples: blocks
     - quoted-literal            : 'single' or "double" quoted values in step text
     - trailing-numeric          : bare integer at end of step line (HTTP status codes)
     - data-table                : | key | value | rows beneath a step
     Produce inlineAssertionStats with counts + representative excerpts.

  4d. ORPHAN RECONCILIATION (only in a -svc/ + -test/ monorepo; deterministic, no LLM):
     After the surface UNION (4b), an endpoint the TESTS call but the SERVICE surface
     does NOT declare is an "orphan". Do NOT report it as dead test code until reconciled.
     First CANONICALISE both sides (path params + numeric/hex/mixed-id segments -> {id};
     keep vN version segments literal) so param-name-only differences never look orphaned.
     For each remaining orphan, in this precedence:
       scan-gap : the path's most specific literal segment appears (slash/quote-anchored)
                  in the -svc/ SOURCE -> the surface scan missed a real route (dynamic router,
                  base-class mount, constant-concatenated path). Treat as DECLARED and record
                  the source file:line. Grep the -svc/ tree ONLY, never the -test/ tree (else
                  you match the very test that reached it -> false scan-gap).
       renamed  : not in source, but a declared endpoint of the SAME method is a close
                  segment-wise match (>= 0.6 similarity; version drift v1->v2 or a path
                  restructure). The endpoint exists under a superseded path; the test wording
                  is stale. Record closestDeclared + similarity.
       dead     : no source hit and no close declared match -> stale test / other service.
     EMIT artifacts/<repo>-orphan-resolution.md (scan-gap / renamed / dead sections).
     FEEDBACK LOOP: fold every scan-gap path into the in-house API surface (and the byApi
     step index) BEFORE emitting the baseline, so downstream bdd/steps/coverage modes bind
     against the real route set instead of re-flagging it. This is the primary accuracy win -
     a hole in the declared surface silently propagates into every later stage.

  5. SAMPLE 3-5 existing feature files to infer naming conventions:
     - Feature file name pattern (PascalCase, kebab-case, SnakeCase)
     - Tag pattern in use
     - Inline assertion style (determined in 4c)
     - Step numbering style (STEP 01, # Step 1, none)
     - Auth header pattern (Bearer + variable name)

  6. COUNT artifacts: total feature files, step def files, helper modules, page object files.

  7. BUILD the step-definition catalog:
     - Grep every step-def file for step registration patterns
     - Record: pattern text, file path, inferred action label, HTTP signature where visible
     - Build four indexes:
         byApi            : canonical "METHOD /path" -> entry ids
         byResponseObject : root token of every JSON-path read -> entry ids
         byActionVerb     : add|remove|update|create|get|verify -> entry ids
         byNoun           : every content token from pattern + actionLabel -> entry ids

  8. EMIT artifacts (prefix = repo folder name):
     - artifacts/<repo>-baseline.json / .md
     - artifacts/<repo>-step-database.json / .md
     - artifacts/<repo>-payload-crossref-report.{json,md}  (when Postman/OpenAPI present)

  9. CACHE the baseline:
     - Write to .agent-cache/baseline-<sha256-of-repoPath>.json
     - Cache is valid for 7 days; invalidated by changes to framework config files
     - --refresh-baseline flag forces a fresh scan
```

**Artifact naming rule:** all files created in `artifacts/` use the US story number as prefix (e.g. `artifacts/US12345_journeys.md`), EXCEPT repo-scoped baseline files which use the repo name prefix (e.g. `artifacts/dal-basket-baseline.json`).

---

## Step Definition Database

The step-definition database is built by `analyze` mode (step 7) and consumed by `bdd` mode (Rule 9) and `steps` mode (Step 2). It is the single source of truth for whether a step wording and its associated payload shape already exist in the project.

### Schema

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "repoPath": "/absolute/path/to/repo",
  "entries": [
    {
      "id": "sha256-of-pattern-and-file",
      "pattern": "the customer sends a {string} request to {string}",
      "file": "test/steps/basket.steps.ts",
      "line": 42,
      "framework": "playwright-bdd",
      "actionLabel": "HTTP POST with payload",
      "httpSignature": "POST /api/basket/add",
      "tokens": ["customer", "sends", "request", "basket", "add"],
      "payloads": [
        {
          "source": "fixture",
          "path": "test/fixtures/add-item-payload.json",
          "shape": {
            "productId": "string",
            "quantity": "number",
            "variantId": "string | null"
          },
          "requiredFields": ["productId", "quantity"],
          "notes": "variantId is optional; omit for SIMO products"
        }
      ]
    }
  ],
  "indexes": {
    "byApi": { "POST /api/basket/add": ["entry-id-1"] },
    "byResponseObject": { "basket": ["entry-id-1"] },
    "byActionVerb": { "create": ["entry-id-1"], "verify": ["entry-id-2"] },
    "byNoun": { "basket": ["entry-id-1"], "element": ["entry-id-3"] }
  }
}
```

**Field notes:**
- `pattern` - verbatim Cucumber expression or regex as written in the step file
- `httpSignature` - canonical `"METHOD /path"` extracted from the step body; `null` if not an HTTP step
- `tokens` - normalized content tokens from the pattern text and `actionLabel`; stop words removed
- `payloads` - array of payload descriptors used by this step's body; empty array for non-HTTP steps

**Payload descriptor fields:**

| Field | Description |
|---|---|
| `source` | `"fixture"` (JSON/YAML file), `"inline"` (object literal in step body), `"factory"` (builder/helper function), `"datatable"` (Cucumber DataTable), `"none"` |
| `path` | Repo-relative path to the fixture file or factory module; `null` when source is `inline` or `none` |
| `shape` | Flat map of `fieldName -> type` describing the top-level keys of the request body. Nested objects use dot notation: `"address.postcode": "string"`. Arrays use `[]` suffix: `"items[].sku": "string"` |
| `requiredFields` | Fields that are always present; omitted fields are optional |
| `notes` | Short freetext explaining constraints, conditionals, or business rules affecting the payload |

**How to extract payload info during `analyze` mode step 7:**

For each step body, scan for:
1. `fixture` - file paths passed to `readFileSync`, `require(...)`, `loadFixture(...)`, `readJson(...)`, or similar. Read the file and derive `shape` from its keys.
2. `inline` - object literals assigned to a request body variable (e.g., `body = { ... }`). Extract top-level keys and their JS types.
3. `factory` - calls to a builder function (e.g., `buildAddItemPayload(...)`). Record the function name as `path`; set `shape` to `null` (requires reading the factory).
4. `datatable` - `DataTable` parameter present in step signature. Set `shape: "datatable"`.
5. `none` - no request body found (GET, DELETE without body, assertion steps).

### Bootstrap: when the database is missing

Before executing bdd mode Rule 9 or steps mode Step 2, check for the database:

```
PROCEDURE ensure_step_database(repoPath):

  1. LOOK for the database in this order:
     a. artifacts/<repo>-step-database.json
     b. .agent-cache/baseline-<sha256-of-repoPath>.json -> stepCatalog field

  2. IF found and age < 7 days: load it and proceed.

  3. IF not found:
     a. Emit a one-line notice: "No step database found - building from <repoPath>."
     b. Run a LIGHTWEIGHT SCAN (same as analyze mode step 7, but skip steps 1-6):
          - Glob all step-def file patterns for the detected framework:
              playwright-bdd : test/**/*.steps.ts, tests/**/*.steps.ts
              cucumber-java  : src/**/*Steps.java, src/**/*StepDefs.java
              specflow        : **/*Steps.cs, **/*StepDefs.cs
              behave          : features/steps/**/*.py
          - Grep for step registration patterns and extract pattern text + body
          - Extract payload descriptors from each step body (fixture/inline/factory/datatable)
          - Build entries[] and indexes{}
          - Write to artifacts/<repo>-step-database.json
          - Append stepCatalog to .agent-cache/baseline-<sha256>.json (create if absent)
     c. If repoPath is absent or yields 0 step files: emit a "no-step-database" warning
        and mark all catalog lookups as "no match" for this run.
```

### Using payload info when generating new step definitions

When `steps` mode generates a new step for an HTTP endpoint that already has an entry in the database via `byApi`:

1. Read the matched entry's `payloads[0]` (or the entry with the highest score).
2. Use its `shape` as the starting template for the new step's payload.
3. If `source == "fixture"`: generate the new step importing from the same fixture path (or a sibling fixture with a descriptive name for the new scenario).
4. If `source == "factory"`: generate the new step calling the same factory function with the new parameters.
5. If `source == "inline"`: replicate the inline shape, parameterizing any fields that vary across scenarios.
6. Preserve all `requiredFields` in the new payload; make all others optional.
7. Document deviations in a `notes` update on the new entry.

---

## NLP Step Matching

Used by `bdd` mode Rule 9 and `steps` mode Step 2 to determine whether a candidate step phrase already exists in the catalog. Apply this algorithm before inventing any new step wording.

### Normalization

Apply to both the candidate phrase and each catalog `pattern` before comparing:

1. Strip the leading Gherkin keyword (`Given |When |Then |And |But `, case-insensitive)
2. Replace all Cucumber expression placeholders (`{string}`, `{int}`, `{float}`, `{word}`, `{bigdecimal}`) with the token `__PARAM__`
3. Lowercase everything
4. Expand synonyms using the table below
5. Remove stop words: `a an the is are was were be been being have has had do does did will would shall should may might must can could of in on at to for with by from`
6. Tokenize on whitespace and punctuation
7. Result: a sorted set of content tokens

### Synonym table

| Canonical | Synonyms (normalize to canonical before tokenizing) |
|---|---|
| `visible` | `rendered`, `loaded`, `displayed`, `shown`, `open`, `present` |
| `hidden` | `absent`, `closed`, `gone` |
| `click` | `tap`, `press`, `select` (UI action context) |
| `navigate` | `go to`, `visit`, `open` (URL context) |
| `verify` | `check`, `assert`, `confirm`, `validate` |
| `create` | `add`, `insert`, `register`, `submit` |
| `delete` | `remove` |
| `clear` | `reset` |
| `update` | `edit`, `modify`, `change` |
| `get` | `fetch`, `retrieve`, `read`, `query` |
| `redirect` | `forward`, `route` |
| `shows` | `displays`, `reads`, `contains` (text assertion context) |

### Scoring

For each catalog entry compute a match score (0-100) against the candidate phrase:

```
SCORE(candidate, entry):

  A. EXACT_MATCH
     After normalization: candidate tokens == entry tokens -> score = 100 (stop)

  B. PATTERN_MATCH
     Substitute __PARAM__ wildcards into entry.pattern to build a regex;
     if the regex fully matches the raw (un-normalized) candidate -> score = 90 (stop)

  C. TOKEN_OVERLAP (Jaccard similarity)
     intersection = candidate_tokens ∩ entry_tokens
     union        = candidate_tokens ∪ entry_tokens
     score        = (|intersection| / |union|) × 70

  D. INDEX_BONUS (added to C when score did not reach 90 via A or B)
     +15  httpSignature extracted from candidate matches a key in byApi index
     +10  any actionVerb token matches a key in byActionVerb index
     +8   any noun token matches a key in byNoun index

  FINAL = min(A|B|C+D, 100)
```

### Decision thresholds

| Score range | Decision |
|---|---|
| >= 90 | **Strong match** - reuse the existing pattern verbatim (mandatory per bdd Rule 9) |
| 70-89 | **Candidate match** - show the existing pattern; ask "reuse or create new?" |
| 50-69 | **Weak match** - log as informational; proceed to create a new step |
| < 50 | **No match** - create a new step |

**Rule 9 override:** A strong match (>= 90) MUST be reused verbatim. Wording differences alone do not justify a new step at this score level.

### Multi-candidate handling

When multiple entries score >= 70, rank by score descending. Break ties by preferring the lower line number (defined earlier = more foundational). Present no more than the top 3 candidates.

Record a [Work Log](#work-log-automatic) stage entry: detected stack, step-catalog size, and the repo-complexity factor (sizeFactor x techFactor x monorepoFactor) from these signals.

---

## Mode: plan

Discover journeys by grouping the story graph's acceptance criteria into end-to-end customer flows.

**Prerequisite:** Run `story` mode first (or have story data in context). Run `analyze` mode first if you have a target test repo.

### Step 1 - Build the user prompt

Assemble this prompt from the story data:

```
Epic: [{rootStoryId}] {rootTitle}
Epic description:
{rootDescription, clipped to 4000 chars}

Work items (id, title, ACs):
[{storyId}] {storyTitle}
  {acId}: {acText}
  ...

({N} stories, {M} ACs total.)
```

Stories with zero ACs are omitted.

### Step 2 - Compose journeys (LLM generation)

You are now acting as the LLM. Generate a journey map following this system prompt:

---

**JOURNEY DISCOVERY SYSTEM PROMPT:**

You are a senior business analyst structuring an Azure DevOps work-item graph into end-to-end customer journeys.

A journey is a coherent customer flow from a triggering action to a measurable outcome - e.g. "Soft Eligibility Check on PDP", "Address entry and validation", "Checkout with prepopulated details". A journey has 2 or more ordered steps from the customer's perspective. Pure infrastructure work, dependency tracking, analytics-only stories, swagger updates, and platform setup are NOT journeys.

You will be given an epic and the descendant work items. Identify the distinct journeys the graph implies and assign each acceptance criterion (AC) to the journey it primarily serves.

Output rules:
1. Output JSON only. No prose, no Markdown, no code fences, no comments.
2. Use exactly this schema:
```json
{
  "journeys": [
    {
      "id": "kebab-case-id",
      "name": "Short human-readable title",
      "description": "1-2 sentences from the customer's perspective.",
      "primaryActor": "Customer | Internal user | System",
      "steps": [
        {
          "order": 1,
          "description": "Brief step description.",
          "relatedStoryIds": ["..."],
          "acceptanceCriteriaIds": ["..."]
        }
      ]
    }
  ],
  "unmappedAcceptanceCriteriaIds": ["..."]
}
```
3. Every acceptanceCriteriaId you cite MUST appear verbatim in the input. Never invent IDs.
4. Every AC belongs to at most one journey. ACs that are cross-cutting (telemetry, infra, dependencies) go in unmappedAcceptanceCriteriaIds - do NOT force them into a journey.
5. Aim for 3-12 journeys. Prefer narrow, well-defined journeys over umbrella ones.
6. Each journey needs at least 2 steps. If you can articulate fewer, fold the work into another journey or move its ACs to unmapped.
7. Step ordering must reflect the actual customer-flow order, not work-item creation order.

---

### Step 3 - Validate the journey map

Apply these rules to the generated JSON:
1. Every cited AC ID must exist verbatim in the input graph; drop unknowns (log count as `droppedAcIds`)
2. Each AC belongs to at most one journey; drop later duplicate claims
3. Drop journeys with fewer than 2 steps (after filtering empty steps)
4. ACs not assigned to any journey -> `unmappedAcceptanceCriteriaIds`

If the JSON fails to parse, retry once with this reminder appended to the prompt:
```
IMPORTANT: Respond with a SINGLE valid JSON object matching the schema.
No prose, no Markdown, no code fences. Start your response with "{" and end with "}".
```

### Step 4 - Detect target folders (Vodafone/telco journey vocabulary)

For each journey, run the following scoring procedure to suggest the destination folder in the test repo:

```
PROCEDURE detect_target_folder(journey, repo_baseline):

  1. EXTRACT keywords from journey name, description, tags, and scenario names:
       journey type    : acquisition, upgrade, secondline, renewal
       product type    : SIMO, handset, broadband, MBB, PAYG, smartwatch
       customer segment: consumer, business, CBU, EBU

  2. SCAN candidate folders from repo_baseline.structure.journeysDir:
       For each subfolder, read existing .feature file tags + Feature names.

  3. SCORE the match:
       +3  product type match  (e.g. "SIMO" keyword -> simo/)
       +2  journey type match  (e.g. "acquisition" -> folder containing acquisition features)
       +1  segment match       (e.g. "consumer" or "CBU" -> folder with consumer features)
       Pick highest-scoring folder.

  4. FALLBACK: if no candidate scores > 0, ask the user to confirm the target folder.

  ABBREVIATION MAP:
    PAYM = Pay Monthly = SIMO context
    CBU  = Consumer Business Unit = consumer segment
    EBU  = Enterprise Business Unit = business segment
    MBB  = Mobile Broadband (distinct product type)
    SIMO = SIM Only (distinct from handset)
    PAYG = Pay As You Go

  EXAMPLE:
    Journey: "Handset PAYM Acquisition CBU"
    -> product = handset/SIMO (PAYM = Pay Monthly = SIMO context)
    -> journey = acquisition
    -> segment = consumer (CBU)
    -> Best match: journeys/simo/ (contains SIMO_Acquisition.feature)
```

### Step 5 - Write artifacts

- `artifacts/{storyId}_journeys.md` / `.json` - human-readable and machine-readable journey map
- `artifacts/{storyId}_acceptance-criteria-map.md` - per-AC: AC ID, text, assigned journey, status
- One stub `.feature` file per journey: `artifacts/journeys/{storyId}_{journey-id}.feature` (headers only, filled in by `bdd` mode)
- `artifacts/journeys/_{storyId}_unmapped.feature` - cross-cutting AC bucket

Record a [Work Log](#work-log-automatic) stage entry: journey count.

---

## Mode: bdd

Compose complete BDD feature files for one or more journeys.

**Input:** The user provides either:
- A journey map (from `plan` mode, as a file or pasted JSON)
- A story URL (to run story + plan inline)
- Raw acceptance criteria text (for standalone use without ADO)

**If running without ADO:** Ask the user to provide:
- A description of the feature being tested
- A list of acceptance criteria (numbered)
- The US/story number for tagging (or use a placeholder like `US0`)
- Their team tag (for `@<TeamTag>`)

### BDD Composition Rules

Follow ALL of these rules when generating BDD feature files:

---

**Rule 1 - Output format:**
Output a complete Gherkin .feature file as plain text. No prose around it. No Markdown fences. No commentary.
Do NOT prepend any reasoning/analysis preamble (no paragraphs, no `**Derived ACs:**`, no `- AC_N:` bullets,
no `---`, no `##` headings) - the FIRST character of the response must begin the feature header (the `@tag`
line or `Feature:`). A leading preamble makes the file fail the Gherkin parser.
Emit EXACTLY ONE `Feature:` block and NOTHING else - no reasoning, notes, or "Let me..."/"Actually..." lines
ANYWHERE in the file (not just the top), and no earlier drafts; if you reconsider, output ONLY the final
feature. Multiple `Feature:` blocks are invalid Gherkin and fail to parse.
Step keywords are ONLY Given/When/Then/And/But/`*` - never `Or`/`Nor` (Gherkin has no disjunction; use a
second `And`/`Then` step or fold the alternative into the step text). An `Or` line fails the parser.
Never repeat the SAME step consecutively (e.g. the same `is visible` assertion 4x) - assert each thing once.

**Rule 2 - Feature structure:**
Start with feature-level tags on a single line, then `Feature: <name>`, then a 1-line description.

**Rule 3 - Background deduplication (IMPORTANT):**
When more than one scenario in this feature shares the SAME Given preconditions or initial When (e.g. "Given the customer is signed in", "When the customer navigates to the basket page"), lift those steps into a single `Background:` block. Do NOT repeat them inside each scenario.

**Rule 4 - One scenario per AC with smart collapsing:**
The DEFAULT is one scenario per AC (so N ACs => N scenarios).

EXCEPTION - COLLAPSE functionally-equivalent or implicitly-verified ACs into a single scenario:
- Two ACs describe the SAME observable behaviour with different wording
- One AC's success is a NECESSARY PRECONDITION of another's
- Two ACs describe the same error condition surfaced in equivalent ways

When you collapse, list EVERY covered AC's tag on the scenario's tag line: `@<TeamTag> @US_<n> @AC_1 @AC_2 @AC_5`.
The naming pattern stays `Scenario: AC_<primary> - <short summary>` where `<primary>` is the most representative AC index.
Above the scenario, the `# Covers:` comment lists EVERY covered AC ID, comma-separated.

**INVARIANT: every AC in the checklist MUST be covered by exactly one scenario (no AC may go uncovered, no AC may be covered twice). Do NOT invent extra scenarios beyond the AC list.**

**Rule 5 - Mandatory scenario tags (CRITICAL):**
EVERY scenario MUST start with this tag block, in this order, on a single tag line immediately above the `Scenario:`:
- `@<TeamTag>` (the team-fixed tag(s) - ask user if not yet known; default `@AutomationTeam_Test` if user doesn't specify)
- `@US_<story_number>` (the parent ADO work item ID)
- `@AC_<n> [@AC_<m> ...]` (1-based AC indices - ONE per AC covered; multiple when collapsing)

Optional category tags after the mandatory triple: `@smoke`, `@regression`, `@happy-path`, `@alternate-path`, `@error-path`, `@edge-case`, `@validation`, `@phase-2`, `@bdd`. Use as many as apply.

Do NOT use the raw AC ID (e.g. `3198479-llm-ac-2`) as a tag. It appears ONLY in the `# Covers:` comment.

**Rule 6 - Traceability comment:**
Above each scenario, add ONE comment line: `# Covers: {storyId}-ac-{n}[, {storyId}-ac-{m}]`

**Rule 7 - Happy-path + validations:**
EVERY scenario must walk its AC's primary path AND end with concrete Then assertions:
- Positive-outcome ACs: exercise the happy path end-to-end. Then-steps MUST include at least one explicit success assertion (e.g. "Then the response status is 200", "Then the customer sees a success banner").
- Negative-outcome ACs: exercise the failure path. Then-steps MUST include at least one explicit rejection/error assertion (e.g. "Then the response status is 4XX", "Then an error message is shown").
- A scenario that ends with "Then the journey is complete" or any non-asserting Then is unacceptable.

**Rule 8 - Scope guardrail:**
You will be given an "In-house API surface" list. Treat it as the only APIs the test may directly invoke. If a step would require calling an API not in this list, rephrase the step as a precondition ("Given the upstream eligibility service returned 'eligible'") or omit it. Do not compose multi-microservice flows that span teams.

**Rule 9 - Step reuse guardrail (CRITICAL):**
Before inventing any new step, check the existing step catalog built in `analyze` mode.
The catalog bodies are the authoritative source: if an existing body already calls the HTTP endpoint, page-object method, or assertion you would write, REUSE its pattern verbatim - wording differences are NOT a reason to create a new step.
Two phrasings that DO the same thing MUST collapse to whichever phrasing is already in the catalog.
Only invent new step wording when no catalog entry's body performs the action you need.

**Rule 10 - Step count:**
Each scenario must contain enough Given/When/Then/And steps. Most scenarios will have 6-15 steps. A 3-step "When journey is exercised, Then it works" scenario is unacceptable.

**Rule 11 - Concrete test data:**
Use concrete realistic test data: real names ("John Smith"), real-looking dates, real currencies. Never use angle-bracket placeholders inside a regular Scenario; reserve those for Scenario Outline + Examples.

**Rule 12:** Use Scenario Outline + Examples where it actually reduces duplication.

**Rule 13:** UI affordances (button clicks, form fields) may appear in steps when present in the source flow - keep them.

**Rule 14:** No code, no scripts, no language identifiers. Just Gherkin.

**Quality bar:** A tester reading this file should be able to execute every scenario manually with no other context. Steps must reference visible UI affordances OR concrete in-house API calls, real form fields, real values, and real expected outcomes.

**Rule 15 - Three-axis execution tags (playwright-bdd projects only):**
When the existing step catalog shows files named like `http.steps.*`, `ui-*.steps.*` etc., and existing feature files already carry `@be-only`, `@fe-only`, or `@combined` tags, append exactly ONE of these to every scenario tag line (AFTER the mandatory triple):
- `@be-only` - scenario exercises ONLY API/HTTP steps; no browser or page interaction
- `@fe-only` - scenario exercises ONLY UI/browser steps; no direct HTTP response assertions
- `@combined` - scenario mixes browser interaction WITH direct API/HTTP assertions

If the step catalog does NOT follow this convention, do NOT add these tags.

**Rule 16 - Universal Step Catalogue:**
These step phrasings are canonical. Use them verbatim; do not invent per-instance alternatives.

**NAVIGATION** (any page goto by URL):
- `When I navigate to {string}` - body: `page.goto(url)` + `waitForLoadState('networkidle')` + `expect(page).toHaveURL(urlRegex)`
- Do NOT write: "I navigate to the Dashboard", "I am on the Profile page at {string}", "an anonymous visitor navigates to {string}"

**REDIRECT ASSERTION** (URL change triggered by a click or API response, not by goto):
- `Then the browser is redirected to {string}` - body: `waitForURL(urlRegex)` + `expect(page).toHaveURL(urlRegex)`

**ELEMENT VISIBILITY**:
- `Then the {string} is visible` / `Then the {string} is hidden`
- ONE step with `{word}` state parameter covers both polarities

**MODAL STATE**:
- `Then the {string} modal is {word}` (state: `visible` | `hidden`)
- `When I close the {string} modal`
- Do NOT create separate step files for positive and negative modal state

**LOCALSTORAGE**:
- `Given the localStorage key {string} is set to {string}` - SETUP (establishes state)
- `Given the localStorage key {string} is cleared` - SETUP (establishes state; `removed`/`empty`/`unset` are synonyms). The step-def implements the clear-verbs as `localStorage.removeItem(key)`, so a `Given ... is cleared` precondition removes the key instead of throwing `Unknown localStorage state`.
- `Then the localStorage key {string} is {word}` (state: `present` | `absent`) - ASSERTION only
- Do NOT write key-specific steps
- `... is {present|absent}` is a Then ASSERTION - NEVER use it as a Given/precondition. To make a key exist as a precondition, use the SETUP step `the localStorage key {string} is set to {string}` (do not assert `is present` to "arrange" it; the `Background:` may have cleared it first)

**PRECONDITION DISCIPLINE + BROWSER-SESSION vs API-AUTH** (composition):
- Steps BEFORE a scenario's first `When` are preconditions - they must ESTABLISH state with setup steps (`... is set to ...`, `... is cleared`, `I am logged in as ...`, `I register with ...`), NEVER a Then-style assertion (`the localStorage key ... is present|absent`, `the {string} is visible`, `the response status is`). You cannot assert a state you have not arranged.
- BE auth (the API `Authorization` header / a ScenarioState token) and the browser's localStorage session are DISTINCT mechanisms. Seed an FE session precondition via `the localStorage key {string} is set to {string}`, not a BE token step.
- A browser side-effect (localStorage cleared by the app's AuthContext, redirect to a page) is triggered ONLY by a BROWSER action (`When I navigate to {string}`), never by a direct API-request step. Keep BE-contract ACs (`@be-only`) and FE-behaviour ACs (`@fe-only`/`@combined`) in SEPARATE scenarios.

**CLICK**:
- `When I click the {string}` - any button/link by visible text or aria-label
- Do NOT write hardcoded button/link step text

**AUTHENTICATION** (any scenario requiring a logged-in user):
- `Given I am logged in as the test user`
- Body: POST to your project's auth endpoint with test-user credentials; store returned JWT in the appropriate storage location
- This is the ONLY login step. Do NOT write per-persona login variants ("I am logged in as ragnar", "I am authenticated", "the user is signed in")
- Use this step in the `Background:` of every scenario that requires authentication
- **The body of this step is project-specific.** Adapt it to your project's auth endpoint and credential fixture file.
- A scenario that exercises the login endpoint DIRECTLY for success must be REGISTER-FIRST and SELF-CONSISTENT: `Given I register with username "<unique>" and password "<P>"` then `When I login with username "<unique>" and password "<P>"` using the SAME creds. NEVER authenticate as a real/existing/seeded username with a guessed or literal password (you cannot know a pre-seeded account's real password) - that returns 401. A pre-seeded user is used only through the logged-in persona step, never a raw credential step.
- REAL BODY FIELD NAMES: when a step sends a raw request body to the auth login/register route (`I send a POST request to "<auth route>" with body:` + a DataTable), the DataTable KEYS must be the app's REAL body field names (a login is typically `username` + `password`; the `username` field usually accepts a username OR an email VALUE). NEVER invent an alias key such as `identifier`, `user`, `login`, or `usernameOrEmail` - the endpoint does not read it and the request returns 400. Put a username-or-email VALUE under the real `username` key.

**CANONICAL VERB ENFORCEMENT** (mandatory rewrites before any step text is accepted):
- `renders` | `is loaded` | `is inspected` | `is displayed` -> use `is visible`
- `is open` | `is shown` -> use `is visible`
- `shows` | `reads` | `displays` (text assertion) -> use `shows`
- `is not present` | `is cleared` | `is removed` (localStorage) -> use `is absent`
- Page name outside `{}` (Dashboard, Profile, Landing) in assertion step -> redesign
- Load-state suffix: "the X page finishes loading" -> use `When I navigate to {string}` instead

### Inferred-Negative Scenarios

For every happy-path AC (one describing a successful user outcome), also generate ONE companion scenario tagged `@error-path @inferred-negative`:

Trigger types:
- Requires authentication -> unauthenticated or unauthorised access (HTTP 401/403 or redirect to login). ONLY
  for endpoints the app actually protects: confirm the route's handler is auth-gated (an auth middleware such
  as `requireAuth`/`authenticate`) before asserting a 401/403 unauthenticated. A PUBLIC or optional-auth route
  (no auth middleware, or an `optionalAuth`-style wrapper) returns 200 unauthenticated, so a 401 expectation
  there is a spec-vs-code mismatch, not a test - skip it (or mark it `# REVIEW: spec-vs-code`).
- Creates or submits data -> validation failure (missing required field, invalid format, or business-rule violation)
- Retrieves a resource -> resource not found (empty state, 404, or no results)
- Stateful action (add to basket, purchase, enrol) -> precondition not met (item unavailable, already purchased, quota exceeded)

Do NOT add an `@inferred-negative` companion if the AC already describes a failure condition, or if the AC is purely informational.

The companion MUST carry: journey tag(s), `@US_<storyId>`, `@AC_<seq>_err` (note the `_err` suffix - NOT `@AC_<seq>`), `@error-path`, `@inferred-negative`, plus the applicable execution tag - `@fe-only` when it only exercises client-side validation (the form never submits), or `@combined`/`@be-only` when it submits and receives a 4xx/5xx API response. Its `# Covers:` comment references the same AC ID as its happy-path parent. Companions are EXCLUDED from the AC coverage invariant.

### Scope and Layer Filters (optional)

If the user specifies a scope or layer filter, add one of these blocks to the generation context:

**stepScope=functional:** Generate ONLY functional scenarios (user-observable behaviors and business rules). Do NOT generate scenarios asserting console errors, runtime exceptions, CSS styling, performance timing, or accessibility markup.

**stepScope=nonfunctional:** Generate ONLY non-functional quality scenarios (JavaScript errors, accessibility, visual regression, performance SLAs, security headers). Do NOT generate functional happy-path or error-handling scenarios.

**testLayer=frontend:** All scenarios MUST carry the `@fe-only` tag. Step definitions must use Playwright browser interactions only. Do not configure or assert HTTP endpoints directly.

**testLayer=backend:** All scenarios MUST carry the `@be-only` tag. Step definitions must use HTTP/fetch calls only. Do not use browser page-object interactions.

### AC Coverage Validation

After composing all scenarios, verify:
1. Every expected AC has exactly one scenario covering it (via `@AC_<n>` tag)
2. No AC is covered by more than one scenario (unless legitimately collapsed)
3. All `@AC_<n>` tags in the output correspond to actual ACs in the input list
4. `@inferred-negative` companions (tagged `@AC_<n>_err`) are excluded from checks 1 and 2

If validation fails, revise the output to fix missing or duplicated AC coverage.

### Output

Write the feature file(s) to:
- `artifacts/{storyId}/{journey-id}.feature` (if running from a journey map)
- `artifacts/{storyId}/scenarios.feature` (if running from raw ACs)

Record a [Work Log](#work-log-automatic) stage entry: scenario count across features, with each scenario's complexity tier (Simple/Moderate/Complex) tallied.

---

## Mode: steps

Generate step definition code for one or more existing `.feature` files.

**Input:** User provides one or more `.feature` file paths (or the skill uses files from the last `bdd` run).

### Step 1 - Detect project (or load baseline)

Run `analyze` mode if no baseline exists in `.agent-cache/`. Use the cached baseline if available.

### Step 2 - Read the feature files

Read all specified `.feature` files. For each unimplemented step pattern:
- Check the existing step catalog for an existing implementation
- If found: mark as "reuse existing" and output the existing step pattern for reference
- If not found: add to "needs implementation" list

### Step 3 - Generate step def code

For each step pattern that needs implementation, generate code following these rules:

---

**Rule 1:** Output valid `{framework} {language}` code only - no Markdown fences, no explanations.

**Rule 2:** Follow the exact coding style and import patterns from the existing step files in the repo.

**Rule 3:** Reuse existing Page Object methods and locators where possible.

**Rule 4:** For any UI locator that does not exist in provided Page Objects, add: `// MISSING_LOCATOR: <descriptive name>`

**Rule 5:** Do not re-implement steps that are already implemented.

**Rule 6:** Each step function must be exported and follow the framework's step registration pattern.

**Rule 7 - PARAMETERIZATION REQUIRED:**
Never hardcode a value that varies across scenarios into a step pattern. Use Cucumber expression types:
- `{string}` for any quoted value (field names, IDs, labels, URLs, states, conditions)
- `{int}` for integer counts or status codes
- `{float}` for decimal values
- `{word}` for single unquoted tokens

**Anti-patterns (FORBIDDEN):**

```
FIELD NAME HARDCODED
WRONG: Then('the achievements field value is not null', ...)
RIGHT: Then('the {string} field value is not {word} in the response', ..., fieldName, condition)

NULL/UNDEFINED/ABSENT CONDITION HARDCODED
WRONG: Then('the achievements field value is not null', ...)
RIGHT: Then('the {string} field value is not {word} in the response', ..., fieldName, condition)

MATCH MODE HARDCODED
WRONG: Then('the achievements array contains badge ID {string}', ...)
RIGHT: Then('the {string} array {string} item {string}', ..., arrayField, matchMode, value)

HTTP VERB HARDCODED
WRONG: Given('the GET {string} endpoint is configured to return status {int}', ...)
RIGHT: Given('the {string} {string} endpoint is configured to return status {int}', ..., verb, path)

RAW URL PATH IN PATTERN (a '/' is Cucumber-expression ALTERNATION - a literal path BREAKS parsing)
WRONG: Given('the GET /challenges/meta/daily endpoint returns a challenge with tag {string}', ...)
RIGHT: Given('the {string} {string} endpoint returns a challenge with tag {string}', ..., verb, path, tag)
Never bake a literal URL/path (or any '/') into a step pattern - parameterize the path as {string}.

REAL ROUTES ONLY: an HTTP step's endpoint (in the step BODY / test data) MUST be a real route the app exposes -
read the app's route table (Express `router.*` + `app.use` mounts, Spring/FastAPI/etc. annotations) and use
its exact METHOD+path INCLUDING any mount prefix (e.g. `POST /api/auth/register`, never a guessed
`POST /api/users` and never dropping the `/api` prefix - a path missing the prefix hits the dev server's SPA
fallback and returns HTML, not JSON). If no route fits the step's intent, mark it `// MISSING_ROUTE: <intent>`
rather than inventing one.

REAL INTERFACE GROUNDING (auth, state, data): bind generated tests to the app's REAL contract, not conventions.
- REUSED STEPS ARE CANDIDATES, NOT GUARANTEES: a pre-existing/library step (e.g. a generic `I register`) may
  target the wrong endpoint, omit a required field, or read the wrong token field for THIS app. Verify it
  against the app's real routes/contract before reusing; if it does not fit, generate a grounded replacement
  rather than trusting it. For auth specifically, confirm the register/login endpoint + body + token field
  actually work (exercise them if you can) - do not assume a shared auth step is correct.
- AUTH: use the app's real auth endpoints and body shape (e.g. register needs username + email + password,
  password >= 8), not a generic `POST /api/users {username,password}`. Prefer REGISTER-FIRST (create a unique
  user, then reuse its returned token) so no pre-seeded account is required; if the step supplies only a
  username, derive a unique email (`<username>@example.com`) and a compliant password.
- AUTH ROUTES CARRY CREDENTIALS ONLY - never a domain action. A `POST` to the login/register route carries
  ONLY username/password (register also email). A domain action such as a challenge SUBMISSION posts its
  payload (`{prompt}`/`{solution}`) to the ACTION route (e.g. `POST /api/challenges/{id}/submit`, after
  obtaining an id), NEVER to `/api/auth/login` - the auth route ignores a `{prompt}` body and 400s. Bind every
  action step to the route that implements it, per the app's real route list.
- DUAL TEST-USER MODEL (when a populated test user is available): drive auth scenarios with ONE parameterized
  step `Given I am logged in as {string}` and TWO personas - "a new user" (a FRESH zero-data account for
  empty-state / registration / generic logged-in ACs; assert empty achievements, xp 0) and "the existing user"
  (a PRE-SEEDED account WITH sample data for data-dependent ACs; assert against its REAL data, which you should
  read from the app's GET endpoints before authoring). Register the fresh user ONCE per run (a BeforeAll /
  global-setup style hook), reuse it across scenarios, and DELETE ONLY that fresh user after the whole run (via
  a self-delete route if the app has one); never delete the pre-seeded user. A scenario contrasting the two uses
  a Scenario Outline over the persona. When NO populated test user is available, use ONLY "a new user" - never
  emit `"the existing user"` steps you cannot authenticate (they hard-fail on missing credentials).
- FAIL-FAST the auth setup: the fresh-user register/global-setup hook should VERIFY the register -> login ->
  token round-trip and FAIL LOUDLY (with the HTTP status + response body) when the app does not return a token,
  so a mis-started or misconfigured app (e.g. a 5xx from a missing signing secret) aborts the run with one clear
  message instead of every scenario failing its login precondition with no diagnostics.
- STATE/TOKEN: store and read the auth token in the target framework's REAL shared-state field (e.g.
  `state.token` - the field its request helper + "I am authenticated" check use), never an invented
  `state.authToken`/`accessToken`/`jwt`.
- DATA VALUES: path params and example ids/slugs/enums MUST be REAL values the app defines (read its data
  files / enums, e.g. a category slug `whisperer`), never invented (`norse-basics` -> empty result).
- NO PLACEHOLDERS: a regular Scenario must carry concrete literals - never leave a `{name}` or `<name>` token
  in step text/arguments (e.g. never a bare `"{username}"`); reserve `<...>` for Scenario Outline + Examples.
- PAGE ROUTES + UI NAMES (frontend): a browser-navigation step's URL MUST be a real FRONTEND page route (`/`,
  `/login`, `/dashboard`), read from the app's router - NEVER a backend `/api/...` endpoint (those are for
  API-request steps; a browser cannot navigate to an API path). Navigate to the page THIS journey is about
  (match its title/ACs to a route); do NOT default every FE scenario to `/login` - use `/login` only for a
  login-specific scenario, and `/` (never `/login`) when unsure. Element/component names in visibility/click
  steps MUST be REAL names from the app's rendered DOM (a component name, or a real heading / button / link /
  label text) - do not invent one, and NEVER use a DESIGN-SPEC / Figma node name (e.g. "Login Card", "CTA
  Primary", "Ghost Button", "Gjallarhorn (12% teaser)") that has no DOM counterpart, nor a name that
  contradicts the journey (e.g. no "Register Card" on a login page). If you only have design labels, assert the
  real on-page heading/button text instead.
- BROWSER STORAGE NEEDS AN ORIGIN: a step that reads/writes localStorage/sessionStorage/cookies must FIRST
  navigate to the app origin - web storage on a blank page (`about:blank`) throws `SecurityError`. Navigate,
  set/read storage, then reload if the app must re-read it.

PAGE CONTEXT IN RUNTIME ASSERTIONS
WRONG: Then('no JavaScript runtime error is thrown on the Dashboard', ...)
RIGHT: Then('no JavaScript runtime error is thrown', ...)

COMPONENT STATE VERB HARDCODED (renders / loads / is visible - all mean the same)
WRONG: When('the hero section renders', ...)  WRONG: When('the hero section is loaded', ...)
RIGHT: When('the hero section is visible', ...)

POLARITY AS SEPARATE FILES - use one step with state parameter
WRONG: Then('the BadgeUnlockModal is open', ...) [separate file from the negative form]
RIGHT: Then('the {string} modal is {word}', ..., modalName, state)

MODAL VERB SYNONYMS - pick one canonical verb (visible)
WRONG: Then('the ExplanationModal is displayed', ...)  WRONG: Then('the ExplanationModal is open', ...)
RIGHT: Then('the {string} modal is visible', ..., modalName)

LOCK STATE HARDCODED
WRONG: When('the user clicks the locked ChallengeCard for {string}', ...)
RIGHT: When('the user clicks the {word} ChallengeCard for {string}', ..., lockState, title)

ELEMENT + SURFACE BOTH HARDCODED
WRONG: Then('the email field is visible on the Register Card', ...)
RIGHT: Then('the {string} is visible on the {string}', ..., element, surface)

ASSERTION VERB SYNONYMS
WRONG: Then('the breadcrumb displays {string}', ...)  WRONG: Then('the breadcrumb reads {string}', ...)
RIGHT: Then('the breadcrumb shows {string}', ..., text)

ACTION CONTEXT IN CONSOLE-ERROR ASSERTION
WRONG: Then('no JavaScript console errors are recorded during render', ...)
RIGHT: Then('no JavaScript console errors are recorded', ...)

STORAGE KEY STATE SYNONYMS
WRONG: Then('the localStorage key {string} is not present', ...)
RIGHT: Then('the localStorage key {string} is absent', ..., key)

ORDINAL + VALUE HARDCODED
WRONG: Then('the leaderboard row ranked 1st has gold medal styling applied', ...)
RIGHT: Then('the leaderboard row ranked {int} has {string} medal styling applied', ..., rank, tier)

STEP NUMBER HARDCODED
WRONG: And('Step 1 is visible with a description referencing picking a challenge', ...)
RIGHT: And('Step {int} is visible with a Circle, Number {string}, a title, and a description referencing {string}', ...)
```

**Universal pattern mandatory implementations:**

```
NAVIGATION
When('I navigate to {string}', async (url: string) => {
  const page = getPage();
  await page.goto(url);
  await page.waitForLoadState('networkidle');
  await expect(page).toHaveURL(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
})
ONE file covers all navigation. networkidle wait + URL assertion always included.

REDIRECT ASSERTION (click-triggered, not explicit goto)
Then('the browser is redirected to {string}', async (url: string) => {
  const page = getPage();
  await page.waitForURL(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout: 5000 });
  await expect(page).toHaveURL(new RegExp(url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
})

ELEMENT VISIBILITY
Then('the {string} is {word}', async (name: string, state: string) => {
  // Resolve accessibility-first so it works on apps WITHOUT data-testids: testid, then role
  // (button/link/heading) or visible text by accessible name; class/id only for a valid CSS identifier.
  let locator = page.locator(`[data-testid="${name}"]`)
    .or(page.getByRole('button', { name }))
    .or(page.getByRole('link', { name }))
    .or(page.getByRole('heading', { name }))
    .or(page.getByText(name, { exact: false }));
  if (/^[A-Za-z_][\w-]*$/.test(name)) locator = locator.or(page.locator(`.${name}, #${name}`));
  const target = locator.first();
  if (state === 'visible') await expect(target).toBeVisible();
  else await expect(target).toBeHidden();
})
ONE file with {word} state parameter replaces all 'is visible' + 'is hidden' variants. Do NOT use a
testid/class-only selector - on an app with no data-testid it matches nothing; always include the role/text
accessible-name fallback. Also: a page/route NAME (Login, Register) is not a DOM element - assert real
on-page text/leaf components, never the page name.

AUTHENTICATION
Given('I am logged in as the test user', async function () {
  // TODO: adapt to your project's auth endpoint and credential fixture
  // Body: POST to your auth endpoint, store the returned JWT in the appropriate localStorage key
  // Example pattern (project-specific implementation required):
  // const resp = await request.post('/api/auth/login', { data: credentials });
  // const { token } = await resp.json();
  // await page.evaluate((t) => localStorage.setItem('YOUR_TOKEN_KEY', t), token);
})
ONE file. All authenticated scenarios use this step in Background.
```

**Rule 8:** Prefer one broad parameterized step over N narrow single-use steps.

**Rule 8b - COLLAPSE DATATYPE ADJECTIVES:** `a boolean field {string}` / `an integer field {string}` / `a string field {string}` are the same assertion with a different type check. Emit ONE step `a(n) {word} field {string}` and branch on the type token in the body (`integer` -> `Number.isInteger`; `number` -> `typeof === 'number'`; else `typeof === type`). Never write separate Boolean/Integer/String files. A numeric-bound variant (`... field {string} between {int} and {int}`) carries extra params and stays its own step. A concrete feature line (`... a boolean field "x"`) still matches the parameterized expression, so feature files are not rewritten.

**Rule 8c - STEP CONSOLIDATION PATTERN CATALOG (P1-P16):** emit ONE parameterized step (a `/regex/` step when polarity or optional clauses apply), never a new file per variant. P1 numeric-suffix exact dups -> one file; P2 keyword-only collisions (Given vs When) -> register once; P3 polarity (X/no X/not X/equals/contains) -> verb capture + branch; P4 numeric literal in the phrase (30, all 17, 1st, 0%) -> `{int}`; P5 datatype (a boolean/integer/string field) -> `a(n) {word} field`; P6 thing-noun (object/entry, box/object, Cli/Sdk) -> `{word}`; P7 enum/style/tier/ordinal/language-as-file -> value/`{word}`; P8 property-name baked in the phrase -> `{string}`; P9 count/quantifier (exactly/at least/at most/only/all N) -> comparator `{word}` + `{int}`; P10 value present/absent -> `(contains|does not contain) {string}` (substring on the serialized body); P11 configure/stub a service to return status/network/delay -> endpoint + `{word}` kind; P12 no-client-error family (runtime/JS/console/crash) -> one DOM-absence step + one collected-errors step; P13 attribute-accretion fixtures -> one `Given('... exists with:', DataTable)`; P14 optional trailing clause -> `(...)`/`(?:...)?`; P15 verb synonyms (renders/is loaded/is visible) -> one canonical verb; P16 a/an grammar split -> `an?`.

**Rule 8d - SHARED STEP LIBRARY (bdd + e2e = ONE vocabulary):** emit exactly ONE step-def per canonical step into a style-agnostic `step-defs/<subdir>/` path (no `bdd/`|`e2e/` segment); both bdd and e2e feature files bind to it by step text. NEVER emit a per-style twin - the target runner loads a single step world, so the same pattern under both `bdd/` and `e2e/` is an ambiguous/duplicate step-definition error. Compose the BDD scenarios first, then compose E2E REUSING the BDD step phrasings: an E2E scenario is a BROADER multi-page / multi-API user journey assembled from the shared steps, not a re-worded per-API twin. Introduce a new step only when no shared step expresses the action.

**Rule 9 - CATEGORY TAG REQUIRED:**
Every generated step-def file must carry a two-tag category comment at the top:
```
// @functional @frontend      (user-observable behavior, browser state)
// @functional @backend       (business rule, HTTP/DB assertion)
// @nonfunctional @frontend   (quality gate: console errors, CSS, accessibility)
// @nonfunctional @backend    (quality gate: service latency, security headers)
```

**Rule 10 - CANONICAL VERB ENFORCEMENT:**
- `renders` | `is loaded` | `is inspected` | `is displayed` -> `is visible`
- `is open` | `is shown` -> `is visible`
- `shows` | `reads` | `displays` (text assertion) -> `shows`
- `is not present` | `is cleared` | `is removed` (localStorage) -> `is absent`
- Page name outside `{}` (Dashboard, Profile, Landing) in assertion step -> redesign
- "the X page finishes loading" -> use `When I navigate to {string}` instead
- Phrases like "during render", "on the Dashboard" appended to assertion steps -> strip them

**Rule 11:** Use `{language}` idioms, conventions, and syntax throughout.

**Rule 12:** If a target filename is provided, derive the class name from it (e.g. `AddProductStepDefs.java` -> class `AddProductStepDefs`). Apply the framework's package/namespace conventions.

### Framework-specific rules

**playwright-bdd (detected when `createBdd` imports found in existing step files):**
```typescript
// Import block at top of every new step file:
import { createBdd } from 'playwright-bdd';
import { test } from '../bdd-steps/bdd';
// Step registration via destructured helpers (NOT @Given/@When/@Then decorators, NOT test() blocks):
const { Given, When, Then } = createBdd(test);
// createBdd has no And/But; alias them (step matching is keyword-agnostic) so continuation steps register:
const And = Given, But = Given;
// Fixture parameter is a destructured ScenarioState - pick only what you need:
When('I do X with {string}', async ({ page, baseUrl }: ScenarioState, value: string) => { ... });
Then('the response status is {int}', async ({ lastResponse }: ScenarioState, code: number) => { ... });
// Available fixtures: page, request, token, stash, lastResponse, baseUrl, beUrl, wsUrl
// Output file: test/bdd-steps/{domain}.steps.ts
// Do NOT export classes or use default exports (steps self-register via createBdd)
```

**Cucumber-JVM (Java/Kotlin):**
- `@Given/@When/@Then` annotations
- Class per domain, `.java`/`.kt` extension
- `@CucumberOptions` in runner class

**SpecFlow (.NET/C#):**
- `[Given]/[When]/[Then]` attributes
- `.cs` extension

**behave (Python):**
- `@given/@when/@then` decorators
- `context` object
- `.py` extension

**Layer constraint (if user specified):**
- `frontend`: Playwright browser step defs only; no HTTP clients
- `backend`: HTTP step defs only; no browser page interactions

### Seam & mock fidelity (bind generated test code to the REAL code, never an imagined one)

Generated test/step code must bind to the code that actually exists - never to an invented seam. These rules
apply to any generated test code and especially to jest/TS targets:

- **Ground on the real module when it EXISTS (read the code BEFORE you generate).** Spec-only red-first is for
  behavior that does not exist yet. When the unit's target module is ALREADY present in the workspace, OPEN it
  first and read its REAL interface - the exact exported names, each signature (arg list + sync/async), the
  top-level shape each returns, the HTTP route table it registers (`METHOD path` from `router.<verb>('/path',...)`),
  and the collaborators it actually imports (with their member names). Generate the test against THAT: target the
  real exports/endpoints, mock ONLY those real collaborators at their real members, assert only behavior the code
  actually has. Do NOT invent an export name (`evaluate` when the real one is `checkAchievements`), a collaborator
  (a `userStore` the module never imports), a persistence step, or async the code does not do. If a spec behavior
  has no matching real export, skip it (`// RED: not in module interface`) and cover it in its real unit (route
  handler / BDD) - never fabricate it. Keep the spec-only red-first path ONLY when the module is absent. This is
  the PRIMARY defence against interface invention; the retarget / mock-fidelity bullets below are the
  execution-time safety net for anything that slips through.
- **Map spec behavior to the real function by PURPOSE, not just name.** Read each export's JSDoc / leading
  comment (or infer its purpose from the function body) so you can match the behavior you need to test ("get user
  info") to the export whose purpose fits (`getUser`) even when the names diverge - do NOT rename the real export
  to match the spec. When several exports share a role, the purpose disambiguates which one to target.
- **Target the REAL structure, not an assumed layout.** Do not assume an endpoint lives at `routes/<name>.js`
  or that one Figma file is one component. Find where each endpoint is REALLY registered (an inline `app.<verb>`
  in the entry file vs a router mounted via `app.use('/prefix', router)`) and mount only a real, importable
  router at its real prefix; an inline entry endpoint is integration/BDD, not a unit (never `app.use(path,
  undefined)`). For UI, target the app's REAL components (Navbar/Landing/ChallengeCard/...) - split an aggregate
  design-library file across the real components it maps to; a screen-level aggregate with no single component is
  E2E/BDD. Mock a central `api` object at its REAL namespaced shape (`api.challenges.get`), never invented flat
  functions. When a behavior belongs to another module, skip it with a `// DEFERRED-TO: <module>` marker (keep the
  AC id in the title) so it merges to that module's real result instead of a dead-end skip.
- **Match the real DATA SHAPE + persistence envelope, not just the interface (read the SUT body).** Grounding the
  names is not enough - fabricated fixtures that violate the code's invariants still fail. (a) ENTITY-SHAPE
  FIDELITY: a fixture must carry every field the SUT DEREFERENCES, initialized as the code assumes - if the SUT
  does `user.progress[cat]`, the user fixture MUST include `progress: {}` (mirror the real create/registration
  path); never invent a field the SUT never uses (a bogus `level`). Put the full real shape in a shared `makeX()`
  helper. (b) PERSISTENCE ENVELOPE: the envelope belongs to whoever the real code shows owns it - if the writer
  persists its argument VERBATIM (the reader round-trips the whole object), the CALLER passes the full wrapper
  (`writeUsers({ users: map })`, as real callers do: `const db = readUsers(); db.users[id]=...; writeUsers(db)`)
  and reads back `readUsers().users`; only a writer that itself wraps at a key takes the bare map - do not assume.
  For CRUD stores, prefer arranging/verifying through the SUT entity ops (`save`/`getById`/`getAll`) over
  hand-driving the raw whole-store writer/reader pair.
- **Model a store with generic ops only (generation-time layering).** Before you even pick a unit's surface: a
  persistence store/repository (`*Store`/`*Repository`/`*Dao`/`*Model`) is modeled with ONLY generic persistence
  operations (read/write, get-by-id, update, save, delete, list). Entity-lifecycle + auth behavior - create-user
  (id/uuid + password hashing), `getByUsername`/`getByEmail` or any non-primary-key lookup, register/login/
  authenticate - is realized in the ROUTE HANDLER: cover it with an HTTP-contract / BDD scenario, NOT a store unit
  test. Do not assign `POST /api/auth/*` (register/login) ACs to a store module.
- **Real exports + seam.** Import only functions the module actually exports; do not invent a repository/CRUD
  contract (`getAll/getById/getByUsername/create/update/save`), a function decomposition (splitting one real
  function into two), a synthetic parameter DTO, its data shape, or cross-function invariants. If the AC's
  behavior lives in a different unit (a route handler, a sibling module), test it THERE (an HTTP-contract /
  BDD scenario), not against an imagined helper.
- **Retarget an imagined name onto the real member (same behavior, different name/shape).** When the module DOES
  implement the behavior under a different export name or return shape, bind to the REAL member instead of
  inventing one. Match by ROLE (read/list -> the collection reader; get/getBy-id -> the by-key getter;
  update/patch -> the updater; create/add -> the creator; save/write -> the writer; evaluate/check/compute/assess
  -> the derive-a-result op, e.g. `evaluate` -> the real `checkAchievements` on the same entity noun - a 1:1
  synonym rename, never a composition) when its entity noun matches the module (e.g. `user` from `userStore`,
  `achievement` from `achievements`), and adapt the SHAPE at the seam by UNWRAPPING a reader wrapper only
  (`getAll()` -> `readUsers().users`), dropping `await` when the real member is sync. You MAY rewire the called
  name inside an `expect(...)` (e.g. `getById(id)` -> `getUser(id)`), but NEVER change the matcher or expected
  value to force a pass. Do NOT retarget a single-element create/save/delete onto a whole-collection writer
  (`save(x)` -> `writeUsers({ users: x })` corrupts, and composing a read-modify-write invents a member the unit
  lacks): if NO real export plays the role as a 1:1 rename/unwrap (`getByUsername`/`create`/`save`/`delete` with
  no counterpart), leave it a phantom red and cover that behavior in its real unit (route handler / BDD) - never
  fabricate or compose the member.
- **Mock only real collaborators, at the real shape.** Mock the collaborators the code actually imports - not
  a non-dependency (a virtual mock of a non-dependency is a silent no-op), and never leave the real
  collaborator unmocked. Mirror the member shape (e.g. sync `fs.*Sync` vs async `fs.promises.*`).
- **External-package mocks: target the exact specifier the code imports.** Mock a real SDK/package by the name
  the SUT actually imports (`jest.mock('@anthropic-ai/sdk')`), not a guessed alias (`jest.mock('anthropic')`) -
  a wrong/uninstalled name fails suite load with "Cannot find module". If a mock names a package that is not
  installed and not imported by the code under test, repoint it to the SUT's real dependency (its single
  external import, or the closest-named when several). This is a mock-wiring repoint - never touch assertions,
  never fabricate a pass.
- **Async vs sync mock signature (jest).** Default a collaborator mock to a SYNC return (`mockReturnValue`) -
  a plain value is transparently awaitable; use `mockResolvedValue`/`mockRejectedValue` only when the real
  collaborator is async. A Promise where the code expects a sync value silently corrupts the unit. A `*Sync`
  collaborator (`fs.readFileSync`, `existsSync`, ...) is ALWAYS sync - never seed it with `mockResolvedValue`,
  and never mix channels on one mock var (`mockReturnValueOnce(...).mockResolvedValueOnce(...)`).
- **Assertion sync/async fidelity (jest).** Same rule on the SUT-CALL side: a Promise-only matcher
  (`.resolves`/`.rejects`) on a SYNCHRONOUS call fails at runtime ("received value must be a promise") even when
  the behaviour is correct. Use `.resolves`/`.rejects` ONLY when the target is explicitly async (its real
  signature is `async`, or a contract types it so). For a sync-or-unknown target: assert the value with
  `expect(await fn(args)).toEqual(x)` (await of a sync value is harmless), and use `expect(() => fn(args)).toThrow()`
  / `.not.toThrow()` for throw/no-throw; only when async-ness is genuinely unknown and you need reject semantics,
  wrap universally: `await expect((async () => fn(args))()).rejects.toThrow()`. NEVER write
  `.resolves.toThrow()`/`.resolves.not.toThrow()` (a resolved value cannot "throw" - use the sync form).
- **Async emitter/stream seam timing (jest).** Mock a spawn/exec/fork child (or any EventEmitter/stream that
  emits on a microtask/timer) LAZILY - `mock.mockImplementation(() => makeFakeChild(...))`, NEVER eagerly
  `mock.mockReturnValue(makeFakeChild(...))`. Eager construction schedules the fake's `stdout` emit before the
  SUT (which attaches `.on('data')/.on('close')` only AFTER an await, e.g. `fs.promises.mkdtemp`) can subscribe,
  and a naive fake (unlike a real paused Node stream) drops the un-listened event -> stdout arrives empty and
  `JSON.parse('')` throws. Also make the fake BUFFER `data` and flush it on the first `.on('data')`, emitting
  `close`/`end` only after the data.
- **Delegating-factory mock access (jest).** When the store/fs mock uses the hoisting-safe delegating factory
  (arrows to module-scope `mock*` fns), configure and inspect ONLY those `mock*` fns
  (`mockExistsSync.mockReturnValue(true)`, `mockWriteFileSync.mock.calls`) - NEVER a member of the required
  module (`require('fs').existsSync.mockReturnValue(...)` is a plain arrow, not a `jest.fn` -> TypeError at setup).
- **Serialized-fixture envelope fidelity (jest).** When you seed a reader/parse mock (e.g. `fs.readFileSync`)
  with a serialized store, wrap the fixture in the SAME top-level envelope the code round-trips - the shape the
  paired writer emits (`writeUsers(db)` -> `{ users: db }`) and the reader unwraps (`readUsers().users`). If the
  code reads `read(...).<key>`, seed `{ <key>: <data> }`, never the bare `<data>`: a flat fixture makes `.<key>`
  undefined and the assertion receives `undefined`. The reader is correct; only the fixture shape is wrong.
- **Serialized-write envelope symmetry (jest).** The write-side companion: assert on a CAPTURED write payload
  through the same envelope the write produces. If the write wraps at a key (`writeUsers({ users: x })` or the
  writer emits `{ users: db }`), the captured JSON is `{ users: ... }` - assert `written.users[entry]`, never a
  flat `written[entry]` (undefined), and pass the wrapper the FULL `users` map, not a single entry object.
  Advisory only: this touches the asserted subject and test data, so surface it - never rewrite an assertion.
- **Mock-factory TDZ safety (jest).** A `jest.mock` factory is hoisted above imports and fires during the SUT
  import; its returned object MUST NOT read a module-scope `const`/`let` directly (`default: mockCtor`) - that
  TDZ-crashes the WHOLE suite on load. Define the mock INLINE in the factory, or defer the read behind a
  regular function (`default: function (...a) { return mockCtor(...a); }`).
- **Never fabricate a pass, never edit assertions to force green.** If the code deliberately does not
  implement an asserted contract (e.g. returns a graceful fallback where the test expects a throw), leave the
  assertion and flag the spec-vs-code gap - it is a human AC-vs-code decision, not a silent edit. Do not add
  or modify application source to satisfy a generated test.
- **CRUD lifecycle via a stateful in-memory fake (state-managing units only).** For a store/repository/CRUD
  service backed by fs/db, do NOT hand-craft static fixtures. Mock the persistence collaborator ONCE as a
  STATEFUL fake over a module-scope backing var (write stores what the SUT writes; read returns it; absent ->
  the real not-found error), reset the var (not the mock identity) in `beforeEach`. HOISTING SAFETY: jest hoists
  the `jest.mock()` factory and forbids non-`mock`-prefixed out-of-scope refs, so NAME the backing var
  `mock`-prefixed (`mockStore`) and keep the factory a thin delegator to `mock*` fns
  (`readFileSync: (...a) => mockReadFileSync(...a)`) with the stateful logic in `beforeEach` - never reference the
  backing var inside the factory (else "module factory ... not allowed to reference out-of-scope variables"). Arrange by CREATING through
  the SUT with RANDOMIZED data (inline `randomId()`/`randomName()`/... helpers, every free field randomized),
  then VERIFY by reading back through the SUT (create -> getById/getAll; update -> read; delete -> null), a real
  round-trip - so there is always fresh data to assert against and the SUT genuinely persists/mutates/removes it
  (never a false green). Run create -> act -> delete in order; error paths (delete/read a missing id, empty
  store) are the deliberate exception. Pure-function units keep classic AAA. The round-trip proves persistence, so
  do NOT also assert the persistence MECHANISM (which fs method, atomic write/fsync, mkdir) - those are impl
  guesses that break on sync/async/path divergence; and do NOT assume the store is async (fs stores are often
  synchronous - avoid `.resolves`/`.rejects` unless the contract types it async; wire the fake to both the sync
  and async seams). If the unit exposes only a whole-collection writer (`writeUsers(db)`) and NO single-element
  create, a fabricated `save(entity)`/`delete(id)` is NOT retargeted - never `writeUsers({ users: x })` (which
  corrupts the whole collection) and never a composed read-modify-write (which invents a member the unit lacks);
  leave it a phantom red routed to BDD.

### Step 4 - Validate and write

After generating all step defs:
1. Verify no step pattern is duplicated across files
2. Verify all Cucumber expression types are correct
3. Run a syntax check appropriate for the detected language:
   - TypeScript: note `tsc --noEmit` or `npm run typecheck` should be run
   - Java: note `mvn compile` should be run
   - C#: note `dotnet build` should be run
   - Python: note `python -m py_compile {file}` should be run

Write files to:
- playwright-bdd: `test/bdd-steps/{domain}.steps.ts`
- Other: `{stepDefsDir}/{domain}StepDefs.{ext}` using the detected step defs directory

Output the typecheck command as the last line of your response.

Record a [Work Log](#work-log-automatic) stage entry: new vs reused step-defs, with each new step-def's complexity tier tallied (reused contribute 0 effort).

---

## Mode: generate

Run the full pipeline: story -> analyze -> plan -> bdd -> steps -> coverage.

Execute each mode in sequence, using the output of each as input to the next:
1. Run `story` mode with the provided ADO URL
2. Run `analyze` mode on the provided `--repoPath` (defaults to current directory)
3. Run `plan` mode using the story data
4. Run `bdd` mode for each journey in the journey map
5. Run `steps` mode for each generated feature file
6. Run `coverage` mode to produce the AC traceability report

Optional flags (pass through to relevant modes):
- `--repoPath <path>` - target test repository path
- `--stepScope functional|nonfunctional|both` - scenario scope filter (default: both)
- `--testLayer frontend|backend|both` - layer filter (default: both)
- `--no-step-gen` - stop after bdd mode (don't generate step defs)
- `--fresh` - ignore any cached baseline
- `--no-work-log` - skip the [Work Log](#work-log-automatic)
- `--operator-name` / `--experience` / `--area` - operator identity for the work log

Accumulate every stage's [Work Log](#work-log-automatic) entry across the run and write ONE consolidated set: `artifacts/<storyId>-work-log-<run-id>.md` + `artifacts/work-log/<run-id>_<storyId>.{csv,json}`.

After completion, report:
- Number of feature files written
- Number of step def files written
- AC coverage summary (N covered / N partial / N missing out of M ACs)
- Paths of all artifacts created
- Any typecheck command to run
- Time-savings summary: estimated engineer effort (junior/medior/senior) vs tool wall-clock, and the work-log paths

---

## Mode: coverage

Report AC traceability: which acceptance criteria from the story context are covered, partially covered, missing, or over-specified in the generated feature files.

### Step 1 - Load the AC list

Read `artifacts/<storyId>_story-context.md` (written by `story` mode). Extract all AC IDs (`<storyId>-ac-<n>`) and their summary text.

If no story context file exists, ask the user for the story ID or a `--storyId` argument and look for the file, then stop with a helpful message if it is not found.

### Step 2 - Collect feature files

Scan `artifacts/` (or a `--featureDir <path>` override) for all `.feature` files. Grep each file for scenario-level tags using this pattern: `@AC_<n>` and `@AC_<n>_err`.

### Step 3 - Build traceability matrix

For each AC ID, collect:
- `happyScenarios` - scenario titles tagged `@AC_<n>` (without `_err`)
- `errorScenarios` - scenario titles tagged `@AC_<n>_err` OR carrying both `@AC_<n>` and `@inferred-negative`

### Step 4 - Classify each AC

| Status | Condition |
|---|---|
| `covered` | >= 1 happy scenario AND >= 1 error scenario |
| `partial` | >= 1 scenario total but missing either happy or error companion |
| `missing` | 0 scenarios carry this AC tag |
| `over-specified` | > 3 scenarios cover the same AC (duplication signal) |

### Step 5 - Write report

Write `artifacts/<storyId>-ac-coverage-report.md` with:
- Summary line: `covered N / partial N / missing N / over-specified N (total M ACs)`
- Table: AC ID | AC summary text | status | scenario titles
- For `missing` ACs: quote the original AC text as a prompt for follow-up `bdd` mode invocation
- For `over-specified` ACs: list the scenario titles and flag for deduplication review

Record a [Work Log](#work-log-automatic) stage entry: AC count classified.

---

## Mode: log

Render or re-render a run's [Work Log](#work-log-automatic) without regenerating tests. With no argument, summarize the most recent `artifacts/<storyId>-work-log-<run-id>.md`. Use this to review a prior run or to compose a log from stage entries recorded piecemeal across single-mode runs. See [Work log model](#work-log-model--template) for the estimation model and template.

---

## Mode: guided

Display a numbered menu and re-enter the chosen mode:

```
automation-agent-standalone - available modes:

  1. story <ado-url>  - Fetch ADO work item and extract acceptance criteria
  2. analyze          - Scan this repo: detect framework, language, step catalog
  3. plan             - Discover journeys from a story's acceptance criteria
  4. generate         - Full pipeline: story -> plan -> BDD features -> step defs -> AC coverage
  5. bdd              - BDD feature files only (provide requirements or story URL)
  6. steps            - Step definitions for existing .feature files
  7. coverage         - AC traceability report: which ACs are covered/missing in generated feature files
  8. log              - Work log + time-savings estimate for a run

Which mode? (enter number or keyword)
```

After the user selects, re-invoke the corresponding mode.

---

## Rules

- Never mention internal implementation details (MCP, LLM provider names, SDK imports)
- Do not auto-chain modes (never auto-run `steps` after `bdd` without asking)
- Output: artifact paths, counts, and the typecheck command. No narration.
- If `AZURE_DEVOPS_PAT` is not set when running `story` or `generate`, stop and tell the user how to set it.
- `@inferred-negative` companions do NOT count against the AC coverage invariant.
- When the AC coverage invariant is violated (missing or duplicated AC), fix the output before writing.
- Always write a per-run [Work Log](#work-log-automatic) (unique file, never overwrite) unless `--no-work-log`; present the engineer-time estimate as a planning figure, not a measured benchmark.

---

## Work log model & template

The operator-identity resolution, estimation model, timing snippets, output template, and PowerBI export schema for the [Work Log](#work-log-automatic). The estimate is a planning figure from published authoring baselines, not a controlled benchmark. Record the caveat in every log: tool wall-clock includes interactive latency; the engineer figure is independent work-effort, not a measured race.

### Operator identity (ask once, then persist)

Resolve `<OperatorName>` / `<ExperienceLevel>` (`junior|medior|senior`) / `<Area>`, first hit wins: (1) flags `--operator-name`/`--experience`/`--area`; (2) user file `~/.claude/bdd-authoring-operator.json` = `{ "name","experienceLevel","area" }`; (3) ask once, validate the level, then write the file. Flags override the file for this run but do NOT rewrite it. Skip entirely under `--no-work-log`.
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

**Artifact complexity weight** (Moderate = 1.0); classify each scenario / step-def (and, when a clear signal exists, each AC / journey) as it is composed:

| Tier | Weight | Scenario signals | Step-def signals |
|------|--------|------------------|------------------|
| Simple | 0.5 | <=6 steps; one status / single-field assertion; no data table; no outline | single client call or one equality assertion; reuses an existing helper |
| Moderate | 1.0 | 6-12 steps; a few assertions; <=1 precondition/fixture | a couple of operations; some param handling |
| Complex | 2.5 | >12 steps, or multi-field / collection / nested assertions, or `Scenario Outline` with multiple `Examples`, or multiple preconditions / cross-entity setup | stream/filter/map over collections, multi-field or nested assertions, multiple mocked collaborators, or a new helper/util is required |

Default an artifact to Moderate when no clear signal. Reused step-defs never contribute.

**Repo complexity** (weights `analyze` only; from signals `analyze` already collects - file/LOC counts, detected stack, step-catalog size, monorepo detection). `repoComplexity = sizeFactor x techFactor x monorepoFactor`:

| Factor | Values |
|--------|--------|
| sizeFactor (test+source subtree) | Small `<~50 files / <~5k LOC` = 0.5; Moderate `~50-300 / ~5k-30k` = 1.0; Large `>~300 / >~30k` = 2.0 |
| techFactor (readability of detected stack) | conventional (Java Cucumber-JVM, C# SpecFlow, Python behave, TS playwright-bdd) = 1.0; Karate (dense DSL, embedded JS, orchestration) = 1.4; mixed / unknown = 1.3 |
| monorepoFactor | single repo = 1.0; monorepo with API-surface + orphan reconciliation = 1.25 |

**Formula** (per experience level `E`):
```
perArtifact = Sum over ACs, journeys, scenarios, new step-defs of  baseMin(stage) x weight(artifact)
perRun      = 60 x repoComplexity            (analyze; omit if analyze did not run)
            + 20 + 2 x acCount               (coverage; omit if coverage did not run)
effort(E)   = experienceMult(E) x (perArtifact + perRun)
saved(E)    = effort(E) - toolWallClock ;  speedUp(E) = effort(E) / toolWallClock
```

### Output template (human `.md`)

Write to `artifacts/<storyId>-work-log-<run-id>.md`. Keep the section order.
```markdown
# Work Log - <storyId> - <run-id>

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
Baselines: ~10 min/manual test case; 1.5-2.5 h (avg 2.0) per automated test-case-point; QA spends 30-45% of a sprint authoring/maintaining tests. Weights applied - complexity: simple 0.5 / moderate 1.0 / complex 2.5; experience: junior 1.6 / medior 1.0 / senior 0.6; repo complexity: size <s> x tech <t> x monorepo <m>. Planning estimate, not a controlled benchmark; tool wall-clock includes interactive latency.
```

### PowerBI export (CSV + JSON per run)

Alongside the `.md`, write `artifacts/work-log/<run-id>_<storyId>.csv` and `.json` into ONE central folder for PowerBI `Get Data -> Folder -> Combine`. Unique per run, never overwritten.

CSV = one row per STAGE, NO total row (PowerBI aggregates); stable header; `run_date` as `yyyy-MM-dd`; effort/saved numeric minutes, tool as seconds; quote free-text and double embedded quotes:
```csv
run_id,run_date,operator_name,experience_level,area,story_id,story_title,mode,stage,work_achieved,units,unit_count,complexity_simple,complexity_moderate,complexity_complex,repo_complexity,tool_seconds,eng_junior_min,eng_medior_min,eng_senior_min,saved_junior_min,saved_medior_min,saved_senior_min
20260717-1_12345,2026-07-17,Zoltan,medior,Care,12345,"Login flow",generate,bdd,"16 scenarios across 3 features",scenarios,16,6,8,2,,120,384,240,144,382,238,142
```
(`repo_complexity` blank except on the `analyze` row.)

JSON = one run object:
```json
{ "runId":"20260717-1_12345","runDate":"2026-07-17","mode":"generate",
  "operator":{"name":"Zoltan","experienceLevel":"medior","area":"Care"},
  "story":{"id":"12345","title":"Login flow"},
  "stages":[{"stage":"bdd","units":"scenarios","unitCount":16,
    "complexity":{"simple":6,"moderate":8,"complex":2},"repoComplexity":null,
    "toolSeconds":120,"engJuniorMin":384,"engMediorMin":240,"engSeniorMin":144,
    "savedJuniorMin":382,"savedMediorMin":238,"savedSeniorMin":142}],
  "totals":{"toolSeconds":0,"engJuniorMin":0,"engMediorMin":0,"engSeniorMin":0} }
```
Load: PowerBI Get Data -> Folder -> the `work-log/` folder -> Combine; set `run_date` to Date and effort/saved/tool to whole number; each stage row is a fact; operator_name / area / experience_level / stage / mode / story_id are the dimensions. New runs = new files; Refresh.
