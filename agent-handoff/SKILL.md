---
name: agent-handoff
description: Establishes a two-document handoff system (AGENT_CONTEXT.md + implementation_plan.md) that makes any project fully resumable by any agent at any point, without needing to read the codebase. Automatically triggered on plan mode entry/exit and on todo completion via hooks. Apply manually at project start or when onboarding a new agent to an existing project.
---

# Agent Handoff Skill

## Automation (hooks)

This skill is wired into three Claude Code `PostToolUse` hooks in `~/.claude/settings.json`. No manual invocation is needed for the triggers below.

| Trigger | Hook fires on | What happens |
|---|---|---|
| Plan mode opens | `EnterPlanMode` | Background sub-agent generates/refreshes `AGENT_CONTEXT.md` and a skeleton `implementation_plan.md` |
| Plan mode exits | `ExitPlanMode` | Background sub-agent reads the latest plan file and incorporates its phases/tasks into `implementation_plan.md` |
| Todo item completed | `TodoWrite` | PowerShell script diffs the todo list, fuzzy-matches completed items to `- [ ]` lines in `implementation_plan.md`, stamps them `[x] (timestamp)`, and updates the `Last Updated` field |

Hook scripts live in `~/.claude/scripts/`:
- `on-enter-plan-mode.ps1`
- `on-exit-plan-mode.ps1`
- `on-todo-write.ps1`

The Enter/Exit hooks fire a hidden `pwsh` process and return immediately — plan mode is not delayed. Sub-agent logs land in `%TEMP%\claude-handoff-enter.log` / `claude-handoff-exit.log`.

**Note:** `ExitPlanMode` fires when the plan is *presented*, not when the user clicks Approve. If the plan is rejected and revised, the next `ExitPlanMode` call overwrites with the updated content.

---

## When to Apply Manually

- At the start of any multi-phase project before writing code.
- When an existing project lacks agent-resumable documentation.
- When handing off work to a sub-agent or a future session.
- When a project has grown complex enough that orientation takes more than 2 minutes.

## What This Skill Produces

Two documents, always kept in sync:

| Document | Location | Purpose |
|---|---|---|
| `AGENT_CONTEXT.md` | Project root (committed to repo) | Static orientation - structure, schemas, conventions, guardrails |
| `implementation_plan.md` | Conversation artifact dir | Live task tracker - phase status, checkboxes, agent protocol |

---

## Step 1 - Create AGENT_CONTEXT.md

Place in the project root. Any agent with repo access will find it immediately.

### Required Sections (in order)

#### 1. What This Project Is
One paragraph. What it does, what it produces, who uses it.

#### 2. Running the Project
Table of commands: dev server, build, test, deploy. Include prerequisites (Node version, etc.).

#### 3. Ports & External Services
All ports, proxy config, external API base URLs.

#### 4. Project Structure
Annotated directory tree. Every file or folder an agent might touch gets a one-line purpose comment. Mark read-only dirs explicitly.

#### 5. Data Schemas
JSON or TypeScript-style schema for every persistent data structure. Include field constraints (e.g., "never plaintext", "uuid-v4", allowed enum values).

#### 6. Auth / Session Model
Exact flow: how tokens are issued, where they are stored (client + server), what headers to use, how to invalidate.

#### 7. Component / Module Map
For each major section or domain: which file owns it, what it exports, what API it calls.

#### 8. Design Tokens (if frontend)
Table of all CSS custom properties: token name, value, usage context. State the rule: "never hardcode values, always use tokens."

#### 9. Available Assets (if applicable)
Table of static assets: filename, intended usage. Mark which are read-only.

#### 10. Coding Conventions
Bullet list of project-specific rules: naming, patterns, what to avoid. Keep it under 15 bullets.

#### 11. Guardrails
Explicit list of things agents must NOT do. Numbered. Non-negotiable.

#### 12. Footer
`*Last updated: Phase N (description). Update this file at the end of each completed phase.*`

---

## Step 2 - Create implementation_plan.md (Artifact)

This is the live task tracker. It lives in the conversation artifact directory.

### Required Sections (in order)

#### 1. Agent Handoff Header (top of file)
```markdown
> [!IMPORTANT]
> AGENT HANDOFF DOCUMENT - Read the "Current State" block before doing anything else.
```
Include a link to `AGENT_CONTEXT.md`.

#### 2. Current State Block
```
OVERALL STATUS : NOT STARTED | IN PROGRESS | COMPLETE
ACTIVE PHASE   : <phase name or ->
ACTIVE TASK    : <exact task description or ->
LAST UPDATED   : <ISO date>
LAST AGENT     : <agent name or conversation ID>
NOTES          : <any blocking info or handoff notes>
```

