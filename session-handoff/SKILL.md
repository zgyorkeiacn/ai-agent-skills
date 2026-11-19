---
name: session-handoff
description: Refreshes AGENT_CONTEXT.md and implementation_plan.md at the end of a session or when a task/implementation phase completes. Auto-fires on ExitPlanMode and TodoWrite.
---

# Session Handoff Skill (`/session-handoff`)

Keeps two committed documents current so any agent can resume without re-reading the codebase:

| Document | Purpose |
|---|---|
| `AGENT_CONTEXT.md` | Static orientation. Update only when structure, commands, schemas, or guardrails change. |
| `implementation_plan.md` | Live task tracker. Update the Current State block every session. |

If a `CODEBASE_INDEX.md` or `docs/` directory exists in the working directory, link to it from
`AGENT_CONTEXT.md` rather than duplicating its content.

---

## Writing rule: short (MEFF.PLAN-TERSE)

Every write to either document, and every plan-mode plan, follows this. A plan is read on every resume, so each word costs again.

- Bullets, not prose. Per entry: key, decision, files, commits, what is still open. Cap about 15 lines or 1.5 KB per entry.
- Never copy an item's prompt, a report, per-step test counts or what `git log` already holds.
- Quote the user only where the words set a decision or a rule: once, in the shortest form that carries it.
- Change an entry in place, never append a log under it; a finished piece is one line (key, commit).
- No em or en dashes.

---

## When invoked via ExitPlanMode

Read the most recently written plan file at `~/.claude/plans/`. Analyse its phases and tasks:

1. **Estimate total scope.** Count distinct files touched. Estimate lines of code to write.
   Heuristic: 1 token = 4 chars; 1 avg file ~200 lines ~4,000 tokens.
2. **Split into increments.** Each increment: max 10 files, max ~400 new lines of code,
   single verifiable outcome. Follow natural dependency order (never split a schema change
   from the code that uses it). Label increments "1", "2", "3" or "1a", "1b" for sub-splits.

   | Complexity | Files | Code lines | Action |
   |---|---|---|---|
   | Low | <= 10 | <= 400 | single increment |
   | Medium | 10-20 | 400-1000 | 2-3 increments |
   | High | > 20 | > 1000 | sub-increments (1a, 1b, ...) |

3. **Annotate each increment** with:
   - File list (relative paths)
   - Estimated tokens (e.g., `~3,500 tok`)
   - Verification step (one concrete command or observable outcome)
4. **Write to `implementation_plan.md`** using the standard phase/task format, within the writing rule above.
   Add `| Est. tokens | ~N,000 |` as a metadata row under each increment heading.

---

## When invoked via TodoWrite (manual or at task completion)

Triggered after one or more tasks are marked done. Focus on keeping the tracker current so
the next agent picks up immediately at the right place.

### Secret-scan safety guard (runs after ticking the task and refreshing Current State)

A hard gate on every completed task. Once the tracker is updated, scan the files this task
created or modified for hardcoded credentials BEFORE starting the next task or committing.
On any non-exempt finding: STOP, report it, and ask the developer how to proceed. Never
auto-remove a secret and never auto-commit past a finding.

1. Collect the changed set: `git status --porcelain` (added / modified / untracked) plus
   `git diff` (staged + unstaged) content. Text and source files only.
2. Flag a finding when a VALUE (not just a key name) looks like a real secret:
   - Secret-named assignments - key matches
     `/(pass(word|wd)?|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|private[_-]?key|credential|connection[_-]?string)/i`
     with a non-empty, non-placeholder literal value.
   - High-signal value shapes: `AKIA[0-9A-Z]{16}` (AWS), `-----BEGIN * PRIVATE KEY-----`,
     `Bearer <token>`, JWTs (`eyJ...`), GitHub `gh[pousr]_...`, Slack `xox[baprs]-...`,
     `sk-` / `sk_live_...` style keys, Google `AIza...`, and connection strings with an
     inline password.
   - Ignore obvious placeholders: `<...>`, `xxxx`, `changeme`, `example` / `dummy`, env-var
     references (`process.env.X`, `${...}`, `os.getenv(...)`), and `.env.example` templates.
3. Test-user exemption: credentials belonging to a test / fixture user account are exempt
   (aligns with a test-user catalog rule such as the agent pipeline's Rule 9) - UNLESS the
   account is administrator-or-higher. Treat as privileged and NOT exempt when the user,
   role, group, or scope contains: admin, administrator, root, superuser, sysadmin,
   superadmin, owner, or privileged. Privileged test credentials are handled like real secrets.
4. Plaintext passwords are always a finding: a stored password must follow the project's
   credential-storage rule (e.g. AGENT_RULES.md Rule 13 - encrypted vault), never plaintext.
5. On any finding, STOP and report each hit as `file:line - <what matched>`, then ask the
   developer how to proceed (remove it, replace with an env-var / vault reference, or confirm
   it is safe). Do not continue to the next task until it is resolved.

---

## When `/session-handoff` is invoked

### 1. Read the current state
Read `AGENT_CONTEXT.md` and `implementation_plan.md` at the working directory root (if they exist).

### 2. Gather live session state
- Branch / short SHA: `git rev-parse --abbrev-ref HEAD`, `git rev-parse --short HEAD`.
- Working tree: `git status --porcelain` (summarise counts; list notable files inline).
- The active TODO list and what shipped this session.

### 3. Refresh `implementation_plan.md`
- Update the Current State block FIRST.
- Tick any completed tasks `[ ] -> [x] (timestamp)`.
- Add or update the "Shipped this session" list when a phase is complete: one line per piece, within the writing rule.
- Update the Outstanding / known limitations section.

### 4. Refresh `AGENT_CONTEXT.md` only when orientation changed
Touch it only when structure, commands, schemas, conventions, or guardrails changed this session.
Bump the footer: `*Last updated: <what changed>.*`

### 5. Confirm (one line)
Report new line counts of both files and the Current State timestamp.

---

## Rules

- **Never use em-dash (`-`)** - use a regular hyphen (`-`).
- **Short entries:** the writing rule at the top applies to every write.
- **Diffs over rewrites:** prefer targeted `Edit`s over a full `Write` when files already exist.
- **Never** include secrets, PATs, tokens, or `.env` contents - both files are committed.
- **Guardrails are append-only** in `AGENT_CONTEXT.md`.
