---
name: ado-story-creator
description: 'Generate and create Azure DevOps User Stories (and optionally a full Epic→Feature→Story→Task hierarchy) from a git branch diff, a plan document, or a Low-Level Design specification. Fetches board swimlanes dynamically. Previews all items before creating. Supports sprint planning with real iteration assignment. Pass a folder path as the argument to skip the folder prompt.'
argument-hint: '[<target-folder-path>]'
user-invocable: true
---

# ado-story-creator Skill (`/ado-story-creator`)

Creates Azure DevOps work items from three source types:

- **Git mode** — target folder is a git repo on a non-main/master branch; stories derived from the branch diff only.
- **Document mode** — target folder has plan/spec Markdown, Gherkin, or text files; stories derived from those documents.
- **LLD mode** — target folder has a Low-Level Design or specification document (detected by keyword heuristic); produces a full Epic → Feature → User Story → Task hierarchy via a 4-pass generation pipeline.

In all modes: collect parameters, draft items with quality criteria (Fibonacci story points, discipline tags, positive + negative ACs), preview, optionally assign to real sprints, then create via the ADO batch API.

---

## Parameters

Six parameters are required. Resolve each one from the sources below, in priority order:

| Parameter | Env var | .env key | Prompt label |
|-----------|---------|----------|--------------|
| ADO org | `AZURE_DEVOPS_ORG` | `ADO_ORG` | "ADO organisation name (e.g. vfuk-digital)" |
| ADO project | `AZURE_DEVOPS_PROJECT` | `ADO_PROJECT` | "ADO project name (e.g. Digital)" |
| Area path | `ADO_AREA_PATH` | `ADO_AREA_PATH` | "Area path (e.g. Digital\\Intensive Care)" |
| Iteration path | `ADO_ITERATION_PATH` | `ADO_ITERATION_PATH` | "Starting iteration path (e.g. Digital\\Digital X\\PI 42\\42.4)" |
| Board URL | `ADO_BOARD_URL` | `ADO_BOARD_URL` | "Board URL (e.g. https://dev.azure.com/org/Project/_boards/board/t/Team/Stories) — leave blank to skip swimlane setup" |
| Target folder | _(argument or prompt)_ | — | "Path to the target folder (git repo or docs folder)" |

Extract the team name from the board URL by splitting on `/t/` and URL-decoding the next path segment. This team name is used for swimlane and column-state API calls.

**PAT resolution** — check in this order:
1. Shell env: `$env:AZURE_DEVOPS_PAT` (PowerShell) or `$AZURE_DEVOPS_PAT` (bash)
2. `.env` file at `<target-folder>\.env` or the current working directory — look for a line `AZURE_DEVOPS_PAT=...`
3. Prompt the user: "Paste your Azure DevOps PAT (Work Items Read+Write scope):"

If the PAT is missing after all three checks, print the PAT setup guide below and stop.

Collect all missing parameters in a **single** message — not one at a time.

### PAT setup guide

---
**ADO PAT not configured.** You need a Personal Access Token with **Work Items (Read & Write)** scope.

1. Go to `https://dev.azure.com/<your-org>` → User Settings (top-right avatar) → Personal access tokens
2. Click **New Token** → set scope **Work Items — Read & Write**
3. Copy the token, then either:
   - Set `AZURE_DEVOPS_PAT=<token>` in your shell profile, **or**
   - Add `AZURE_DEVOPS_PAT=<token>` to a `.env` file in the target folder

Then re-run `/ado-story-creator`.

---

---

## Step 0.5 — Board configuration (swimlane + column-state mapping)

If a board URL was provided (or resolved from env/`.env`), run these two queries using the extracted team name. Skip this step entirely if no board URL is available — items will be created without a lane or state assignment.

### Query swimlanes

```
GET https://dev.azure.com/{org}/{project}/{encodedTeam}/_apis/work/boards/Stories/rows?api-version=7.1
```

Parse the `value` array. Display a numbered list and ask the user which swimlane to use:

