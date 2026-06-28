---
name: purge-em-dash
description: Scan the entire repo (and all submodules) for em-dash characters (U+2014) and replace every occurrence with a regular hyphen. Also injects the em-dash prohibition rule into any CLAUDE.md, GEMINI.md, or copilot-instructions.md that lacks it. Use "check" for a dry run.
user-invocable: true
argument-hint: 'Optional: "check"'
---

# purge-em-dash Skill (`/purge-em-dash`)

Scans all text files in the current repo and its submodules for em-dash characters (U+2014, `—`)
and replaces every occurrence with a plain hyphen (`-`). Also enforces the prohibition rule in AI
instruction files that are missing it.

---

## Mode detection

| Argument | Mode |
|----------|------|
| _(none)_ | **Mode 1** - replace in place + inject missing rules, report counts |
| `check`  | **Mode 2** - dry run, report violations, no writes |

---

## File scope

Apply to both modes:

**Include extensions:** `*.ts`, `*.tsx`, `*.js`, `*.jsx`, `*.md`, `*.html`, `*.css`, `*.json`,
`*.feature`, `*.txt`, `*.yml`, `*.yaml`

**Exclude paths:** `node_modules/`, `.git/`, `dist/`, `build/`, `target/`, `.venv/`, `coverage/`

**Repos to process:**
1. Detect repo root: `git rev-parse --show-toplevel` (fall back to cwd if not a git repo).
2. If `.gitmodules` exists at the repo root, also process each submodule path listed by
   `git submodule foreach --quiet "echo $displaypath"`.

---

## Mode 1: Replace + Enforce

### Step 1 - Em-dash purge

Run the following PowerShell against each repo directory (root + each submodule):

```powershell
$exts = '*.ts','*.tsx','*.js','*.jsx','*.md','*.html','*.css','*.json','*.feature','*.txt','*.yml','*.yaml'
Get-ChildItem -Path <repoDir> -Recurse -Include $exts -File |
  Where-Object { $_.FullName -notmatch '(node_modules|\.git|[\\/]dist[\\/]|[\\/]build[\\/]|target|\.venv|coverage)' } |
  ForEach-Object {
    $content = Get-Content -Path $_.FullName -Raw -Encoding UTF8
    if ($content -and $content -match [char]0x2014) {
      $newContent = $content -replace [char]0x2014, '-'
      Set-Content -Path $_.FullName -Value $newContent -Encoding UTF8 -NoNewline
    }
  }
```

Track: number of files modified, total em-dash characters replaced.

### Step 2 - Rule enforcement

Within the same file traversal, identify every file whose **name** (not path) is one of:
`CLAUDE.md`, `GEMINI.md`, `copilot-instructions.md`

For each such file:
1. Read its content.
2. Check if the string `em-dash` appears anywhere (case-insensitive).
3. **If absent** - inject the rule:
   - Search for the first heading line (`##` or `###`) whose text contains `Style`, `Brevity`,
     `Rules`, or `Convention` (case-insensitive).
   - If a matching heading is found: append the following bullet immediately after the last
     existing bullet under that heading (before the next blank line + heading):
     ```
     - Never use the em-dash character (U+2014). Always use a regular hyphen (-) instead, in both prose and generated artifacts.
     ```
   - If no matching heading is found: append the following block at the very end of the file
     (preceded by a blank line):
     ```

     ## Style Rules

     - Never use the em-dash character (U+2014). Always use a regular hyphen (-) instead, in both prose and generated artifacts.
     ```
4. **If present** - skip (already enforced).

### Step 3 - Report

```
Scanned:   N file(s) across M repo(s)
Purged:    N file(s) - M em-dash character(s) replaced
Enforced:  N file(s) - rule injected (CLAUDE.md / GEMINI.md / copilot-instructions.md)
Skipped:   N file(s) - rule already present
```

---

## Mode 2: Check (dry run)

Same traversal, no writes. Report:

**Em-dashes found:**
```
path/to/file.md          3 occurrence(s)
path/to/another.ts       1 occurrence(s)
```

**Instruction files missing the rule:**
```
path/to/CLAUDE.md        em-dash rule absent
path/to/GEMINI.md        em-dash rule absent
```

End with:
```
N file(s) contain em-dashes, M instruction file(s) missing rule.
Run /purge-em-dash to fix.
```

If everything is clean:
```
Clean - no em-dashes found, all instruction files have the rule.
```

---

## Rules

- **Never use em-dash**: The em-dash character (U+2014, `—`) must never appear in any project file.
  Always use a regular hyphen (`-`) instead - in prose, code comments, generated docs, and any
  other artifact. This rule applies to all AI models working in this workspace.
- **No writes in check mode**: Mode 2 is strictly read-only. Never modify files when `check` is
  the argument.
- **Preserve encoding**: Write files back as UTF-8 without BOM, preserving original line endings.
- **Submodules included**: Always process submodules - em-dashes in submodule files are just as
  unwanted as in the root repo.
- **Terse output**: report counts and paths only; no narration.
