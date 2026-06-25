---
name: update-docs
description: 'Audit and update the docs/ folder to match the current source. Uses a central .docs-verified-sha file for efficient staleness detection (2-3 git calls). Default run updates structured docs only; use "full" for all 16 docs. "check" reports stale docs, a doc filename updates that one doc, "install-hooks" sets up git hooks.'
argument-hint: 'Optional: "full" | "check" | "<DocFilename>.md" | "install-hooks"'
user-invocable: true
---

# update-docs Skill (`/update-docs`)

Keeps the `docs/` folder in sync with the current source tree. Uses a central `.docs-verified-sha`
file to determine which files changed since the last update pass - a single `git diff` call covers
all docs. Two doc tiers have different update strategies:

- **Structured docs** - contain tables or lists that map 1:1 to code (commands, source files,
  parameters). Updated mechanically by re-reading the relevant source files.
- **Narrative docs** - describe features in prose. Updated by surfacing the diff and letting the
  agent rewrite only the stale paragraphs.

---

## Mode detection

Inspect the argument:

| Argument | Mode |
|----------|------|
| _(none)_ | **Mode 1** - structured docs only (fast, 3 git calls) |
| `full` | **Mode 1F** - full audit including all narrative docs |
| `check` | **Mode 2** - report stale docs, no writes |
| `<DocFilename>.md` | **Mode 3** - update that single doc only |
| `install-hooks` | **Mode 4** - install git hooks for staleness tracking |

---

## Doc registry

Each doc is classified and mapped to the source files that trigger a re-audit.

| File | Tier | Triggered by |
|------|------|-------------|
| `AGENT_MODULE_INDEX.md` | structured | any `src/` file (add / remove / rename / role change) |
| `AGENT_CAPABILITIES.md` | structured | `src/index.ts`, `src/server/tools/`, `src/contracts/generateScenariosContract.ts` |
| `HOW_IT_WORKS.md` | narrative | `src/services/scenarioGenerationPipeline.ts`, `src/server/mcpServer.ts` |
| `LOCAL_IDE_USAGE.md` | narrative | `src/index.ts` (new CLI commands) |
| `COPILOT_AGENT_USAGE.md` | narrative | `src/server/tools/` (new or renamed MCP tools) |
| `SETUP_AI_AGENT.md` | narrative | `src/services/consumerInitService.ts`, `src/index.ts` |
| `AUTO_UPDATE.md` | narrative | `src/services/selfUpdateService.ts` |
| `WEB_UI.md` | narrative | `src/server/`, `src/services/activityIndicatorService.ts` |
| `MAVEN_INTEGRATION.md` | narrative | `src/services/mavenSetupService.ts` |
| `CONSISTENCY_ANALYSIS.md` | narrative | `src/services/consistencyAnalysisService.ts` |
| `DISTRIBUTION_AS_DEPENDENCY.md` | narrative | `src/services/consumerInitService.ts` |
| `CAPABILITY_ANALYSIS.md` | narrative | `AGENT_CAPABILITIES.md` (re-derived from it) |
| `COMPREHENSIVE_GUIDE.md` | narrative | any `src/` change |
| `ENTERPRISE_USAGE.md` | narrative | `src/index.ts`, `src/services/consumerInitService.ts` |
| `AI_AGENT_INSTALL_RUNBOOK.md` | narrative | `src/services/consumerInitService.ts`, `src/services/mavenSetupService.ts` |
| `AGENT_RULES.md` | narrative | `src/services/aiGenerationService.ts`, `src/services/scenarioGenerationPipeline.ts` |

---

## Mode 1: Structured docs (default)

Processes only the two structured docs (AGENT_MODULE_INDEX.md, AGENT_CAPABILITIES.md).
Use `/update-docs full` to include all 16 narrative docs.

### Step 0 - Load base SHA
Read `.docs-verified-sha` at the repo root.
- If present: use its contents (trimmed) as `{base-sha}`.
- If absent: first-run - treat all structured docs as stale; use the result of
  `git rev-parse --short HEAD` as `{base-sha}` for diff commands.

### Step 1 - Verify docs/ exists
Check that `docs/` exists at the repo root. If not, abort: "No docs/ directory found at repo root."

### Step 2 - Get current HEAD SHA
```
git rev-parse --short HEAD
```

### Step 3 - Determine staleness (single diff)
```
git diff {base-sha} HEAD --name-only
```
If `{base-sha}` equals HEAD, all docs are current - skip to Step 5.