```
Available swimlanes on {team} board:
  1. Sprint Goal
  2. Technical Excellence
  3. Bugs
  4. Releases
  5. Unsorted

Which swimlane for new stories? [default: Sprint Goal if present, otherwise Unsorted]
```

Store the chosen name as `selectedLane`. Use the exact string returned by the API — never use user-typed free text as the lane value, as the field is case- and whitespace-sensitive.

### Query column-to-state mapping

```
GET https://dev.azure.com/{org}/{project}/{encodedTeam}/_apis/work/boards/Stories?api-version=7.1
```

Scan the `columns` array for the column whose `name` is `Ready for Development` (case-insensitive match). Read its `stateMappings["User Story"]` value. Store as `readyState` (typically `"Ready"`).

When creating User Stories in Step 4, always include:
```json
{ "op": "add", "path": "/fields/System.State", "value": "{readyState}" }
```

And if a lane was chosen:
```json
{ "op": "add", "path": "/fields/System.BoardLane", "value": "{selectedLane}" }
```

---

## Step 1 — Source type detection

Inspect the target folder to determine which mode to use.

### LLD mode (highest priority)

Scan all `.md`, `.txt`, `.docx`, and `.xlsx` files in the target folder. For each file with extractable text, count how many of the following keywords appear (case-insensitive):

`requirements`, `acceptance criteria`, `epic`, `feature`, `user story`, `as a`, `given`, `when`, `then`, `functional`, `non-functional`, `shall`, `must`, `scope`, `objective`, `definition of done`, `system`, `interface`

If **any** single file scores 5 or more keyword matches, activate LLD mode. If both LLD and Git conditions apply, ask:

> "This looks like a specification document in a git repo. Should I:
> a) Generate a full Epic→Feature→Story→Task hierarchy from the spec (LLD mode)
> b) Analyse the git branch diff for simpler flat User Stories (Git mode)"

Wait for the user's choice.

### Git mode

Applies when **all** of the following are true:
- A `.git` directory (or file) exists inside `<target-folder>`
- `git rev-parse --abbrev-ref HEAD` succeeds
- The current branch is **not** `main`, `master`, `develop`, or `trunk`
- LLD mode did not trigger first

If the current branch IS a protected name:
> "The repo is on branch `{branch}`. On `main`/`master` the diff may be very large or empty. Proceed anyway, or specify a different folder?"

Wait for confirmation before continuing.

### Document mode

Applies when neither LLD nor Git conditions are met — or when the user confirmed proceeding on a protected branch — or when the resulting diff is empty.

---

## Step 2A — Git branch diff analysis

### Detect the base branch

```powershell
git -C <target-folder> for-each-ref --format="%(refname:short)" refs/heads/ |
  Select-String -Pattern "^(main|master|develop|trunk)$" |
  Select-Object -First 1
```

If no local base branch is found, try `origin/main`, `origin/master`, `origin/develop` in that order via `git ls-remote --heads origin`. If still not found, ask: "What is the base branch to compare against?"

### Collect the diff

```powershell
# Commits on this branch only
git -C <target-folder> log <base>..HEAD --oneline

# Files changed
git -C <target-folder> diff <base>...HEAD --name-status

# Full diff (cap at 400 lines; use --stat if larger)
git -C <target-folder> diff <base>...HEAD --unified=3
```

Use three-dot syntax (`<base>...HEAD`) — this shows only changes introduced by the branch, not all commits since the fork point.

### Analyse the diff

Read commit messages, changed file paths, and diff hunks. Identify:

1. **Capability clusters** — group related file changes into coherent units of work (e.g. all changes under `packages/engine/src/steps/` → one cluster; CLI changes under `apps/cli/src/` → another).
2. **Intent per cluster** — new feature, bug fix, refactor, config? Confirm from commit messages.
3. **Story candidates** — each cluster a PO, QA, or test engineer would recognise = one candidate (1–8 total). Pure internal refactors (rename, extract function with no behavioural change) can be merged into a larger story.

