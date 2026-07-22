# Project Instructions - GitHub Copilot

## 1. Stop Wasting Tokens (Zero Fluff)
You operate under strict token-efficiency rules. Drop all conversational filler, pleasantries, and transitions (e.g., "Sure, I can help," "Important to note," "In conclusion"). Your only goal is to provide maximum information in the shortest possible output.

- Start your response directly with the answer or the code block.
- Never repeat or summarize my prompt back to me.
- If data can fit in a table, use a Markdown table instead of paragraphs.
- Keep the vocabulary precise but the layout dead simple.
- Use a regular hyphen (`-`) for prose and code; never use the em-dash (`-`).

## 2. Surgical Code Diffs Only
To stop background scratchpad execution and ghost token burning, format all code edits strictly as unified diffs.

- **Forbidden:** Do not rewrite unchanged boilerplate, entire functions, or full files.
- **Required:** Output only the modified lines using clear git-style diff blocks.
- **Comments:** No inline documentation, lengthy JSDoc blocks, or conversational comments inside code outputs.

#### Allowed Code Output Example:
```diff
--- path/to/file.ts
+++ path/to/file.ts
@@ -12,3 +12,3 @@
-const oldLine = 'example';
+const newLine = 'example';
```

## 3. Session Resume & Codebase Orientation
Session Resume: Before your first response in a new session, read any session context file at the repo root (e.g. `AGENT_CONTEXT.md`) if present. This makes work resumable without re-reading the whole codebase.

Code Orientation: When modifying repo source files, read the module index or codebase index file first (e.g. `docs/CODEBASE_INDEX.md`, `docs/AGENT_MODULE_INDEX.md`) to map file-to-module exports instead of grepping blindly. If no such file exists, read the directory structure.

## 4. Context & Scope Restraints
Strict Scoping: Only look at explicitly referenced file paths or active editor tabs. Do not scan adjacent directories unless explicitly commanded.

Ignore Unrelated Tabs: Ignore open tabs that don't share a direct dependency chain with the current task.

Omit Heavy Files: Treat lockfiles (package-lock.json, pnpm-lock.yaml), auto-generated API clients, database migrations, and massive mock JSON files as totally empty.

## 5. Strict Autonomous Agent Restrictions
Hard Iteration Cap: If running in a multi-step workflow mode, never exceed 3 execution loops. If a solution fails a syntax check after the second attempt, halt and ask for direction.

No Automated Debugging Loops: Do not attempt to fix test failures or build errors in a continuous cycle. Show the initial failure stack trace and stop.

No Blanket Refactoring: Reject broad prompts like "improve performance." Require a specific service or class target.

Disable Autonomous Web Retrieval: Do not scrape external docs or search the web for minor syntax questions. Use local internal project context only.

## 6. Architectural Preferences
Lean Code First: Write highly atomic, modular code. Avoid large monolithic blocks.

Keep it Simple: Separate concerns cleanly and make data flow obvious. Avoid generic abstractions that make the code hard to follow.

## 7. Verification & Syntax
Internal Check: Do a mental syntax check before outputting any code. Do not rely on me to report errors to fix cascading syntax issues.

Verification Command: Following any code generation, output the exact terminal command needed to validate the changes (e.g., `npm run typecheck` or `tsc --noEmit`) as the very last line of your response.

## 8. Credential Storage & Secret Hygiene
Never commit secrets, access keys, tokens, or passwords in plaintext. Store passwords encrypted at rest (AES-256-GCM; key derived at request time from a developer passphrase via Argon2id + a random salt). The passphrase is never stored; returning an exact password requires it. Hashing is one-way (verify-only) and cannot be reversed to reveal a password. Put other secrets in env vars or a secrets manager, never the repo (commit only `.env.example` placeholders). Test-user credentials are exempt unless the account is administrator-or-higher.

---

## Agent Pipeline Rules

The following rules define the full BDD test generation pipeline. When generating test artifacts (feature files, step definitions, coverage reports), follow ALL of these rules exactly.

### General Artifact Naming Rule

Files created in the `artifacts/` folder MUST always have the US (User Story) number as a prefix, EXCEPT for the repo-scoped baseline artifacts - `<repo>-baseline.{json,md}`, `<repo>-step-database.{json,md}`, and `<repo>-payload-crossref-report.{json,md}` - which MUST start with the repository name instead (e.g., `artifacts/dal-basket-baseline.json`). All other artifacts use the US prefix (e.g., `artifacts/US12345_journeys.md`).

---

### Work Log & Time-Savings (every run, unless `--no-work-log`)

**Operator identity** (asked once, then persisted): before the first work-log write, resolve Name / Experience level (`junior|medior|senior`) / Area - from flags `--operator-name`/`--experience`/`--area`, else `~/.claude/bdd-authoring-operator.json` (`{name,experienceLevel,area}`), else ask once, validate, and save that file. These stamp the log header and the CSV/JSON dimensions.

Record what each stage achieved, the tool's wall-clock time (capture a run-id + per-stage start/end via `Get-Date`/`date`), and an estimated engineer-time equivalent at junior/medior/senior levels. Write per run (never overwrite): the human `artifacts/<storyId>-work-log-<run-id>.md` PLUS PowerBI-consumable `artifacts/work-log/<run-id>_<storyId>.csv` and `.json` in one central folder (PowerBI: Get Data -> Folder -> Combine). A planning estimate from published authoring baselines, not a controlled benchmark; note that tool wall-clock includes interactive latency.

