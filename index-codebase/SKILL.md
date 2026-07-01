---
name: index-codebase
description: 'Generate and maintain CODEBASE_INDEX.md - a human+AI-readable module index grouped by directory with roles and key exports. Invoke with no args for full generation, "refresh" for delta update, or "install-hooks" to set up git staleness tracking.'
argument-hint: 'Optional: "refresh" | "install-hooks"'
user-invocable: true
---

# index-codebase Skill (`/index-codebase`)

Generates and maintains a `CODEBASE_INDEX.md` for the **current working repository** - a human+AI-readable
module index grouped by directory with role descriptions and key exports. Modelled on the format of
`docs/AGENT_MODULE_INDEX.md` in copilot-ado-figma-gherkin-agent, but generic and language-aware.

The index is the single fastest way for a fresh agent session to locate code without cold-grepping the
entire source tree.

---

## Mode detection

Inspect the argument passed by the user:

| Argument | Mode |
|----------|------|
| _(none)_ or unknown | **Mode 1** - full generation |
| `refresh` | **Mode 2** - incremental delta |
| `install-hooks` | **Mode 3** - git hook installation |

---

## Mode 1: Full Generation (`/index-codebase`)

### Step 1 - Detect output path
- If a `docs/` directory exists at the repo root, write to `docs/CODEBASE_INDEX.md`.
- Otherwise write to `CODEBASE_INDEX.md` at the repo root.

### Step 2 - Detect primary language
Check for these files at the repo root (first match wins):

| File | Language |
|------|----------|
| `package.json` | TypeScript / JavaScript |
| `pom.xml` or `build.gradle` | Java |
| `setup.py` or `pyproject.toml` | Python |
| `go.mod` | Go |
| `Cargo.toml` | Rust |
| _(none)_ | Generic (list all text files) |

### Step 3 - Detect source root(s)
Look for `src/`, `lib/`, `app/`, `main/` directories at the repo root. Use all that exist. If none
found, treat the repo root as the source root (exclude `.git/`, `node_modules/`, `dist/`, `build/`,
`target/`, `.venv/`, `vendor/`, `__pycache__/`).

### Step 4 - Glob source files
Use language-specific patterns. Apply exclusions ruthlessly - the index covers production source only.

**TypeScript / JavaScript:**
- Include: `**/*.ts`, `**/*.tsx`, `**/*.js`, `**/*.jsx` (inside source roots)
- Exclude: `**/*.test.*`, `**/*.spec.*`, `**/*.d.ts`, `node_modules/`, `dist/`, `build/`, `.next/`,
  `coverage/`, `__mocks__/`

**Java:**
- Include: `**/*.java`
- Exclude: `**/test/**`, `**/tests/**`, `**/*Test.java`, `**/generated/**`, `target/`

**Python:**
- Include: `**/*.py`
- Exclude: `**/test_*.py`, `**/*_test.py`, `**/tests/**`, `**/__pycache__/**`, `.venv/`, `venv/`

**Go:**
- Include: `**/*.go`
- Exclude: `**/*_test.go`, `vendor/`

**Rust:**
- Include: `**/*.rs`
- Exclude: `**/tests/**`, `target/`

**Generic fallback:**
- Include everything that is not `.git/`, a known dependency dir, or a binary file.

### Step 5 - Batch-read and analyze files
Read files in batches of 10-15 to stay within context. For each file, read the first 80-100 lines.
Extract two things:

- **Role**: a concise description (max 80 chars) of what this file does - inferred from its directory
  position, filename, and content. Examples: "CLI entry point - parses argv and dispatches commands",
  "HTTP client for Azure DevOps REST API", "Zod input schema + parser for generation input".

- **Key exports**: the public identifiers other modules import. For TypeScript: lines starting with
  `export function`, `export class`, `export const`, `export type`, `export interface`. For Java:
  `public class`, `public interface`, `public enum` + notable `public` methods. For Python: top-level
  `class` and `def` names. For Go: exported `func` names and type names (first-letter uppercase). List
  as comma-separated backtick-quoted names.

### Step 6 - Group by directory and write tables
Group files by their immediate parent directory. Use one Markdown table per directory section:

