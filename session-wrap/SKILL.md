---
name: session-wrap
description: After an implementation is complete, write a session summary, archive expired summaries, prompt to compact the conversation, and auto-inject context into the next session.
user-invocable: true
argument-hint: '"check" | "config <N>" | "install-hooks"'
---

# session-wrap Skill (`/session-wrap`)

Wraps up a completed implementation session by writing a concise summary to a local file, archiving
old summaries on a configurable schedule, patching `CLAUDE.md` so the next session loads context
automatically, and prompting the user to compact and switch sessions. A companion hook
(`install.ps1`) auto-spawns a new `claude` terminal once the summary is written.

---

## Mode detection

Inspect the argument passed to the skill:

| Argument | Mode |
|----------|------|
| _(none)_ | **Mode 1** - write summary, rotate archives, patch CLAUDE.md, prompt user |
| `check` | **Mode 2** - show state of current summary and archives; no writes |
| `config <N>` | **Mode 3** - update `retentionDays` to N in config.json |
| `install-hooks` | **Mode 4** - patch CLAUDE.md + create config; remind user to run install.ps1 |

---

## Mode 1: Write session summary (default)

### Step 1 - Detect project root

Run:
```
git rev-parse --show-toplevel
```
If the command fails (not a git repo), use the current working directory as the project root.

### Step 2 - Ensure directories and config

Create these directories if they do not exist:
- `{root}/.claude/session-wrap/`
- `{root}/.claude/session-wrap/archive/`

Read `{root}/.claude/session-wrap/config.json`. If absent, create it:
```json
{ "retentionDays": 3 }
```

### Step 3 - Archive rotation

Check if `{root}/.claude/session-wrap/current.md` exists.

If it does:
1. Parse the `date:` field from its YAML front-matter (first `---` block).
2. Compute age in whole days: `today - frontmatter_date`.
3. If `age >= retentionDays`:
   - Determine archive filename from the frontmatter date: `YYYY-MM-DD.md`
   - If `archive/YYYY-MM-DD.md` already exists, try `YYYY-MM-DD-2.md`, `YYYY-MM-DD-3.md`, etc.
   - Move `current.md` to the chosen archive path.
4. If `age < retentionDays`: leave `current.md` in place; it will be overwritten in Step 4.

### Step 3.5 - Refresh codebase index

Check whether `docs/CODEBASE_INDEX.md` or `CODEBASE_INDEX.md` exists at the project root.

- If either exists: invoke `/index-codebase refresh` (Mode 2 of the index-codebase skill).
- If neither exists: invoke `/index-codebase` (Mode 1 - full generation).
- If there is no `src/` or recognisable source root at all, skip this step.

Report the result inline: `[index-codebase] <result summary from that skill>`.

### Step 3.6 - Update documentation

Check whether a `docs/` directory exists at the project root.

- If `docs/` exists: invoke `/update-docs` (Mode 1 - full audit + update).
- If `docs/` does not exist: skip this step silently.

Report the result inline: `[update-docs] <result summary from that skill>`.

### Step 4 - Generate and write the summary

Synthesise from conversation memory - do NOT re-read source files unless a section cannot be
filled from memory. Generate content for each section below, then write the full file.

File path: `{root}/.claude/session-wrap/current.md`

```markdown
---
date: <ISO 8601 timestamp, e.g. 2026-06-25T14:30:00Z>
project: <basename of project root directory>
---

## What was implemented

<2-4 sentences covering the main deliverable and its purpose>

## Key decisions

- <non-obvious choice and its rationale>
- <non-obvious choice and its rationale>
- <add more bullets as needed; aim for 3-5>

## Files changed

<list of key file paths modified or created; one per line>

## Next steps / open items

<known remaining work, follow-up tasks, or blockers; use bullet list or "None." if clean>
```

Rules:
- Keep each section tight. The goal is a summary a future Claude instance can read in under
  30 seconds to re-establish context.
- Never copy-paste code blocks from the conversation into the summary.
- If a section has nothing to report, write "None." rather than omitting the heading.

### Step 5 - Patch CLAUDE.md

Check the project root CLAUDE.md for the string `<!-- session-wrap:start -->`.

**If the marker is absent:**
- If `CLAUDE.md` exists: append the block below (preceded by a blank line).
- If `CLAUDE.md` does not exist: create it containing only the block below.