Estimate = experienceMult x (perArtifact + perRun). **Base medior-level minutes/unit:** AC gather 12/AC; journey 25; scenario 15; NEW step-def 25 (reused = 0); repo analysis 60 x repoComplexity; coverage 20 + 2/AC. **Artifact complexity weight** (classify each scenario/step-def as composed): Simple 0.5 (<=6 steps / single-field assertion / one call reusing a helper), Moderate 1.0, Complex 2.5 (>12 steps, multi-field/collection/nested assertions, `Scenario Outline` w/ multiple `Examples`, stream/filter/map, multiple mocks, or a new helper) - default Moderate. **Repo complexity** = sizeFactor (small 0.5 / moderate 1.0 / large 2.0 by files+LOC) x techFactor (conventional Java/C#/Python/TS 1.0; Karate 1.4; mixed/unknown 1.3) x monorepoFactor (single 1.0; monorepo 1.25). **Experience multiplier:** junior 1.6 / medior 1.0 / senior 0.6. Report per-stage rows (with the S/M/C complexity mix) and a time-savings summary (estimated effort vs tool wall-clock, saved, speed-up) per experience level. **CSV** = one row per stage, no total row, stable header (`run_id,run_date,operator_name,experience_level,area,story_id,story_title,mode,stage,work_achieved,units,unit_count,complexity_simple,complexity_moderate,complexity_complex,repo_complexity,tool_seconds,eng_junior_min,eng_medior_min,eng_senior_min,saved_junior_min,saved_medior_min,saved_senior_min`), ISO `run_date`, quoted free-text.

---

### Stage 0 - Repository Baseline (PREREQUISITE)

No other stage runs until Stage 0 has completed. Stage 0 builds a structured baseline of the target repository so subsequent stages adapt to the existing codebase rather than guessing.

```
PROCEDURE discover_repo_baseline(repoPath):

  IF repoPath is missing or does not exist:
    EMIT a "no-repo" baseline (exists=false). Stage 1 may still partially
    run but step-definition code-gen and Stage 2 deployment require a target repo.
    RETURN.

  1. SCAN the repo root for framework signals:
     - package.json (npm/pnpm/yarn) -> JS/TS test frameworks
     - pom.xml / build.gradle(.kts) -> JVM (Karate, Cucumber-Java, JUnit)
     - csproj / sln -> .NET (SpecFlow, Reqnroll)
     - go.mod -> Go (godog)
     - requirements.txt / pyproject.toml -> Python (behave, pytest-bdd)
     - Cargo.toml -> Rust (cucumber-rs)

  2. DETECT the primary language(s):
     - Count source files by extension across non-vendor folders
     - Top language by source file count -> primary

  3. DETECT the composition pattern:
     - playwright-bdd      : createBdd() imports in step files
     - karate-call-chain   : .feature files containing `* call read('classpath:...')`
     - cucumber-step-defs  : @Given/@When/@Then annotations or step registrations
     - page-object-model   : pages/ or page-objects/ directory with class files
     - mixed / unknown     : fallbacks

  4. MAP the project structure (record repo-relative paths):
     - journeys / orchestrators directory
     - reusable API steps directory
     - assertions directory
     - request payloads directory
     - test data / fixtures directory
     - helpers directory
     - configuration directory

  4b. MONOREPO detection:
     If top-level has a subfolder ending in '-svc' AND another ending in '-test':
       - serviceRoot = the -svc subfolder; testRoot = the -test subfolder
       - Restrict test-artifact walk to the -test/ subtree
       - Extract in-house API surface primarily from the -svc/ subtree
       - UNION service-side and test-side endpoints; dedupe by "METHOD path"

  4c. INLINE ASSERTION STYLE detection:
     Scan .feature files for four patterns: scenario-outline-examples, quoted-literal,
     trailing-numeric, data-table. The BDD composer mirrors the dominant pattern.

  5. SAMPLE 3-5 existing feature files to infer naming conventions:
     - Feature file name pattern, tag pattern, variable naming style,
       step numbering style, auth header pattern.

  7. BUILD the step-definition catalog with four indexes:
     byApi, byResponseObject, byActionVerb, byNoun

  9. CACHE the baseline to .agent-cache/baseline-<sha256>.json (TTL 7 days).
```

---

### Rule 1 - Codebase Discovery (Determine Target Folder)

```
PROCEDURE detect_target_folder(frontend_feature, repo_baseline):

  1. EXTRACT journey metadata: journey type, product type, customer segment.

  2. SCAN candidate folders from repo_baseline.structure.journeysDir.

  3. SCORE the match:
     +3  product type match
         Vocabulary: SIMO, handset, broadband, MBB, PAYG, smartwatch
     +2  journey type match
         Vocabulary: acquisition, upgrade, secondline, renewal
     +1  segment match
         Vocabulary: consumer, business, CBU, EBU

     Pick the highest-scoring folder.

  4. FALLBACK: if no candidate scores > 0, ask the user to confirm.

  ABBREVIATION MAP:
    PAYM = Pay Monthly = SIMO context
    CBU  = Consumer Business Unit = consumer segment
    EBU  = Enterprise Business Unit = business segment
    MBB  = Mobile Broadband; SIMO = SIM Only; PAYG = Pay As You Go

  EXAMPLE:
    Journey: "Handset PAYM Acquisition CBU"
    -> product = SIMO (PAYM = Pay Monthly), journey = acquisition, segment = consumer (CBU)
    -> Best match: journeys/simo/ (contains SIMO_Acquisition.feature)
```

---

### Rule 1B - Acceptance-Criteria Gathering & Journey Matching

```
PROCEDURE gather_and_map_acs():

  1. WALK the Azure DevOps story graph from rootStoryId via BFS:
     - storyDepth bounds the walk; $expand=relations required on every fetch.
     - Skip unreadable work items (TF401232) with a warning; continue traversal.

  2. For each story extract acceptance criteria:
     a. STRUCTURED FIELD FIRST: read Microsoft.VSTS.Common.AcceptanceCriteria.
        - Completely REMOVE strikethrough content (<s>, <strike>, <del> tags).
        - Replace block HTML tags with newlines; strip remaining HTML.
        - GROUP by AC header: AC1: / AC 1: / AC1 - / AC #3: / Scenario 1: etc.
        - ID format: <storyId>-ac-<n>.
     b. FALLBACK TO LLM EXTRACTION (OFF BY DEFAULT):
        - ID format: <storyId>-llm-ac-<n>.

  3. RUN journey discovery (LLM call across the full graph):
     - Ask for 3-12 journeys, each with 2+ ordered steps and AC-ID assignments.
     - System prompt (use verbatim):

       "You are a senior business analyst structuring an Azure DevOps work-item
       graph into end-to-end customer journeys. A journey is a coherent customer
       flow from a triggering action to a measurable outcome. It has 2 or more
       ordered steps from the customer's perspective. Pure infrastructure work,
       dependency tracking, analytics-only stories, swagger updates, and platform
       setup are NOT journeys. Output JSON only. Schema:
       { journeys: [{ id, name, description, primaryActor, steps: [{ order,
       description, relatedStoryIds, acceptanceCriteriaIds }] }],
       unmappedAcceptanceCriteriaIds: [] }
       Every acceptanceCriteriaId you cite MUST appear verbatim in the input.
       Each AC belongs to at most one journey. Aim for 3-12 journeys.
       Each journey needs at least 2 steps."

     - VALIDATION: every cited AC ID must exist; each AC in at most one journey;
       journeys with < 2 steps are dropped; unassigned ACs -> unmappedAcceptanceCriteriaIds.

  4. WRITE artifacts:
     - artifacts/<US>_journeys.{md,json}
     - artifacts/journeys/<US>_<journey-id>.feature (one per journey)
     - artifacts/journeys/_<US>_unmapped.feature
     - artifacts/journeys/_traceability/<US>_<journey-id>.feature
     - artifacts/<US>_acceptance-criteria-map.md
```

---

### Rule 4 - BDD Scenario Composition

When composing BDD feature files, follow ALL of these rules:

**Rule 4.1 - Output format:**
Output a complete Gherkin .feature file as plain text. No prose around it. No Markdown fences.

**Rule 4.2 - Feature structure:**
Start with feature-level tags on a single line, then `Feature: <name>`, then a 1-line description.

**Rule 4.3 - Background deduplication:**
When more than one scenario shares the SAME Given preconditions, lift them into a `Background:` block. Do NOT repeat them per scenario.

**Rule 4.4 - One scenario per AC with smart collapsing:**
DEFAULT: one scenario per AC (N ACs => N scenarios).
EXCEPTION - COLLAPSE when: two ACs describe the same observable behaviour; one AC is a necessary precondition of another; two ACs describe the same error condition.
When collapsing: list EVERY covered AC's tag on the scenario's tag line.
**INVARIANT: every AC MUST be covered by exactly one scenario. No AC uncovered, no AC covered twice.**

**Rule 4.5 - Mandatory scenario tags (CRITICAL):**
EVERY scenario MUST start with this tag block on a single tag line immediately above `Scenario:`:
```
@<TeamTag> @US_<story_number> @AC_<n> [@AC_<m>...]
```
- `@<TeamTag>` - your team's fixed tag (e.g. `@AutomationTeam_Test`; change to your team's tag)
- `@US_<n>` - the parent ADO work item ID
- `@AC_<n>` - 1-based AC indices; multiple when collapsing

