---
name: git-handler
description: 'Commit all uncommitted changes and push all configured repositories in order. Repos are configured in ~/.claude/git-handler-repos.json. Invoke with no args to commit+push all, "check" to preview pending changes without writing, a repo path or label to commit+push one repo only, or "configure" to view/add/remove repos.'
argument-hint: 'Optional: "check" | "configure" | "configure add <path>" | "configure remove <path>" | <repo-path-or-label>'
user-invocable: true
---

# git-handler Skill (`/git-handler`)

Commits all uncommitted changes and pushes all configured repositories to their GitHub remotes.
Repos are listed in `~/.claude/git-handler-repos.json` and pushed in array order - put
submodules before their parent so pointer SHAs exist on the remote before the parent is pushed.

## Repo config

Repos are stored in `~/.claude/git-handler-repos.json`:

```json
{
  "repos": [
    { "path": "c:\\newgit\\gherkin-sandbox\\services\\agent" },
    { "path": "c:\\newgit\\gherkin-sandbox\\services\\framework" },
    { "path": "c:\\newgit\\gherkin-sandbox\\services\\minerva" },
    { "path": "c:\\newgit\\gherkin-sandbox\\skills" },
    { "path": "c:\\newgit\\gherkin-sandbox" }
  ]
}
```

Each entry requires only `path`. Branch and remote are discovered at runtime via git commands.
Array order controls push order - first entry is pushed first.

Use the installer's Configure button or `/git-handler configure add <path>` to manage the list.

---

## Mode detection

| Argument | Mode |
|----------|------|
| _(none)_ | **Mode 1** - commit all changes then push all |
| `check` | **Mode 2** - status only, no writes |
| repo path or label | **Mode 3** - commit+push one repo only |
| `configure` | **Mode 4** - list configured repos |
| `configure add <path>` | **Mode 4** - add a repo to the config |
| `configure remove <path>` | **Mode 4** - remove a repo from the config |

---

## Mode 1: Commit + Push all (`/git-handler`)

### Step 1 - Load config

Read `~/.claude/git-handler-repos.json`. If the file does not exist or `repos` is empty, abort:

```
No repos configured. Run /git-handler configure add <path> to add repos.
```

Collect the list of absolute paths. Derive a display label for each repo using
`path.basename(repoPath)`.

### Step 2 - Inspect each repo

For each repo (in config array order), run these commands inside that repo's directory:

```
git rev-parse --abbrev-ref HEAD          # current branch
git remote get-url origin                # remote URL
git status --short                       # working tree state
git log origin/<branch>..HEAD --oneline  # unpushed commits
```

If `git log origin/<branch>..HEAD` errors (no tracking branch yet), use `git log HEAD --oneline`
and flag the repo as "untracked remote" - remember this flag for the push step.

Classify each repo using this logic (evaluated in order, first match wins):

- `[conflict]` - `git status --short` contains any line starting with `UU`, `AA`, or `DD` (merge conflict markers) -> skip; never auto-commit mid-merge
- `[commit]` - `git status --short` has any non-empty lines (staged col-1 non-space, unstaged `_M`/`_D`, or untracked `??`) -> will `git add -A` + commit + push
- `[ready]` - clean working tree AND has unpushed commits -> will push directly
- `[skip]` - clean working tree AND nothing to push -> skip

Note: `[commit]` covers all dirty states. Whether changes are staged, unstaged, or untracked
does not matter - they all get committed. If a `[commit]` repo also has unpushed commits, those
are pushed together with the new commit.

### Step 3 - Print pre-push summary

Print one line per repo:

```
[commit]   agent                master   12 uncommitted file(s) (will commit+push)
[commit]   framework            feature/123  6 commit(s) ahead + 14 uncommitted file(s)
[commit]   minerva              main     5 uncommitted file(s) (will commit+push)
[skip]     skills               main     nothing to commit or push
[commit]   gherkin-sandbox      main     3 uncommitted file(s) (will commit+push)
```

Status codes:
- `[commit]` - has uncommitted changes -> will `git add -A`, commit, then push
- `[ready]` - clean, has unpushed commits -> will push
- `[skip]` - clean, nothing to push -> skip
- `[conflict]` - merge conflict markers present -> skipped (manual resolution required)

### Step 3.5 - Commit each `[commit]` repo

Process in config array order.

For each `[commit]` repo:

1. Stage all changes:
   ```
   git add -A
   ```

2. Run `git diff --cached --stat` to see what is staged.

3. Generate a commit message using this logic:
   - Look at all file paths in the stat output.
   - Determine the commit **type**:
     - All paths under `docs/` only -> `docs`
     - All paths are submodule entries (parent repo only) or config files (`*.json`, `*.ps1`, `*.config.*`, `*.toml`) -> `chore`
     - Any path under `src/` or source file -> `feat` (for new files) or `fix` (for modifications only)
     - Mixed -> `chore` (safe default)
   - Derive a short **description**: list the most notable basenames (strip path), comma-separated,
     capped at ~55 chars total. For the parent repo with submodule pointer changes, use
     `update submodule pointers` as the description (optionally append any non-submodule files).
   - Full format: `<type>: <description>`
   - Examples:
     - `docs: update AGENT_CAPABILITIES, MODULE_INDEX, server.js`
     - `feat: add TestInspector, update Navbar, SettingsContext`
     - `chore: update submodule pointers, start-native.ps1`

4. Commit:
   ```
   git commit -m "<generated message>"
   ```