### Draft stories from the diff

For each candidate, produce a draft following the **Quality Rules** section below.

---

## Step 2B — Document analysis

### Discover documents

Search the target folder in priority order:
1. Files named `*PLAN*`, `*POC*`, `*spec*`, `*SPEC*`, `*LLD*`, `*BRD*`, `*requirements*` (case-insensitive)
2. `*.md` files
3. `*.feature` files (Gherkin)
4. `*.txt` files
5. `*.docx` files — extract via helper script (see Extended formats below)
6. `*.xlsx` / `*.xls` files — extract via helper script

Read up to 10 files. If total content exceeds 6000 words, summarise each file individually before analysis (keep headings and bullet points, discard prose filler).

### Extended formats (`.docx`, `.xlsx`, HTTPS URL)

If `.docx` or `.xlsx` files are found, or the target is an HTTPS URL, extract their text using the helper script. Run from the skill directory:

```powershell
node "$env:USERPROFILE\.claude\skills\ado-story-creator\extract-doc.mjs" "<file-path-or-url>"
```

The script outputs plain text to stdout. On first use with a `.docx` or `.xlsx`, it will run `npm install mammoth xlsx --no-save` automatically.

### Extract story candidates

Parse each document for:
- **Numbered phases or sections** (e.g. "Phase 1 — Bastion Integration") → each = one candidate
- **Numbered task lists** → groups of 3–5 tasks = one candidate
- **Acceptance criteria blocks** → map directly into the story's AC list
- **Dependency tables** → surface as "Support Needed" in the description

Do not generate more than one story per document section at the same heading level.

### Draft stories from documents

For each candidate, produce a draft following the **Quality Rules** section below. For date fields:
- If the document contains explicit start/end dates (ISO 8601, slash-separated, or "Mon DD YYYY"), use them.
- Otherwise: story 1 = today to today+5 working days; each subsequent story shifts 5 days.

---

## Step 2C — LLD mode: 4-pass hierarchy generation

This mode produces a full **Epic → Feature → User Story → Task** hierarchy.

### Source preparation

Collect all text from the target folder using the same discovery order as Step 2B (including `.docx`/`.xlsx` via `extract-doc.mjs`). Concatenate into a single source block. If the total exceeds 8000 tokens, summarise section by section (keep headings and requirement statements, compress prose) before Pass 1.

### Pass 1 — Epic and Feature extraction

Analyse the full LLD text. Decompose into 3–6 Epics, each containing 2–5 Features.

For each Epic produce:
```json
{
  "epicTitle": "...",
  "epicDescription": "2–3 sentences: what this Epic delivers and why",
  "features": [
    { "featureTitle": "...", "featureDescription": "1–2 sentences" }
  ]
}
```

Output the structured list before proceeding. Print a summary:
> "Identified {N} Epics, {M} Features. Proceeding to story generation..."

### Pass 2 — User Story generation (per Feature)

For each Feature, generate 2–5 User Stories in `As a [role], I want [goal], so that [benefit]` format.

Each story draft must include:
- `title` — verb-object, 5–12 words, present tense (e.g. "Add bastion auto-connect flag to CLI")
- `storyStatement` — the full As a / I want / So that sentence
- `discipline` — `frontend` | `backend` | `fullstack`
- `pairKey` — shared string label (e.g. `"auth-flow"`) if this story pairs with a counterpart in the other discipline; `null` if no pair

Process Features in order. Print progress: "Pass 2: Epic {i}/{N} — {M} stories drafted."

### Pass 3 — AC and Task enrichment (per Feature)

For each story from Pass 2, apply the **Quality Rules** below plus:
- Extract ACs directly evidenced in the LLD text (these are `derived: true`)
- Fill any gaps with inferred ACs (`derived: false` — these are marked as generated)
- Add 3–5 atomic implementation tasks per story. Each task must have a `verification` field: a one-sentence check that confirms the task is done.