```markdown
## src/services/

| File | Role | Key exports |
|------|------|-------------|
| [azureStoryIngestionService.ts](src/services/azureStoryIngestionService.ts) | Build the ADO story graph from a story or saved-query URL | `buildAzureStoryGraph()` |
```

- File cell: relative Markdown link from the repo root.
- Role cell: plain text, max ~80 chars.
- Key exports cell: backtick-quoted identifiers, comma-separated.
- Directory heading: relative path with trailing slash (e.g., `## src/services/`).
- Sort sections alphabetically by directory path. Sort rows by filename within each section.

### Step 7 - Add "Typical data flow" section
Identify the primary entry point (e.g., `src/index.ts`, `main.py`, `Main.java`, `cmd/main.go`).
If the call chain is inferable from the files just read, write a short ASCII flow:

```
src/index.ts (CLI) -> src/server/tools/<command>.ts -> src/services/pipeline.ts
  -> ingestion: azureStoryIngestion / figmaFlow
  -> generation: aiGenerationService
  -> deployment: repoDeploymentService
```

If not inferable, leave a placeholder:
```
{TODO: describe primary data flow after reviewing src/}
```

### Step 8 - Add header and record SHA
Use the template from `templates/CODEBASE_INDEX.template.md` for the header block. Run:
```
git rev-parse --short HEAD
```
Embed the result in: `_Last verified against commit \`{SHA}\`_`

### Step 9 - Clean up stale marker
If `.codebase-index-stale` exists at the repo root, delete it.

### Step 9a - Inject navigation rule

After cleaning up the stale marker, inject a "Codebase navigation" rule block into AI tool
config files so every AI tool reads CODEBASE_INDEX.md before planning or implementing.

**Locate available indexes:**
Collect all `CODEBASE_INDEX.md` paths relative to the repo root (root index + any submodule
indexes already present on disk, e.g. `services/agent/docs/CODEBASE_INDEX.md`). Format as a
Markdown bullet list.

**Guard marker:** The rule block is wrapped in HTML comment markers:
`<!-- index-codebase:navigation-rule -->` ... `<!-- index-codebase:navigation-rule:end -->`

Before injecting, search each target file for the opening marker:
- If marker is **absent**: append the rule block to the end of the file (add a blank line first).
- If marker is **present**: compare the index list inside against the current list; `Edit` the
  block in place if the list changed. Skip if already up to date.

**Rule block template** (CLAUDE.md, GEMINI.md, copilot-instructions.md):
```
<!-- index-codebase:navigation-rule -->
## Codebase navigation
Before planning or implementing any change, read the relevant CODEBASE_INDEX.md to
identify which files need modification. Available indexes:
- `{path/to/CODEBASE_INDEX.md}`
- (one bullet per index found)
<!-- index-codebase:navigation-rule:end -->
```

**Target files and actions:**

| File | Condition | Action |
|------|-----------|--------|
| `CLAUDE.md` | Always | Create if absent; append/update rule block |
| `GEMINI.md` | Always | Create if absent; append/update rule block |
| `.github/copilot-instructions.md` | Only if `.github/` dir exists | Create file with rule block if absent; append/update if present |
| `.cursor/rules/codebase-navigation.mdc` | Only if `.cursor/` dir exists | Create `rules/` dir and file if absent; update if marker found |

**`.cursor/rules/codebase-navigation.mdc` format** (no HTML comments - use YAML frontmatter):
```
---
description: Read CODEBASE_INDEX.md before planning or implementing any change
alwaysApply: true
---
## Codebase navigation
Before planning or implementing any change, read the relevant CODEBASE_INDEX.md to
identify which files need modification. Available indexes:
- `{path/to/CODEBASE_INDEX.md}`
```
For Cursor files, detect staleness by checking if the `description:` frontmatter line is present
and if the index list matches current paths.

**Submodule scope:** When Step 9a runs inside a submodule context (called from Submodule
discovery), scope injection to the submodule root - update that submodule's `CLAUDE.md`,
`GEMINI.md`, `.github/copilot-instructions.md`, and `.cursor/rules/` if they exist.