Use the resulting file list to check each structured doc against its trigger files:
- `AGENT_MODULE_INDEX.md`: stale if any path starting with `src/` appears in the diff.
- `AGENT_CAPABILITIES.md`: stale if `src/index.ts`, any path starting with `src/server/tools/`,
  or `src/contracts/generateScenariosContract.ts` appears in the diff.

Report: `[stale] FILENAME` or `[ok] FILENAME` for each structured doc.

### Step 4 - Process stale structured docs

#### AGENT_MODULE_INDEX.md

This doc mirrors every file in `src/` with a role description and key exports. Update strategy
mirrors `/index-codebase refresh`:

1. Find all `src/` files changed since `{base-sha}` (added / modified / deleted).
2. For each **modified** file: re-read it (first 80 lines), re-derive role + key exports, `Edit`
   the existing row in the table.
3. For each **added** file: read it, derive role + key exports, insert a new row in the correct
   section (grouped by immediate parent directory, sorted alphabetically).
4. For each **deleted** file: remove its row. If the section becomes empty, remove the section
   heading + table.

Role format: plain text, max 80 chars, describes WHAT the file does.
Key exports: backtick-quoted exported identifiers only (no private helpers).
Link format: `[src/services/foo.ts](../src/services/foo.ts)` (relative from `docs/`).

#### AGENT_CAPABILITIES.md

This doc has two structured sections that must stay in sync with source:

**Commands table** (derives from `src/index.ts` dispatch + `src/server/tools/` MCP tool names):
1. Run `git diff {base-sha} HEAD -- src/index.ts src/server/tools/` to get the relevant diff.
2. Read `src/index.ts` lines 125-265 (command dispatch block) and every `src/server/tools/*.ts`
   (tool name + description).
3. For each command/tool: confirm the row exists in the Commands table. Add missing rows; remove
   rows for deleted commands; update the Purpose column if the tool's description changed.
4. Do NOT invent rows for commands that do not appear in the source.

**Parameter reference table** (derives from `src/contracts/generateScenariosContract.ts`):
1. Read `src/contracts/generateScenariosContract.ts` fully.
2. For each field in the Zod schema: confirm a row exists in the Parameter reference table.
   Field name, type (from Zod type), default (from `.default()`), and notes.
3. Add missing fields; remove fields that no longer exist; update type/default if changed.

### Step 5 - Write central SHA and clean up
1. Write the current HEAD SHA to `.docs-verified-sha` at the repo root (overwrite if present).
2. If `.docs-stale` exists at the repo root, delete it.

### Step 6 - Report
List every doc touched with: doc name, action taken (updated N rows / skipped).

---

## Mode 1F: Full audit (`/update-docs full`)

Runs Mode 1 Steps 0-6, extended to cover all 16 docs.

### Step 3F - Extend staleness detection to narrative docs
After the single diff from Step 3, check each narrative doc against its trigger files using the
same changed-files list (prefix/contains matching against the diff output):

- Path prefix matches: `src/server/tools/` matches any path starting with that prefix.
- Exact matches: `src/services/selfUpdateService.ts` matches that exact path.
- `CAPABILITY_ANALYSIS.md` trigger is `AGENT_CAPABILITIES.md` - check if that doc file itself
  appears in the diff (it is a doc-to-doc dependency).

Report: `[stale] FILENAME` or `[ok] FILENAME` for all 16 docs.

### Step 5F - Process stale narrative docs
For each stale narrative doc (after processing stale structured docs per Step 4):

1. Run `git diff {base-sha} HEAD -- {trigger-files}` to get the relevant diff.
2. Read the current doc content.
3. For each changed trigger file: read the first 120 lines of the changed file to understand
   what changed.
4. Identify which paragraphs/sections in the doc describe the changed behavior.
5. `Edit` only those paragraphs - rewrite them to reflect current behavior. Do not touch sections
   that describe unchanged functionality.
6. Do NOT add a SHA anchor to narrative docs.

**Judgment rules for narrative edits:**
- A new CLI command visible in `src/index.ts` -> add to any doc that lists CLI commands.
- A renamed MCP tool -> find every occurrence of the old name and replace.
- A removed feature -> remove or strike-through the section describing it.
- A changed parameter name or default -> update all tables/examples that show it.
- Minor implementation changes (refactors, bug fixes) with no user-visible behavior change -> skip.
- Do NOT expand narrative sections beyond what is needed to reflect the change - preserve existing
  prose style and density.

Then run Step 5 (write `.docs-verified-sha`, clean up `.docs-stale`) and Step 6 (report).

---