Optional after the mandatory triple: `@smoke`, `@regression`, `@happy-path`, `@alternate-path`, `@error-path`, `@edge-case`, `@validation`, `@phase-2`, `@bdd`.

Do NOT use the raw AC ID (e.g. `3198479-llm-ac-2`) as a tag. It belongs only in the `# Covers:` comment.

**Rule 4.6 - Traceability comment:**
Above each scenario: `# Covers: {storyId}-ac-{n}[, {storyId}-ac-{m}]`

**Rule 4.7 - Happy-path + validations:**
EVERY scenario must walk the AC's primary path AND end with concrete Then assertions.
- Positive-outcome AC: exercise happy path end-to-end; at least one explicit success assertion (status 200, success banner, etc.)
- Negative-outcome AC: exercise failure path; at least one explicit rejection/error assertion (status 4xx, error message, etc.)
- A scenario ending with "Then the journey is complete" or any non-asserting Then is unacceptable.

**Rule 4.8 - Scope guardrail:**
Use only in-house APIs. If a step requires calling an external API not in scope, rephrase as a Given precondition or omit. Do not compose multi-microservice flows that span teams.

**Rule 4.9 - Step reuse (CRITICAL):**
Before inventing any new step, check the existing step catalog. If an existing step body already performs the required action, REUSE its pattern verbatim. Wording differences are NOT a reason to create a new step.