### Step 10 - Report
State: output file path, total source files indexed, SHA recorded, line count of generated file.

### Step 11 - Process submodules
If `.gitmodules` exists at the repo root, run the **Submodule Phase** (see
`## Submodule discovery` below) after the root index is written. For each qualifying
submodule, run Mode 1 Steps 1-9 scoped to the submodule root.

---

## Mode 2: Incremental Refresh (`/index-codebase refresh`)

Use this when source files have changed since the last full generation (e.g., after a `git pull` that
left `.codebase-index-stale` at the repo root).

### Step 1 - Read current index
Read `docs/CODEBASE_INDEX.md` (or `CODEBASE_INDEX.md` if no `docs/`). Extract the recorded SHA from
the line matching: `_Last verified against commit \`{SHA}\`_`

If no index file exists, fall through to Mode 1 (full generation).

### Step 2 - Find changed source files
Run these commands:

```sh
git diff {sha} HEAD --name-only --diff-filter=M  # modified
git diff {sha} HEAD --name-only --diff-filter=A  # added
git diff {sha} HEAD --name-only --diff-filter=D  # deleted
```

Also detect uncommitted (working tree) changes - these count as modified even before a commit:

```sh
git diff HEAD --name-only          # unstaged changes
git diff --cached --name-only      # staged changes
```

Merge all lists (committed + uncommitted), deduplicate, and filter to source file extensions
(same patterns as Mode 1 Step 4). Files that appear only in the uncommitted lists are treated
as "modified" for row updates; they do not affect the SHA tracking line.

### Step 3 - Early exit
If no modified, added, or deleted source files: report "index is up to date (SHA: {sha})" and stop.

### Step 4 - Update modified files
For each modified source file:
1. Read it (first 80-100 lines).
2. Re-derive role and key exports.
3. Locate its row in the index by searching for the filename.
4. `Edit` that row in place - do NOT rewrite the whole file.

### Step 5 - Remove deleted files
For each deleted source file: find its table row in the index and remove it. If removing the row
leaves a section with no remaining rows, remove the entire section heading + table too.

### Step 6 - Add new files
For each added source file:
1. Read it (first 80-100 lines), derive role + key exports.
2. Determine its directory section.
3. If the section exists: append the row to the end of that table.
4. If the section does not exist: create a new `## {dir}/` section with a new table, inserted in
   alphabetical order among existing sections.

### Step 7 - Update SHA
Edit the `_Last verified against commit \`{old-sha}\`` line, replacing `{old-sha}` with the new SHA
from `git rev-parse --short HEAD`.

### Step 8 - Clean up stale marker
Delete `.codebase-index-stale` if present.

### Step 8a - Inject navigation rule
Run the same logic as Mode 1 Step 9a, scoped to the current repo root. Collect all
CODEBASE_INDEX.md paths on disk (root + submodule indexes) and update/create the rule block
in CLAUDE.md, GEMINI.md, `.github/copilot-instructions.md`, and `.cursor/rules/` as described
in Mode 1 Step 9a.

### Step 9 - Report
State: counts of updated/added/removed rows, old SHA -> new SHA.

### Step 10 - Process submodules
If `.gitmodules` exists at the repo root, run the **Submodule Phase** (see
`## Submodule discovery` below) after the root index is refreshed. For each qualifying
submodule, run Mode 2 Steps 1-9 scoped to the submodule root.

---

## Mode 3: Install Hooks (`/index-codebase install-hooks`)

Installs lightweight git hooks that mark the codebase index stale after pulls and warn before pushes.
The hooks do NOT invoke Claude - they only write a marker file.

### Step 1 - Verify git repo
Check that `.git/` exists at the repo root. If not, abort with: "Not a git repository - hooks cannot
be installed."

### Step 2 - Locate hook scripts
The hook scripts ship alongside this skill in the `scripts/` subdirectory:
- `scripts/post-merge-hook.sh` - creates `.codebase-index-stale` after `git pull` / `git merge`
- `scripts/pre-push-hook.sh` - warns (non-blocking) if index is stale before `git push`

Find the absolute path to the `scripts/` directory relative to this SKILL.md file.