## Mode 2: Check (dry run)

Reports staleness for all 16 docs without writing anything.

### Step 0 - Load base SHA
Same as Mode 1 Step 0.

### Step 1 - Single diff
```
git diff {base-sha} HEAD --name-only
```
If `{base-sha}` equals HEAD: all docs current, report immediately.

### Step 2 - Map to docs
For each doc in the registry, check if any of its trigger files appear in the diff output.
Use prefix/contains matching (e.g., `src/server/tools/` matches any path starting with that prefix).

Output:
```
[stale]   AGENT_MODULE_INDEX.md   (trigger: src/services/azureStoryIngestionService.ts)
[stale]   AGENT_CAPABILITIES.md   (trigger: src/server/tools/generateTests.ts)
[ok]      HOW_IT_WORKS.md
[ok]      LOCAL_IDE_USAGE.md
...
```

End with: `N doc(s) stale, M current.`

---

## Mode 3: Single-doc update

Accepts the exact filename (e.g. `AGENT_CAPABILITIES.md`). Runs the same logic as Mode 1 Step 4
or Mode 1F Step 5F for that one file only. Uses `{base-sha}` from `.docs-verified-sha` (or HEAD if
absent) as the baseline for diffs.

Does NOT update `.docs-verified-sha` - only a full Mode 1 or Mode 1F pass advances the checkpoint.

If the filename is not in the doc registry, abort: "Unknown doc '{name}'. Check the registry in
this SKILL.md for the supported list."

---

## Mode 4: Install Hooks (`/update-docs install-hooks`)

Installs lightweight git hooks that mark the docs folder stale after pulls and warn before pushes.
The hooks do NOT invoke Claude - they only write a `.docs-stale` marker file.

### Step 1 - Verify git repo
Check that `.git/` exists at the repo root. If not, abort: "Not a git repository - hooks cannot
be installed."

### Step 2 - Locate hook scripts
The hook scripts ship alongside this skill in the `scripts/` subdirectory:
- `scripts/post-merge-hook.sh` - creates `.docs-stale` after `git pull` / `git merge`
- `scripts/pre-push-hook.sh` - warns (non-blocking) if docs are stale before `git push`

Find the absolute path to the `scripts/` directory relative to this SKILL.md file.

### Step 3 - Check for existing hooks
Before copying, check if `.git/hooks/post-merge` and `.git/hooks/pre-push` already exist and have
content. If either does, show the existing content and ask the user whether to overwrite or append.

### Step 4 - Copy hook scripts
Copy both scripts to `.git/hooks/`:
- `scripts/post-merge-hook.sh` -> `.git/hooks/post-merge`
- `scripts/pre-push-hook.sh` -> `.git/hooks/pre-push`

On Unix/macOS and Git-for-Windows: set executable bit with `chmod +x .git/hooks/post-merge .git/hooks/pre-push`.

On Windows (non-Git-Bash): PowerShell copy suffices - Git-for-Windows executes hooks via its bundled
sh.exe regardless of Windows file permissions.

### Step 5 - Update .gitignore
Add `.docs-stale` and `.docs-verified-sha` to `.gitignore` if not already present. Both are
local state files that must not be committed.

### Step 6 - Suggest CLAUDE.md addition
Print the exact text the user should add to their repo's `CLAUDE.md` (under a "Session resume"
section or equivalent):

```
- If `.docs-stale` exists at the repo root, run `/update-docs` before starting work.
```

### Step 7 - Report
List: which hooks were installed (or skipped), the `.gitignore` change, and the CLAUDE.md suggestion.

---

## Rules

- **No em-dash**: never use `—`; always a regular hyphen `-`.
- **Diffs, not rewrites**: use `Edit` for targeted changes. Never `Write` the whole file unless
  the doc does not yet exist (first-time structured creation).
- **Truthfulness**: never invent capabilities that do not exist in the current source. If unsure
  whether a feature is still present, grep the source before writing.
- **Preserve formatting**: match the existing Markdown style (table column widths, header level,
  link format) of each doc. Do not reformat sections you are not updating.
- **Central SHA tracking**: staleness is determined by `.docs-verified-sha` at the repo root. Only
  a full Mode 1 or Mode 1F pass writes this file. Mode 3 single-doc updates do not advance it.
- **Link format in AGENT_MODULE_INDEX.md**: source file links must be relative from `docs/`,
  e.g. `[src/foo.ts](../src/foo.ts)`. Never use absolute Windows paths.
- **Terse output**: report counts and paths only. Do not narrate what you are about to do.