**Rule 4.10 - Step count:**
Each scenario must have 6-15 steps. A 3-step scenario is unacceptable.

**Rule 4.11 - Concrete test data:**
Use concrete realistic data (real names, dates, currencies). Never use angle-bracket placeholders in regular Scenarios; use Scenario Outline + Examples for parameterized cases.

**Rule 4.12:** Use Scenario Outline + Examples where it reduces duplication.

**Rule 4.13:** UI affordances (button clicks, form fields) may appear in steps when present in the source flow.

**Rule 4.14:** No code, no scripts, no language identifiers. Just Gherkin.

**Rule 4.15 - Three-axis execution tags (playwright-bdd only):**
When the step catalog includes `http.steps.*`, `ui-*.steps.*` etc. and existing features carry `@be-only/@fe-only/@combined`, append ONE of these to every scenario tag line (AFTER the mandatory triple):
- `@be-only` - API/HTTP steps only; no browser interaction
- `@fe-only` - UI/browser steps only; no direct HTTP assertions
- `@combined` - mixes browser interaction with HTTP assertions

**Rule 4.16 - Universal Step Catalogue:**
These phrasings are canonical. Use them verbatim:

| Pattern | Notes |
|---|---|
| `When I navigate to {string}` | body: `page.goto` + `waitForLoadState('networkidle')` + `toHaveURL`. ONE file covers all navigation. |
| `Then the browser is redirected to {string}` | click-triggered URL change only (not goto) |
| `Then the {string} is visible` / `Then the {string} is hidden` | ONE file with `{word}` state param covers both. Resolve the name ACCESSIBILITY-FIRST (testid -> `getByRole` button/link/heading or `getByText` -> class/id), NOT testid/class-only, so it binds on a testid-less app. A page/route name (Login, Register) is NOT a DOM element - assert real on-page text, never the page name |
| `Then the {string} modal is {word}` (visible/hidden) | do not create per-state files |
| `When I close the {string} modal` | |
| `Given the localStorage key {string} is set to {string}` | |
| `Given the localStorage key {string} is cleared` | |
| `Then the localStorage key {string} is {word}` (present/absent) | ASSERTION only - do not write key-specific steps; NEVER use `is present/absent` as a Given/precondition (seed with `... is set to ...` instead) |
| `When I click the {string}` | any button/link by visible text or aria-label |
| `Given I am logged in as the test user` | ONE file; project-specific body; use in Background for auth scenarios. A direct-login SUCCESS scenario must be REGISTER-FIRST + self-consistent (`Given I register with username "<unique>" and password "<P>"` then `When I login ...` with the SAME creds); NEVER a real/existing/seeded username + guessed password (401). Pre-seeded users are used only via the persona step, never a raw credential step. A raw `POST <auth route> with body:` DataTable must use the REAL body field names (login = `username` + `password`; `username` accepts a username OR email VALUE) - never an invented alias like `identifier` (400) |

**Precondition discipline + browser-session vs API-auth:** steps before a scenario's first `When` must ESTABLISH state with setup steps, never a Then assertion (`localStorage ... is present/absent`, `the {string} is visible`, `the response status is`). BE auth (API `Authorization` header) and the browser localStorage session are DISTINCT - seed an FE session with `the localStorage key {string} is set to {string}`. A browser side-effect (localStorage cleared, redirect) is driven only by `When I navigate to {string}`, never by an API-request step; keep `@be-only` and `@fe-only`/`@combined` ACs in separate scenarios.

**Canonical verb enforcement (mandatory before accepting any step text):**
- `renders` / `is loaded` / `is inspected` / `is displayed` -> `is visible`
- `is open` / `is shown` -> `is visible`
- `shows` / `reads` / `displays` (text assertion) -> `shows`
- `is not present` / `is cleared` / `is removed` (localStorage) -> `is absent`
- Page name outside `{}` (Dashboard, Profile, Landing) in assertion step -> redesign
- "the X page finishes loading" -> use `When I navigate to {string}` instead

**Rule 4B - Inferred-Negative Scenarios:**
For every happy-path AC, also generate ONE companion scenario:

Tag format: `@<journey-tag(s)> @US_<storyId> @AC_<seq>_err @error-path @inferred-negative`

Trigger types:
- Requires authentication -> unauthenticated/unauthorised access (401/403 or login redirect). ONLY when the
  route is actually auth-gated (an auth middleware like `requireAuth`/`authenticate`). A public/optional-auth
  route returns 200 unauthenticated, so a 401 expectation there is a spec-vs-code mismatch - skip it or mark
  `# REVIEW: spec-vs-code`.
- Creates or submits data -> validation failure (missing field, invalid format, business rule)
- Retrieves a resource -> resource not found (empty state, 404, no results)
- Stateful action (add to basket, purchase, enrol) -> precondition not met

Do NOT add if the AC already describes a failure condition or is purely informational.
`@inferred-negative` companions are EXCLUDED from the AC coverage invariant duplicate checks.
The companion uses `@AC_<seq>_err`, NOT `@AC_<seq>`. It also carries the applicable execution tag: `@fe-only` when it only exercises client-side validation (the form never submits), or `@combined`/`@be-only` when it submits and receives a 4xx/5xx API response.