### Step 3 - Check for existing hooks
Before copying, check if `.git/hooks/post-merge` and `.git/hooks/pre-push` already exist and have
content. If either does, show the existing content and ask the user whether to overwrite.

### Step 4 - Copy hook scripts
Copy both scripts to `.git/hooks/`:
- `scripts/post-merge-hook.sh` -> `.git/hooks/post-merge`
- `scripts/pre-push-hook.sh` -> `.git/hooks/pre-push`

On Unix/macOS and Git-for-Windows: set executable bit with `chmod +x .git/hooks/post-merge .git/hooks/pre-push`.

On Windows (non-Git-Bash): PowerShell copy suffices - Git-for-Windows executes hooks via its bundled
sh.exe regardless of Windows file permissions.

### Step 5 - Update .gitignore
Add `.codebase-index-stale` to `.gitignore` if not already present. The marker file is local state
and must not be committed.

### Step 6 - Suggest CLAUDE.md addition
Print the exact text the user should add to their repo's `CLAUDE.md` (under a "Session resume"
section or equivalent):

```
- If `.codebase-index-stale` exists at the repo root, run `/index-codebase refresh` before starting work.
```

### Step 7 - Report
List: which hooks were installed (or skipped), the `.gitignore` change, and the CLAUDE.md suggestion.

---

## Submodule discovery

Applies when `.gitmodules` exists at the repo root (referenced by Mode 1 Step 11 and
Mode 2 Step 10).

1. Run `git submodule status` at the repo root.
   Parse each line: `[+- ]<SHA> <path> [(<ref>)]`
2. For each submodule path:
   a. Get current branch: `git -C <path> rev-parse --abbrev-ref HEAD`
   b. Skip if the branch starts with `feature/`. Report:
      `[submodule: <path>] skipped - feature/ branch`
3. "Changed files" for a qualifying submodule combines three sources (deduplicated):
   a. Committed since last check:
      `git -C <path> diff <base-sha> HEAD --name-only 2>/dev/null`
      (omit if no base-sha exists for this submodule's index)
   b. Unstaged: `git -C <path> diff HEAD --name-only`
   c. Staged:   `git -C <path> diff --cached --name-only`
   Filter each list to source file extensions (same patterns as Mode 1 Step 4) before merging.

For each qualifying submodule (non-feature branch):

4. Detect source root: look for `src/`, `lib/`, `app/`, `main/` inside the submodule root.
   If none found, skip: `[submodule: <path>] skipped - no source root`

5. Determine existing index:
   - Check `<submodule>/docs/CODEBASE_INDEX.md`, then `<submodule>/CODEBASE_INDEX.md`.
   - If neither exists: run Mode 1 Steps 1-9a with the submodule root as the working directory.
     Write the index to `<submodule>/docs/` if that directory exists, else to the submodule root.
   - If an index exists: read its SHA line to get base-sha. Collect changed files per step 3.
     If no changes: report `[submodule: <path>] up to date (SHA: <sha>)` and skip.
     If changes exist: run Mode 2 Steps 4-8 with the submodule root as working directory.
     Uncommitted files (from `git diff HEAD` / `git diff --cached`) are included in the
     modified/added file lists for row updates.

6. Report: `[submodule: <path>] <result summary>` for each submodule processed.

---

## Rules

- **No em-dash**: never use `-`; use a regular hyphen `-` in all generated Markdown.
- **Relative links**: index table file cells use relative Markdown links from the repo root
  (`[src/foo.ts](src/foo.ts)`), never absolute Windows paths.
- **Role column**: plain text, max ~80 chars. Describe the WHAT, not the HOW.
- **Key exports column**: only public/exported identifiers - no private helpers, no internal types.
- **Test exclusion**: never index test files, spec files, generated files, or lock files.
- **Diffs in refresh mode**: always `Edit` individual rows/sections; never `Write` the entire index
  file. A full `Write` discards human edits and breaks the SHA tracking line.
- **Large repos**: if source file count exceeds ~200, process one top-level directory at a time.
  Write the section to the index before moving to the next directory, so progress is preserved.
- **Terse output**: do not repeat back the user's instructions; report only counts, paths, and SHAs.