#### 3. Phase Status Table
One row per phase. Status column uses: `[ ] NOT STARTED`, `[/] IN PROGRESS`, `[x] COMPLETE`.

#### 4. How Any Agent Should Pick Up This Work
Six numbered steps:
1. Read the plan top-to-bottom.
2. Read `AGENT_CONTEXT.md`.
3. Find first unchecked task - that is the entry point.
4. Update the Current State block.
5. Tick checkboxes as tasks complete.
6. Update `CODEBASE_INDEX.md` (if it exists) on phase completion.

#### 5. Stack & Decisions (Quick Reference)
Table: Layer | Choice | Reason. One row per major technology decision.

#### 6. Phases (one section per phase)

Each phase section must contain:

```markdown
## Phase N - Name

**Entry check:** <what must be true before starting this phase>
**Exit criteria:** <what must be true to consider this phase done>

### N.x - Sub-task group name
- [ ] Atomic task description (file: `path/to/file.js`)
- [ ] Atomic task description
```

Rules for tasks:
- Each task must be completable in a single agent action (one file write, one command, one edit).
- File targets must be included inline: `(file: path/to/file)`.
- Tasks that depend on each other within a phase must be ordered correctly.
- Never list a task that spans multiple files as a single item - split it.

#### 7. Agent Update Protocol
```
When you complete a task:
1. Tick the checkbox [ ] -> [x]
2. Update the Current State block.
3. If completing a full phase, update CODEBASE_INDEX.md immediately.

When you start a session mid-phase:
1. Read Current State block.
2. Read AGENT_CONTEXT.md.
3. Read CODEBASE_INDEX.md (if it exists).
4. Find first unchecked task in the active phase.
5. Do NOT re-read entire source files unless the task directly requires editing them.
```

---

## Step 3 - Token Budget & Phase Sizing

Before writing the plan, estimate token load per phase and enforce these limits:

| Phase complexity | Max files | Max lines | Recommended action |
|---|---|---|---|
| Low | <= 10 | <= 800 | Single phase, single session |
| Medium | 10-20 | 800-2000 | Single phase, may need 2 sessions |
| High | > 20 | > 2000 | **Split into sub-phases (5a, 5b, 5c)** |

High-complexity phases MUST be split before work begins. A phase that cannot be completed in one session without context degradation is a planning failure, not an execution problem.

---

## Step 4 - CODEBASE_INDEX.md

Create this file in the project root. Update it at the end of every completed phase.

### Format per file entry:

```markdown
### path/to/file.js
- **Purpose:** One sentence.
- **Exports:** `functionName`, `ClassName`, default export name.
- **Key deps:** `other/file.js`, `npm-package`
- **Routes (server files):** `GET /api/path`, `POST /api/path`
- **Notes:** Any non-obvious implementation detail.
```

Group entries by directory. Add a table of contents at the top listing all directories covered.

---

## Step 5 - Maintenance Rules

These rules apply for the lifetime of the project:

1. **Any new file** added to the project gets an entry in `CODEBASE_INDEX.md` before the PR/phase is marked complete.
2. **Any schema change** is reflected in `AGENT_CONTEXT.md` data schemas section within the same phase.
3. **Any new convention** established during development is added to the Coding Conventions section of `AGENT_CONTEXT.md`.
4. **The Current State block** is the first thing updated when starting work and the last thing updated when stopping.
5. **Guardrails are never removed** from `AGENT_CONTEXT.md` - only added to.
6. **Phase exit criteria** must be verified (command run, curl checked, etc.) before marking a phase `[x]`.

---

## Anti-Patterns to Avoid

| Anti-pattern | Problem | Fix |
|---|---|---|
| "See the codebase" in place of schema docs | Forces full file read to orient | Write explicit schema in AGENT_CONTEXT.md |
| Tasks described as "implement X feature" | Not atomic - agent has to plan inside the task | Break into one-file-per-task items |
| No entry/exit criteria | Agent cannot self-verify phase completion | Add explicit, runnable checks |
| Current State block not updated | Next agent reads stale status, duplicates work | Update it first, every session |
| Phases sized by feature, not by token budget | Context overflow mid-phase | Size by line count, split if > 2000 lines |

---

## Template Files

See `templates/` subdirectory for copy-paste starting templates:
- `templates/AGENT_CONTEXT.template.md` - blank AGENT_CONTEXT.md with all section headers
- `templates/implementation_plan.template.md` - blank plan with Current State block and phase skeleton