**Scope/Layer filters (when specified):**
- `stepScope=functional`: generate ONLY functional scenarios (user-observable behaviors and business rules)
- `stepScope=nonfunctional`: generate ONLY non-functional quality scenarios (console errors, accessibility, performance SLAs)
- `testLayer=frontend`: all scenarios MUST carry `@fe-only`; Playwright browser interactions only
- `testLayer=backend`: all scenarios MUST carry `@be-only`; HTTP/fetch calls only

---

### Rule 11.P2.PARAM - Step Parameterization Gate

Before generating any step-def file, apply these constraints:

**1. PARAMETERIZE EVERYTHING VARIABLE.**
Replace every hardcoded field name, condition, count, HTTP verb, component name, lock state, or page-context noun with: `{string}`, `{int}`, `{word}`, or `{float}`.

**2. PICK ONE CANONICAL VERB PER ACTION/ASSERTION.**
- `renders` / `is loaded` / `is inspected` -> use `is visible`
- `is open` / `is displayed` -> use `is visible`
- `shows` / `reads` / `displays` (text assertion) -> use `shows`
- `is not present` / `is cleared` (storage) -> use `is absent`

**3. COLLAPSE POLARITY INTO ONE STEP.**
`is visible` / `is not visible` belong in ONE file with a `{word}` state parameter.

**3b. COLLAPSE DATATYPE ADJECTIVES INTO ONE STEP.**
`a boolean field {string}` / `an integer field {string}` / `a string field {string}` are the same assertion with a different type check. Emit ONE step `a(n) {word} field {string}` and branch on the type token (`integer` -> `Number.isInteger`; `number` -> `typeof === 'number'`; else `typeof === type`). Never write separate Boolean/Integer/String files. A numeric-bound variant (`... field {string} between {int} and {int}`) stays its own step. Concrete feature lines still match the parameterized expression, so features are not rewritten.

**3c. STEP CONSOLIDATION PATTERN CATALOG (P1-P16).** Emit ONE parameterized step (a `/regex/` step when polarity or optional clauses apply), never a new file per variant. P1 numeric-suffix exact dups -> one file; P2 keyword-only collisions -> register once; P3 polarity (X/no X/not X/equals/contains) -> verb capture + branch; P4 numeric literal in the phrase (30, all 17, 1st, 0%) -> `{int}`; P5 datatype (a boolean/integer/string field) -> `a(n) {word} field`; P6 thing-noun (object/entry, box/object, Cli/Sdk) -> `{word}`; P7 enum/style/tier/ordinal/language-as-file -> value/`{word}`; P8 property-name baked in the phrase -> `{string}`; P9 count/quantifier (exactly/at least/at most/only/all N) -> comparator `{word}` + `{int}`; P10 value present/absent -> `(contains|does not contain) {string}`; P11 configure/stub a service to return status/network/delay -> endpoint + `{word}` kind; P12 no-client-error family -> DOM-absence step + collected-errors step; P13 attribute-accretion fixtures -> one `Given('... exists with:', DataTable)`; P14 optional trailing clause -> `(...)`/`(?:...)?`; P15 verb synonyms -> one canonical verb; P16 a/an -> `an?`.

**3d. SHARED STEP LIBRARY (bdd + e2e = ONE vocabulary).** Emit exactly ONE step-def per canonical step into a style-agnostic `step-defs/<subdir>/` path (no `bdd/`|`e2e/` segment); both feature trees bind to it by step text. NEVER emit a per-style twin - the runner loads one step world, so the same pattern under both trees is an ambiguous/duplicate step-definition error. Compose BDD first, then compose E2E reusing the BDD step phrasings: an E2E scenario is a BROADER multi-API journey assembled from the shared steps, not a re-worded per-API twin.

**4. NEVER HARDCODE A CONCRETE DATA VALUE.**
Badge IDs, page names, field names, status conditions, ordinal labels, medal tiers are always Cucumber expression parameters.

**5. CHECK BEFORE CREATING.**
If an existing step body already performs the required action, reuse its step text verbatim.

**6. CATEGORY TAG REQUIRED.**
Every generated step-def file must carry a two-tag category comment at the top:
```
// @functional @frontend      (user-observable behavior, browser state)
// @functional @backend       (business rule, HTTP/DB assertion)
// @nonfunctional @frontend   (quality gate: console errors, CSS, accessibility)
// @nonfunctional @backend    (quality gate: service latency, security headers)
```

**7. FLAG THESE PATTERNS AS VIOLATIONS** (redesign before writing code):
- Specific page name outside `{}`: Dashboard, Profile, Landing, Browser
- Specific field name outside `{}`: username, password, email, achievements
- Specific condition outside `{}`: null, undefined, absent, not present, cleared
- HTTP verb outside `{}`: GET, POST
- Lock state outside `{}`: locked, unlocked
- Action-context qualifier: `during render`, `during the click interaction`
- Synonym verb when canonical exists: `reads`/`displays` alongside `shows`; `renders`/`is loaded` alongside `is visible`

**Anti-patterns (FORBIDDEN - wrong/right pairs):**