**If the marker is present:**
- Read the existing block (from `<!-- session-wrap:start -->` to `<!-- session-wrap:end -->`).
- If the block does NOT contain the line `## Auto-maintenance after implementation`, the block
  is outdated. Replace the entire old block (start marker to end marker inclusive) with the
  current block below.
- If the block already contains `## Auto-maintenance after implementation`: skip (up to date).

Block (copy verbatim, including HTML comment markers):
```
<!-- session-wrap:start - do not edit this section manually -->
## Session Context
If `.claude/session-wrap/current.md` exists, read it at the start of each conversation
before responding to the first user message. Use its content as background context.
Do not mention this file unless the user asks.

## Auto-maintenance after implementation
When all TodoWrite tasks are marked done in the current session (no pending tasks remain),
automatically run the following once per completion event, before asking what to do next:
1. /index-codebase refresh  (updates CODEBASE_INDEX.md for the changed files)
2. /update-docs              (audits and updates docs/ to match current source)
Do not run these if no TodoWrite tasks were used in the current session.
<!-- session-wrap:end -->
```

### Step 6 - Prompt the user

Output exactly (substituting the bracketed values with actual results from Steps 3.5 and 3.6):

```
Session wrapped.

  [index-codebase]  <result from Step 3.5, or "skipped - no source root detected">
  [update-docs]     <result from Step 3.6, or "skipped - no docs/ directory">

Summary saved: .claude/session-wrap/current.md
Next session will load this context automatically via CLAUDE.md.

Action required:
  1. Run /compact to compress this conversation.
  2. Switch to the new Claude window (auto-opened if install.ps1 was run),
     or start a new Claude session manually.
```

---

## Mode 2: Check

No writes. Read state and report. If `current.md` does not exist, report "No current summary found."

Otherwise report:

```
Current summary:  .claude/session-wrap/current.md
  date:    <frontmatter date>
  age:     <N> day(s)
  expires: <date when it will be archived>  (retentionDays = <N>)
              OR "Already expired - will archive on next /session-wrap"

Archives:  <count> file(s) in .claude/session-wrap/archive/
Config:    retentionDays = <N>  (from .claude/session-wrap/config.json)
CLAUDE.md: <patched | not patched>
Hook:      <installed | not installed>
           (installed = C:\Users\<user>\.claude\scripts\on-wrap-write.ps1 exists)
```

For "Hook installed", check whether `on-wrap-write.ps1` exists in `~/.claude/scripts/`.

---

## Mode 3: Config

Usage: `/session-wrap config <N>` where N is an integer >= 1.

1. Read `{root}/.claude/session-wrap/config.json` (or create with defaults if missing).
2. Set `retentionDays` to `N`.
3. Write the updated JSON back to the file.
4. Report: `retentionDays updated to N.`

If N is missing or not a positive integer: report "Usage: /session-wrap config <days> (integer >= 1)"
and stop.

---

## Mode 4: Install hooks

1. Patch CLAUDE.md as described in Mode 1 Step 5 (idempotent).
2. Create `{root}/.claude/session-wrap/` and default `config.json` if missing.
3. Report:

```
CLAUDE.md patched:
  - New sessions will auto-read the summary from .claude/session-wrap/current.md.
  - After each implementation (all todos done), Claude will automatically run
    /index-codebase refresh and /update-docs before asking what to do next.
Config: .claude/session-wrap/config.json (retentionDays: 3)

To enable auto-spawning of a new Claude session after /session-wrap runs, install the hook:

  Windows (PowerShell):
    cd c:\newgit\skills\session-wrap
    .\install.ps1

  Or from gherkin-sandbox:
    cd c:\newgit\gherkin-sandbox\skills\session-wrap
    .\install.ps1

Restart Claude Code after running install.ps1 for the hook to take effect.
```

---

## Summary file lifecycle

```
[/session-wrap runs]
        |
        v
current.md exists?
  No  --> write new current.md
  Yes --> check age vs retentionDays
            < retentionDays  --> overwrite current.md with new session content
            >= retentionDays --> move to archive/YYYY-MM-DD.md,
                                 then write new current.md

archive/ files are kept indefinitely (permanent record).
```

---

## Rules

- **No em-dash**: never use `-`; use a regular hyphen `-`.
- **Synthesise, do not copy**: summaries must be written fresh from memory, not copied from
  conversation turns.
- **Idempotent CLAUDE.md patch**: never add the session-wrap block more than once.
- **Terse output**: only the structured report lines; no narration.
- **Always write all four sections** of `current.md`, even if a section is "None."
