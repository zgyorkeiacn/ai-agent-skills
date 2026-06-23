---
name: push-sandbox
description: 'Commit all uncommitted changes and push every submodule and the parent repo in c:\newgit\gherkin-sandbox to their respective GitHub remotes. Submodules are committed+pushed first (agent -> framework -> minerva -> skills), then the parent. Invoke with no args to commit+push all, "check" to preview pending changes without writing, or a submodule path (e.g. "services/agent") to commit+push one repo only.'
argument-hint: 'Optional: "check" | "services/agent" | "services/framework" | "services/minerva" | "skills"'
user-invocable: true
---

# push-sandbox Skill (`/push-sandbox`)

Commits all uncommitted changes and pushes all repos that make up the `c:\newgit\gherkin-sandbox`
workspace to GitHub in the correct order: submodules first so their commits exist on the remote
before the parent updates its pointer SHAs.

## Repo registry

| Role | Local path | Remote | Branch |
|------|-----------|--------|--------|
| submodule | `c:\newgit\gherkin-sandbox\services\agent` | `copilot-ado-figma-gherkin-agent` | `master` |
| submodule | `c:\newgit\gherkin-sandbox\services\framework` | `playwright-be-fe-combined-tdd-framework` | `main` |
| submodule | `c:\newgit\gherkin-sandbox\services\minerva` | `minerva_sandbox` | `main` |
| submodule | `c:\newgit\gherkin-sandbox\skills` | `ai-agent-skills` | `main` |
| parent | `c:\newgit\gherkin-sandbox` | `gherkin-sandbox` | `main` |

Submodule paths and branches are discovered dynamically at runtime via git commands so new
submodules are picked up automatically. The registry above is for reference only.

---

## Mode detection

| Argument | Mode |
|----------|------|
| _(none)_ | **Mode 1** - commit all changes then push all |
| `check` | **Mode 2** - status only, no writes |
| submodule path | **Mode 3** - commit+push one repo only |

---

## Mode 1: Commit + Push all (`/push-sandbox`)

### Step 1 - Discover repos

Run from `c:\newgit\gherkin-sandbox`:

```
git submodule foreach --quiet "echo $displaypath"
```

Collect the list of submodule relative paths. Append the parent (`.`) at the end.
Resolve each to an absolute path by prepending `c:\newgit\gherkin-sandbox\`.

### Step 2 - Inspect each repo

For each repo (submodules first, parent last), run these commands inside that repo's directory:

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
[commit]   services/agent       master   12 uncommitted file(s) (will commit+push)
[commit]   services/framework   feature/123  6 commit(s) ahead + 14 uncommitted file(s)
[commit]   services/minerva     main     5 uncommitted file(s) (will commit+push)
[skip]     skills               main     nothing to commit or push
[commit]   gherkin-sandbox      main     3 uncommitted file(s) (will commit+push)
```

Status codes:
- `[commit]` - has uncommitted changes -> will `git add -A`, commit, then push
- `[ready]` - clean, has unpushed commits -> will push
- `[skip]` - clean, nothing to push -> skip
- `[conflict]` - merge conflict markers present -> skipped (manual resolution required)

### Step 3.5 - Commit each `[commit]` repo

Process in submodule-first order.

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
   [committed] services/agent    docs: update AGENT_CAPABILITIES, MODULE_INDEX, server.js  (abc1234)
   [committed] services/minerva  feat: add TestInspector, update Navbar, SettingsContext   (def5678)
   [committed] gherkin-sandbox   chore: update submodule pointers, start-native.ps1        (ghi9012)
   ```

If `git commit` fails (nothing to commit, empty message, hook rejection): print the error,
mark the repo `[commit-failed]`, and skip the push for that repo.

### Step 4 - Push each `[ready]` (and post-commit) repo sequentially

Push order: submodules first (in the order returned by `git submodule foreach`), parent last.

After Step 3.5, every successfully committed repo is treated as `[ready]`. Push each such repo
plus any originally-`[ready]` repo:

- For repos with a tracked upstream: `git push origin <branch>`
- For repos flagged "untracked remote" (no upstream configured): `git push -u origin <branch>`

Print result:
```
[pushed]  services/agent       master   -> https://github.com/zgyorkei/copilot-ado-figma-gherkin-agent.git
[pushed]  services/framework   feature/123 -> https://github.com/zgyorkei/playwright-be-fe-combined-tdd-framework.git
[pushed]  services/minerva     main     -> https://github.com/zgyorkei/minerva_sandbox.git
[skipped] skills               main     nothing to commit or push
[pushed]  gherkin-sandbox      main     -> https://github.com/zgyorkei/gherkin-sandbox.git
```

If a push fails: print the error, mark the repo `[failed]`, and continue with remaining repos.
Report all failures at the end.

### Step 5 - Final report

```
Committed: N repo(s)   Pushed: M repo(s)   Skipped: K   Failed: L
```

If any `[failed]` or `[commit-failed]`: surface the error messages.

---

## Mode 2: Check (`/push-sandbox check`)

Runs Steps 1-3 from Mode 1 (discovery + inspect + summary) but writes nothing.

For each repo with uncommitted changes (`[commit]`), also print the full `git status --short`
output so the user can review what would be staged and committed:

```
services/agent (12 uncommitted files):
   M docs/AGENT_CAPABILITIES.md
   M docs/AGENT_MODULE_INDEX.md
   M docs/COMPREHENSIVE_GUIDE.md
   M src/webui/server.js
   ...

services/minerva (5 uncommitted files):
   M src/App.jsx
   M src/components/layout/Navbar.jsx
   M src/context/SettingsContext.jsx
   M vite.config.js
  ?? src/components/ui/TestInspector.jsx
```

For each `[ready]` repo, print the full unpushed commit log:

```
services/framework (6 unpushed commits):
  abc1234 Add Minerva component showcase
  def5678 Add playwright config
  ...
```

End with: `Run /push-sandbox to commit and push the above.`

---

## Mode 3: Commit+Push one repo (`/push-sandbox <path>`)

Accepted values: `services/agent`, `services/framework`, `services/minerva`, `skills`,
or `gherkin-sandbox` (for the parent).

1. Resolve the argument to an absolute path under `c:\newgit\gherkin-sandbox`.
2. If the path does not exist or has no `.git`, abort: "Unknown repo '{arg}'."
3. Run Steps 2-3.5-4 from Mode 1 for that single repo only.
4. For the parent repo (`gherkin-sandbox`): commit+push as normal. Note that if submodule pointer
   commits haven't been pushed yet, GitHub will show unresolvable submodule SHAs - warn the user.

---

## Rules

- **No em-dash**: never use `-`; use a regular hyphen `-`.
- **Push submodules before parent**: always. The parent's pointer commits reference submodule
  SHAs that must exist on the remote before the parent is pushed.
- **Never force-push**: do not use `--force` or `--force-with-lease` unless the user explicitly
  requests it in their message. Warn if the remote has diverged instead.
- **Auto-commit before push**: `git add -A` stages everything including untracked files. Repos
  in conflict state (`UU`/`AA`/`DD` in `git status --short`) are skipped with `[conflict]` -
  never auto-commit mid-merge.
- **Upstream tracking**: use `git push -u origin <branch>` when the repo has no configured
  upstream (detected when `git log origin/<branch>..HEAD` errors during inspection).
- **One push at a time**: do not parallelize pushes. Sequential order matters (submodules before
  parent) and concurrent pushes to the same remote can cause confusion.
- **Terse output**: one status line per repo during the summary. Show full file lists only in
  `check` mode.