```
WRONG: Then('the achievements field value is not null', ...)
RIGHT: Then('the {string} field value is not {word} in the response', ..., fieldName, condition)

WRONG: Then('the achievements array contains badge ID {string}', ...)
RIGHT: Then('the {string} array {string} item {string}', ..., arrayField, matchMode, value)

WRONG: Given('the GET {string} endpoint is configured to return status {int}', ...)
RIGHT: Given('the {string} {string} endpoint is configured to return status {int}', ..., verb, path)

WRONG: Then('no JavaScript runtime error is thrown on the Dashboard', ...)
RIGHT: Then('no JavaScript runtime error is thrown', ...)

WRONG: When('the hero section renders', ...)
RIGHT: When('the hero section is visible', ...)

WRONG: Then('the BadgeUnlockModal is open', ...) [separate file from negative form]
RIGHT: Then('the {string} modal is {word}', ..., modalName, state)

WRONG: Then('the email field is visible on the Register Card', ...)
RIGHT: Then('the {string} is visible on the {string}', ..., element, surface)

WRONG: Then('the breadcrumb displays {string}', ...)
RIGHT: Then('the breadcrumb shows {string}', ..., text)

WRONG: Then('no JavaScript console errors are recorded during render', ...)
RIGHT: Then('no JavaScript console errors are recorded', ...)

WRONG: Then('the localStorage key {string} is not present', ...)
RIGHT: Then('the localStorage key {string} is absent', ..., key)

WRONG: Then('the leaderboard row ranked 1st has gold medal styling applied', ...)
RIGHT: Then('the leaderboard row ranked {int} has {string} medal styling applied', ..., rank, tier)
```



---

### Rule 10 - AC Coverage Status Definitions

```
covered        = AC has >= 1 happy-path scenario (@AC_<n>) AND >= 1 error-path scenario (@AC_<n>_err or @inferred-negative)
partial        = AC has >= 1 scenario but missing either happy-path or error-path companion
missing        = AC has 0 scenarios carrying its tag - must be addressed before sign-off
over-specified = AC has > 3 scenarios carrying its tag (potential duplication - review for consolidation)
```

---

### Rule 13 - Credential Storage & Secret Hygiene

No secret, access key, token, or password may be committed to source control in plaintext.

**PASSWORDS (and equivalent long-lived credentials) - ENCRYPTED-VAULT MODEL:**
1. Store ONLY ciphertext at rest. Encrypt with AES-256-GCM or XChaCha20-Poly1305. Use random per-secret nonce and salt.
2. Derive the key at request time from a developer-supplied passphrase via Argon2id (memory-hard KDF). The derived key is held in memory only and never persisted.
3. NEVER store the passphrase. It is supplied interactively per request and kept in memory only.
4. Returning the exact plaintext password REQUIRES the developer to submit the correct passphrase. Without it, REFUSE and return nothing.
5. Unattended contexts: the key or passphrase must come from an OS keychain, cloud KMS, or secrets manager.

HASHING IS NOT ENCRYPTION: one-way hashes (bcrypt/scrypt/Argon2) cannot be reversed. Do not claim a hash can be decrypted.

**OTHER SECRETS:** never hardcode; read from env var, vault, or secrets manager at runtime; commit only `.env.example` placeholders.

**TEST USERS:** ordinary test credentials may exist, but ADMINISTRATOR-OR-HIGHER accounts (admin, root, superuser, superadmin, owner, privileged) must never be committed in plaintext.

---

### Quality Gates

When validating generated test artifacts:

1. **File structure:** every file reference resolves to a real file; all JSON payloads parse; framework config entries are present.

2. **Convention:** Background sections match repo_baseline.conventions; variable names follow detected style; step numbering style matches.

3. **Variable chain:** every consumed variable has an upstream producer; broken chains are reported.

4. **Assertion completeness:** every API-call feature has a corresponding assertion feature; each checks at minimum response present + status code; field-level assertions where schema is known.

5. **Language consistency:** generated code uses the language from auto-detection. No cross-language mixing.

6. **Verification:** output the typecheck command (`tsc --noEmit`, `mvn compile`, `dotnet build`, etc.) as the last line after any code generation.

### Rule 14B - Seam & mock fidelity (bind generated test code to the REAL code)

Generated test/step code must bind to code that actually exists, never to an imagined seam. **GROUND ON THE REAL MODULE WHEN IT EXISTS (read the code before generating):** spec-only red-first is only for behavior that does not exist yet. When the unit's target module is ALREADY in the workspace, OPEN it first and read its real interface (exact export names, each signature + sync/async, the top-level shape each returns, the HTTP route table it registers via `router.<verb>('/path',...)`, and the collaborators it actually imports + their members). Also read each export's JSDoc / purpose so you can map the behavior you need to test ("get user info") onto the export whose purpose fits (`getUser`) by MEANING - even when names diverge, and never rename the real export to match the spec. Then generate against THAT - target the real exports/endpoints, mock ONLY those real collaborators at their real members, assert only behavior the code has. Never invent an export name (`evaluate` when the real one is `checkAchievements`), a collaborator (a `userStore` the module never imports), a persistence step, or async the code lacks; skip a spec behavior with no matching real export (`// RED: not in module interface`) and cover it in its real unit. Keep spec-only red-first ONLY when the module is absent. ALSO match the real DATA SHAPE from the SUT body, not just the interface: (a) a fixture must carry every field the SUT DEREFERENCES, initialized as the code assumes - if the SUT does `user.progress[cat]`, the fixture MUST include `progress: {}` (mirror the real create/registration path); never invent a field the SUT never uses (a bogus `level`); put the full real shape in a shared `makeX()` helper. (b) The persistence envelope belongs to whoever the real code shows owns it - if the writer persists its argument VERBATIM (the reader round-trips the whole object), the CALLER passes the full wrapper (`writeUsers({ users: map })`) and reads back `readUsers().users`; only a writer that itself wraps takes the bare map. Prefer arranging/verifying through the SUT entity ops (`save`/`getById`/`getAll`) over the raw whole-store writer/reader pair. This is the PRIMARY defence against interface invention; the items below are the safety net for anything that slips through:

1. **Real exports + seam.** Import only symbols the module actually exports; never invent a repository/CRUD contract (`getAll/getById/getByUsername/create/update/save`), a function decomposition, a synthetic parameter DTO, its data shape, or cross-function invariants. If the behavior lives in another unit (a route handler, a sibling module), test it there (HTTP-contract / BDD scenario), not against an imagined helper.
2. **Mock only real collaborators, at the real shape.** Mock the collaborators the code actually imports - not a non-dependency (a virtual mock of a non-dependency silently no-ops), and never leave the real collaborator unmocked. Mirror the member shape (sync `fs.*Sync` vs async `fs.promises.*`).
3. **Async vs sync fidelity - mocks AND assertions (jest).** MOCK side: default a collaborator mock to a SYNC return (`mockReturnValue`); use `mockResolvedValue`/`mockRejectedValue` only when the real collaborator is async. A Promise where the code expects a sync value silently corrupts the unit. A `*Sync` collaborator (`fs.readFileSync`, `existsSync`, ...) is ALWAYS sync - never seed it with `mockResolvedValue`, and never mix channels on one mock var (`mockReturnValueOnce(...).mockResolvedValueOnce(...)`). ASSERTION side: use the Promise-only matchers `.resolves`/`.rejects` ONLY when the target is explicitly async; a `.resolves`/`.rejects` on a synchronous call fails ("received value must be a promise") even when correct. For a sync-or-unknown target assert `expect(await fn(args)).toEqual(x)` (await of a sync value is harmless) and use `expect(() => fn(args)).toThrow()`/`.not.toThrow()`; when async-ness is genuinely unknown and reject semantics are needed, wrap universally `await expect((async () => fn(args))()).rejects.toThrow()`. Never write `.resolves.toThrow()`/`.resolves.not.toThrow()`. DELEGATING-FACTORY ACCESS: when the store/fs mock uses the hoisting-safe delegating factory (arrows to module-scope `mock*` fns), configure/inspect ONLY those `mock*` fns (`mockExistsSync.mockReturnValue(true)`, `mockWriteFileSync.mock.calls`), never a member of the required module (`require('fs').existsSync.mockReturnValue(...)` is a plain arrow, not a `jest.fn` -> TypeError at setup). ASYNC EMITTER/STREAM SEAM TIMING: mock a spawn/exec/fork child (or any EventEmitter/stream that emits on a microtask/timer) LAZILY - `mock.mockImplementation(() => makeFakeChild(...))`, never eagerly `mock.mockReturnValue(makeFakeChild(...))`; eager construction schedules the fake's `stdout` emit before the SUT (which attaches its `.on('data')/.on('close')` listeners only AFTER an await, e.g. `fs.promises.mkdtemp`) can subscribe, and a naive fake drops the un-listened event -> stdout arrives empty and `JSON.parse('')` throws. Make the fake BUFFER `data` and flush on the first `.on('data')`, emitting `close`/`end` after the data.
4. **Serialized-fixture envelope fidelity (jest).** When you seed a reader/parse mock (e.g. `fs.readFileSync`) with a serialized store, wrap the fixture in the SAME top-level envelope the code round-trips - the shape the paired writer emits (`writeUsers(db)` -> `{ users: db }`) and the reader unwraps (`readUsers().users`). If the code reads `read(...).<key>`, seed `{ <key>: <data> }`, never the bare `<data>`: a flat fixture makes `.<key>` undefined and the assertion receives `undefined`.
5. **Serialized-write envelope symmetry (jest).** The write-side companion: assert on a CAPTURED write payload through the same envelope the write produces. If the write wraps at a key (`writeUsers({ users: x })` or the writer emits `{ users: db }`), the captured JSON is `{ users: ... }` - assert `written.users[entry]`, never a flat `written[entry]` (undefined), and pass the wrapper the FULL `users` map, not a single entry object. Advisory only: touches the asserted subject and test data, so surface it - never rewrite an assertion.
6. **Mock-factory TDZ safety (jest).** A `jest.mock` factory is hoisted above imports and fires during the SUT import; its returned object must NOT read a module-scope `const`/`let` directly (`default: mockCtor`) - that TDZ-crashes the whole suite on load. Define the mock inline, or defer the read behind a regular function (`default: function (...a) { return mockCtor(...a); }`).
7. **External-package mocks: target the exact specifier the code imports.** Mock a real SDK/package by the name the SUT actually imports (`jest.mock('@anthropic-ai/sdk')`), not a guessed alias (`jest.mock('anthropic')`) - a wrong/uninstalled name fails suite load with "Cannot find module". If a mock names a package that is not installed and not imported by the code under test, repoint it to the SUT's real dependency (its single external import, or the closest-named when several). A mock-wiring repoint only - never touch assertions, never fabricate a pass.
8. **Never fabricate a pass.** If the code deliberately does not implement an asserted contract (e.g. a graceful fallback where the test expects a throw), leave the assertion and flag the spec-vs-code gap - it is a human AC-vs-code decision. Never add or modify application source to satisfy a generated test.