Print progress: "Pass 3: {K} stories enriched."

### Pass 4 — Cross-story dependency analysis

Review all story titles, disciplines, and goals across all Epics. Infer hard prerequisites using these rules:
- Authentication / identity stories must precede any story that calls a protected endpoint
- Create / register stories must precede edit / view / delete stories on the same entity
- Backend stories must precede their paired frontend counterpart (matched by `pairKey`)
- Data model / schema stories must precede API stories that use those models

Output: list of `{ storyTitle, dependsOn: [storyTitle, ...] }`.

Print: "Pass 4 complete. {D} dependencies inferred."

### Post-generation linking and cycle breaking

1. Stories sharing a `pairKey` → add each other to `relatedStoryIds`.
2. Frontend stories in a pair → add `dependsOn: [backendStoryId]`.
3. Run a 3-colour DFS on the dependency graph. Any back-edge (cycle) is removed. Print a warning for each: `"Removed circular dependency: {A} → {B}"`.

---

## Quality Rules (applied in all modes)

Apply these rules to every story draft before the preview.

### Story points (Fibonacci)

| Points | Guidance |
|--------|----------|
| 1 | Single-file tweak, pure config, no logic change |
| 2 | Simple addition with clear spec, unit tests only |
| 3 | Typical feature: 2–3 endpoints or components, integration test |
| 5 | Multi-component, cross-layer, or first instance of a new pattern |
| 8 | Multi-layer cross-cutting concern, security-critical, or spans services |
| 13 | Multi-Epic scope or very high uncertainty — consider splitting before assigning |

Set `Microsoft.VSTS.Scheduling.StoryPoints` to the chosen value.

### Discipline tagging

Infer discipline from the diff content or document description:
- `backend` — API endpoints, services, database schemas, infrastructure, data pipelines
- `frontend` — UI components, CLI commands, browser/native app changes, UX
- `fullstack` — genuinely spans both, or impossible to separate cleanly

Write as `System.Tags` value (append with `;` if the field already has values). In LLD mode, write the discipline as determined in Pass 2.

### Acceptance criteria rules

**Every story must have:**
- At least **2 positive ACs** — observable outcomes when the feature works as intended
- At least **1 negative AC** — what happens when input is invalid, a service is down, a limit is exceeded, or a boundary condition is hit

**All ACs must be written in Given/When/Then format — no exceptions:**
- **Given** — the precondition or starting state
- **When** — the action or event that occurs
- **Then** — the observable outcome that must be true

Each AC must be testable by a person with no prior knowledge of the codebase — never write "the feature works correctly" or "all tests pass". Never use "must/shall" phrasing as a substitute for Given/When/Then.

### Description HTML format

```html
<p><strong>Complexity:</strong> {low|medium|high|very-high} &nbsp;|&nbsp;
   <strong>Discipline:</strong> {backend|frontend|fullstack} &nbsp;|&nbsp;
   <strong>Points:</strong> {N}</p>
<p>{2–4 sentence narrative: what changed, why, and how it fits the broader goal.}</p>
<h3>Support Needed</h3>
<p>{support text — omit this entire block if none}</p>
```

### Acceptance criteria HTML format (goes into `Microsoft.VSTS.Common.AcceptanceCriteria`)

```html
<ul>
  <li><strong>Given</strong> {precondition}, <strong>When</strong> {action}, <strong>Then</strong> {observable outcome}.</li>
  <li><strong>Given</strong> {precondition}, <strong>When</strong> {action}, <strong>Then</strong> {observable outcome}.</li>
  <li><em>Negative:</em> <strong>Given</strong> {invalid or error precondition}, <strong>When</strong> {action}, <strong>Then</strong> {system response to the failure}.</li>
</ul>
```

---

## Step 3 — Story preview

Print before any ADO write call.