5. Print result:
   ```
   [committed] agent            docs: update AGENT_CAPABILITIES, MODULE_INDEX, server.js  (abc1234)
   [committed] minerva          feat: add TestInspector, update Navbar, SettingsContext   (def5678)
   [committed] gherkin-sandbox  chore: update submodule pointers, start-native.ps1        (ghi9012)
   ```

If `git commit` fails (nothing to commit, empty message, hook rejection): print the error,
mark the repo `[commit-failed]`, and skip the push for that repo.

### Step 4 - Push each `[ready]` (and post-commit) repo sequentially

Push order: config array order (first to last).

After Step 3.5, every successfully committed repo is treated as `[ready]`. Push each such repo
plus any originally-`[ready]` repo:

- For repos with a tracked upstream: `git push origin <branch>`
- For repos flagged "untracked remote" (no upstream configured): `git push -u origin <branch>`

Print result:
```
[pushed]  agent            master   -> https://github.com/zgyorkei/copilot-ado-figma-gherkin-agent.git
[pushed]  framework        feature/123 -> https://github.com/zgyorkei/playwright-be-fe-combined-tdd-framework.git
[pushed]  minerva          main     -> https://github.com/zgyorkei/minerva_sandbox.git
[skipped] skills           main     nothing to commit or push
[pushed]  gherkin-sandbox  main     -> https://github.com/zgyorkei/gherkin-sandbox.git
```

If a push fails: print the error, mark the repo `[failed]`, and continue with remaining repos.
Report all failures at the end.

### Step 5 - Final report

```
Committed: N repo(s)   Pushed: M repo(s)   Skipped: K   Failed: L
```

If any `[failed]` or `[commit-failed]`: surface the error messages.

---

## Mode 2: Check (`/git-handler check`)

Runs Steps 1-3 from Mode 1 (load config + inspect + summary) but writes nothing.

For each repo with uncommitted changes (`[commit]`), also print the full `git status --short`
output so the user can review what would be staged and committed:

```
agent (12 uncommitted files):
   M docs/AGENT_CAPABILITIES.md
   M docs/AGENT_MODULE_INDEX.md
   M src/webui/server.js
   ...

minerva (5 uncommitted files):
   M src/App.jsx
   M src/components/layout/Navbar.jsx
  ?? src/components/ui/TestInspector.jsx
```

For each `[ready]` repo, print the full unpushed commit log:

```
framework (6 unpushed commits):
  abc1234 Add Minerva component showcase
  def5678 Add playwright config
  ...
```

End with: `Run /git-handler to commit and push the above.`

---

## Mode 3: Commit+Push one repo (`/git-handler <path-or-label>`)

Accepted values: any configured repo's full path or its basename label (e.g. `agent`, `minerva`,
`gherkin-sandbox`). Match against the `path` field (exact or suffix) and `path.basename(path)`.

1. Load `~/.claude/git-handler-repos.json` and find the matching entry.
2. If no match, abort: "Unknown repo '{arg}'. Run /git-handler configure to see available repos."
3. Run Steps 2-3.5-4 from Mode 1 for that single repo only.
4. Note: if pushing a parent repo whose submodule pointer commits have not been pushed yet, warn
   the user that GitHub will show unresolvable submodule SHAs.

---

## Mode 4: Configure (`/git-handler configure`)

### List repos
Print the current contents of `~/.claude/git-handler-repos.json`:

```
Configured repos (push order):
  1. c:\newgit\gherkin-sandbox\services\agent
  2. c:\newgit\gherkin-sandbox\services\framework
  3. c:\newgit\gherkin-sandbox\services\minerva
  4. c:\newgit\gherkin-sandbox\skills
  5. c:\newgit\gherkin-sandbox
```

If the file does not exist or is empty, print: `No repos configured.`

### Add a repo (`/git-handler configure add <path>`)

1. Read `~/.claude/git-handler-repos.json` (create `{ "repos": [] }` if missing).
2. Check that `<path>` is not already in the list (compare after normalizing slashes).
3. Verify `<path>` exists and has a `.git` entry (file or directory).
4. Append `{ "path": "<path>" }` to the `repos` array.
5. Write the file back.
6. Print: `Added: <path>  (position N)`

### Remove a repo (`/git-handler configure remove <path>`)

1. Read `~/.claude/git-handler-repos.json`.
2. Find the entry matching `<path>` (by full path or basename label).
3. If not found, print: `Not found: '<path>'`
4. Remove the entry and write the file back.
5. Print: `Removed: <path>`

---

## Rules

- **No em-dash**: never use `-`; use a regular hyphen `-`.
- **Push in config order**: always respect the array order in the config file. Put submodules
  before their parent to ensure pointer SHAs exist on the remote before the parent is pushed.
- **Never force-push**: do not use `--force` or `--force-with-lease` unless the user explicitly
  requests it in their message. Warn if the remote has diverged instead.
- **Auto-commit before push**: `git add -A` stages everything including untracked files. Repos
  in conflict state (`UU`/`AA`/`DD` in `git status --short`) are skipped with `[conflict]` -
  never auto-commit mid-merge.
- **Upstream tracking**: use `git push -u origin <branch>` when the repo has no configured
  upstream (detected when `git log origin/<branch>..HEAD` errors during inspection).
- **One push at a time**: do not parallelize pushes. Sequential order matters and concurrent
  pushes to the same remote can cause confusion.
- **Terse output**: one status line per repo during the summary. Show full file lists only in
  `check` mode.