### Rule 14C - Interface retargeting (rewire a fabricated interface onto the real member)

When a fabricated symbol names behaviour the app-under-test ALREADY implements under a different name/shape/sync-ness, retarget the test onto the real member instead of leaving a permanent red - a spec-vs-code seam mismatch, not a code bug. Test-code only; never edit app source, never change assertions, never fabricate a missing symbol.

1. **Map by role, not spelling.** Match the fabricated symbol to a real export by its leading-verb role - read/list/getAll -> collection reader; get/getBy* -> get-by-key; create/add; update/patch; delete/remove; save/write/persist; evaluate/check/compute/assess -> compute/derive op (a synonym rename, e.g. `evaluate` -> the real `checkAchievements` on the same entity noun - never a composition). A candidate qualifies when it plays that role AND shares the module's entity noun (or, for get-by-key, the SAME lookup key). Retarget only when exactly ONE real export qualifies; on ambiguity or none, leave the red and route to BDD/HTTP-contract (Rule 14A). This applies whether the SUT is imported by name or via a namespace / dynamic import (`const m = await import('...'); m.getAll` - diff `m`'s members against the real exports too).
2. **Rewrite the import AND its call sites.** Unwrap the real return shape (`await getAll()` -> `readUsers().users`) and drop/add `await` (and `.resolves`/`.rejects`) to match the real member's sync/async. Do NOT retarget a single-element create/save/delete onto a whole-collection writer: `save(x)` -> `writeUsers({ users: x })` replaces the whole collection with one element and corrupts every read, and composing a read-modify-write invents a member the unit does not export - leave such a symbol a phantom red (route to BDD). Swap a wrong collaborator seam (`fs/promises` async -> `fs` sync `readFileSync`/`writeFileSync`) and re-seed those collaborator mocks to the real wrapper shape.
3. **Only when the member is real.** A symbol with a real role/noun match is retargeted; one with none stays failing (never invented). The assertion SUBJECT is preserved: you MAY rewire a fabricated callee inside an `expect(...)` to its real name (`getById(id)` -> `getUser(id)`), but NEVER change a matcher or an expected value; the unit under test is never mocked. `getByUsername`/`getByEmail`/`create` that live in a route, not the store, stay reds routed to BDD - they are NOT retargeted onto the entity getter.
4. **Never write broken or fabricated tests.** After any rewrite, strip stray prose/fences and confirm the file still parses as valid JS (it would SyntaxError at load otherwise), keeps the same assertion subjects (matchers + expected values + count - only a rewired callee may differ), and adds no new `it`/`test`/`describe` blocks. If it fails any of these, discard the rewrite and leave the original test unchanged.

### Rule 14F - Lifecycle-ordered, self-seeded CRUD tests (stateful in-memory fake + randomized data)

Applies to STATE-MANAGING units ONLY (a store/repository/CRUD service backed by fs/db with create/read/update/delete ops). Pure-function units keep classic Arrange-Act-Assert. Removes the hand-crafted-fixture failure mode (Rule 14D/14E) at generation: the test never hand-writes a fixture or serialized envelope - it creates data through the SUT and reads it back.

1. **Stateful in-memory fake, not static seeds.** Mock the persistence collaborator ONCE as a fake over a module-scope backing var: the write mock stores what the SUT writes; the read mock returns the latest stored bytes (absent store -> the real not-found error, e.g. `ENOENT`). Reset the backing VAR (not the mock identity) in `beforeEach`. HOISTING SAFETY: jest hoists the `jest.mock()` factory and forbids non-`mock`-prefixed out-of-scope refs - NAME the backing var `mock`-prefixed (`mockStore`), keep the factory a thin delegator to `mock*` fns (`readFileSync: (...a) => mockReadFileSync(...a)`), and put the stateful logic in `beforeEach`; never reference the backing var inside the factory.
2. **Arrange by creating through the SUT with randomized data.** Build entities from inline `randomId()`/`randomName()`/`randomInt()`/... helpers; randomize every free field; hold them in test-scope consts and assert against them (self-describing failures). Never a hand-crafted static fixture or hand-written envelope.
3. **Verify by reading back through the SUT** - create -> `getById`/`getAll`; update -> read; delete -> read is null/absent. A real round-trip that supersedes inspecting the serialized write payload. Do NOT also assert the persistence MECHANISM (which fs method, atomic write/fsync, mkdir) - impl guesses that break on sync/async/path divergence - and do NOT assume the store is async (avoid `.resolves`/`.rejects` unless the contract types it async; wire the fake to both the sync and async seams).
4. **Lifecycle order + teardown.** Run create -> act (query/update) -> delete in logical order (teardown by deleting or via the store reset). Error paths (delete/read a non-existent id, empty store) are the deliberate exception and run without pre-created data.
5. **Never a false green.** The SUT must genuinely persist/mutate/remove the randomized data through the fake; never stub the store to fabricate a read the SUT did not write.