**LLD mode — hierarchical preview:**
```
Drafted {N} Epics, {M} Features, {K} Stories, {T} Tasks

EPIC 1: Auth and Identity Layer                          [8 pts total]
  FEATURE 1.1: Token issuance
    #1  [backend  3pts]  Implement auth token endpoint   Ready  42.4
    #2  [frontend 2pts]  Add login form component        Ready  42.4   needs #1
  FEATURE 1.2: Session management
    #3  [fullstack 5pts] Implement session refresh flow  Ready  42.5
...

ADO target: {org}/{project} | Area: {area} | Start: {iteration}
Swimlane: {selectedLane or "none"} | Target column: Ready for Development
Inferred dependencies: {D} (marked above as "needs #N")
Removed cycles: {X warnings}
```

**Git / Document mode — flat preview:**
```
  #  [disc  pts]  Title                                    State   Iteration
  -  -----------  ---------------------------------------- ------- ----------
  1  [back  5]    Add bastion auto-connect flag             Ready   42.4
  2  [full  8]    Implement Dynatrace Grail verification    Ready   42.4

ADO target: {org}/{project} | Area: {area} | Iteration: {iteration}
Swimlane: {selectedLane or "none"}
```

Then ask:
```
Create {K} User Stories (+ {N} Epics, {M} Features, {T} Tasks)?
  a) Create all now
  b) Assign to sprints first, then create
  c) Select stories by number (e.g. 1,3,5)
  d) Cancel
```

Wait for the user's choice before any write calls.

---

## Step 3.5 — Sprint planning (if option "b" chosen)

### Config collection

```
Starting iteration path? [default: {ADO_ITERATION_PATH}]
Backend velocity per sprint (points)?   [default: 20]
Frontend velocity per sprint (points)?  [default: 15]
Testing velocity per sprint (points)?   [default: 10]
```

### Fetch available iterations

Fetch from the project classification tree (do NOT use team settings — team iteration subscriptions are often outdated):

```
GET https://dev.azure.com/{org}/{project}/_apis/wit/classificationnodes/iterations?$depth=4&api-version=7.1
```

Walk the tree to build a flat ordered list of iteration paths starting from the user's chosen start. Include all remaining sprints in the same PI, then the first sprints of the next PI if needed.

### Assignment algorithm

1. **Cohesion clusters** — group stories that share a Feature (LLD mode), a `pairKey`, or a `dependsOn` edge. All stories in a cluster must be assigned to the same sprint.
2. **Topological sort** — sort clusters by dependency order using Kahn's algorithm. A cluster whose stories depend on another cluster's stories must appear in a later sprint.
3. **Greedy bin-packing** — for each cluster in sorted order, assign it to the earliest sprint where all three velocity dimensions have enough remaining capacity (`backend + frontend + testing` breakdown per story's discipline). If no sprint can fit the cluster, add it to `overflow`.

### Sprint plan preview

```
Sprint: Digital\Digital X\PI 42\42.4  (2026-08-13 – 2026-08-26)  B: 13/20  F: 12/15  T: 8/10
  #1  [backend  5]  Implement auth token endpoint
  #2  [frontend 2]  Add login form component

Sprint: Digital\Digital X\PI 42\42.5  (2026-08-27 – 2026-09-09)  B: 5/20  F: 0/15  T: 5/10
  #3  [fullstack 5]  Implement session refresh flow

Overflow (no sprint with sufficient capacity):
  #8  [fullstack 13]  Rewrite entire auth layer — too large; split into smaller stories first

Continue with this sprint plan? [y/n]
```

If confirmed: each story gets `System.IterationPath` set to its assigned sprint path.

---

## Step 4 — ADO creation

### Authentication

```powershell
$enc = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes(":$pat"))
$headers = @{ Authorization = "Basic $enc"; "Content-Type" = "application/json" }
```

Never log or echo the PAT value.

### Batch API (primary path)

Build the batch body: an array of PATCH operations with negative tempIds for within-batch parent references. Ordering: Epics first, then Features (each referencing its Epic), then Stories (each referencing its Feature), then Tasks (each referencing its Story).

```json
[
  {
    "method": "PATCH",
    "uri": "/{project}/_apis/wit/workitems/$Epic?api-version=7.1",
    "headers": { "Content-Type": "application/json-patch+json" },
    "body": [
      { "op": "add", "path": "/id", "value": -1 },
      { "op": "add", "path": "/fields/System.Title", "value": "Auth and Identity Layer" },
      { "op": "add", "path": "/fields/System.AreaPath", "value": "{area}" },
      { "op": "add", "path": "/fields/System.IterationPath", "value": "{iteration}" }
    ]
  },
  {
    "method": "PATCH",
    "uri": "/{project}/_apis/wit/workitems/$Feature?api-version=7.1",
    "headers": { "Content-Type": "application/json-patch+json" },
    "body": [
      { "op": "add", "path": "/id", "value": -2 },
      { "op": "add", "path": "/fields/System.Title", "value": "Token issuance" },
      { "op": "add", "path": "/fields/System.AreaPath", "value": "{area}" },
      { "op": "add", "path": "/fields/System.IterationPath", "value": "{iteration}" },
      { "op": "add", "path": "/relations/-", "value": {
          "rel": "System.LinkTypes.Hierarchy-Reverse",
          "url": "vstfs:///WorkItemTracking/WorkItem/-1"
      }}
    ]
  },
  {
    "method": "PATCH",
    "uri": "/{project}/_apis/wit/workitems/$User%20Story?api-version=7.1",
    "headers": { "Content-Type": "application/json-patch+json" },
    "body": [
      { "op": "add", "path": "/id", "value": -3 },
      { "op": "add", "path": "/fields/System.Title", "value": "Implement auth token endpoint" },
      { "op": "add", "path": "/fields/System.Description", "value": "{html description}" },
      { "op": "add", "path": "/fields/Microsoft.VSTS.Common.AcceptanceCriteria", "value": "{html ACs}" },
      { "op": "add", "path": "/fields/System.AreaPath", "value": "{area}" },
      { "op": "add", "path": "/fields/System.IterationPath", "value": "{sprint-assigned iteration}" },
      { "op": "add", "path": "/fields/System.State", "value": "{readyState}" },
      { "op": "add", "path": "/fields/System.BoardLane", "value": "{selectedLane}" },
      { "op": "add", "path": "/fields/System.Tags", "value": "backend" },
      { "op": "add", "path": "/fields/Microsoft.VSTS.Scheduling.StoryPoints", "value": 5 },
      { "op": "add", "path": "/fields/Microsoft.VSTS.Scheduling.StartDate", "value": "{start}" },
      { "op": "add", "path": "/fields/Microsoft.VSTS.Scheduling.TargetDate", "value": "{end}" },
      { "op": "add", "path": "/relations/-", "value": {
          "rel": "System.LinkTypes.Hierarchy-Reverse",
          "url": "vstfs:///WorkItemTracking/WorkItem/-2"
      }}
    ]
  }
]
```

Important:
- Omit `System.BoardLane` and `System.State` entries entirely (do not send empty values) if no board URL was provided.
- Omit `System.Tags` if no discipline was determined.
- For git and document modes (no Epics/Features), the batch contains only User Story items — each with a tempId but no `relations/-` entries unless an Epic wrapper was requested.

Submit the batch:

```powershell
$batchJson = $batchBody | ConvertTo-Json -Depth 20
$result = $batchJson | node "$env:USERPROFILE\.claude\skills\ado-story-creator\ado-batch.mjs" `
  --org "{org}" --project "{project}" --pat $env:AZURE_DEVOPS_PAT
$ids = $result | ConvertFrom-Json
```

The script exits with code 2 and prints `BATCH_NOT_SUPPORTED` if the org does not support the batch endpoint — trigger the sequential fallback in that case.

### Sequential fallback (if batch exits with code 2)

Print: "Batch API unavailable — using sequential creation."

Create items one at a time: Epic → Features → Stories (each immediately linked to its Feature/Epic) → Tasks. Use individual PATCH calls to `/_apis/wit/workitems/$Epic`, `/$Feature`, `/$User%20Story`, `/$Task`. After creating each parent, use its real URL in subsequent children's `relations/-` entries.

### Required field validation errors

If any creation call (batch item or individual PATCH) returns HTTP 400 with `"Required"` in the error body:

1. Extract the `FieldReferenceName` from the error JSON.
2. WIQL query to find a valid value for that field in the same area:
   ```
   SELECT [System.Id],[{FieldRef}] FROM WorkItems
   WHERE [System.AreaPath] UNDER '{area}' AND [{FieldRef}] <> ''
   ORDER BY [System.ChangedDate] DESC
   ```
3. Fetch top 3 results, extract distinct values.
4. If exactly one value: use it silently and retry.
5. If multiple values: ask "ADO requires `{FieldRef}`. Found: {values}. Which for all items?"
6. Retry with the chosen value added. If still fails, print the full error and skip that item.

### Related story links (LLD mode)

After all items are created and real IDs are known, create `Related` links between paired stories:

```
PATCH https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{storyId}?api-version=7.1

[{ "op": "add", "path": "/relations/-", "value": {
    "rel": "System.LinkTypes.Related",
    "url": "https://dev.azure.com/{org}/{project}/_apis/wit/workitems/{relatedStoryId}"
}}]
```

---

## Step 5 — Output report

```
Created in {org}/{project} — {area}:

EPIC #4630608: Auth and Identity Layer
  FEATURE #4631001: Token issuance
    #4630609  [backend  5pts]  Implement auth token endpoint     https://dev.azure.com/...
    #4630610  [frontend 2pts]  Add login form component          https://dev.azure.com/...
  FEATURE #4631002: Session management
    #4630611  [fullstack 5pts] Implement session refresh flow    https://dev.azure.com/...

Sprint assignments:
  Sprint 42.4: #4630609, #4630610
  Sprint 42.5: #4630611

Swimlane: Sprint Goal | State: Ready

{N skipped, K failed — list reasons and raw error messages}
```

If any item failed after retry, print the raw ADO error so the user can fix and re-run for that item.

---

## Rules

- **PAT never echoed** — never print, log, or include the PAT value in any output or intermediate step.
- **Preview gate** — always show the Step 3 preview table and wait for user confirmation before any ADO write call. No exceptions.
- **Three-dot diff** — always use `<base>...HEAD` (three dots) in git mode. Three dots shows only branch-introduced changes.
- **Verb-object titles** — every story title starts with a present-tense verb ("Add", "Implement", "Fix", "Expose", "Validate"). Never gerunds ("Adding") or nouns alone ("Bastion Integration").
- **All ACs in Given/When/Then** — every AC must follow the Given/When/Then format. No exceptions, no "must/shall" substitutes.
- **No placeholder ACs** — every AC names a specific, observable, testable outcome. Never "the feature works correctly" or "tests pass".
- **Fibonacci points** — story points must be one of: 1, 2, 3, 5, 8, 13. Never 4, 6, 7, 9–12.
- **Batch-first** — always attempt the batch API; fall back to sequential only if the script exits with code 2.
- **Document mode ignores binary files** — skip `.png`, `.jpg`, `.pdf`, `.zip`, and other non-text/non-doc formats during the document scan. `.docx` and `.xlsx` are processed via the extraction script, not skipped.
- **Field errors are recoverable** — a 400 validation error for a missing required field is not fatal. Detect, discover valid value, retry once. Only give up after one retry.
- **No em-dash** — use a hyphen `-`, never an em-dash `—`.
- **Cycle-free dependencies** — remove any dependency cycle back-edges before showing the preview; print a warning for each removed edge.
- **Swimlane names are verbatim** — use the exact string from the swimlane API. Do not normalise or reformat.
- **State before lane** — if the target board column maps to a non-"New" state, set `System.State` before `System.BoardLane`; the lane field is ignored by ADO if the state does not match a board column.
