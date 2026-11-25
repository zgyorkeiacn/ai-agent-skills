# [Project Name] - Implementation Plan

> [!IMPORTANT]
> **AGENT HANDOFF DOCUMENT** - Read the "Current State" block before doing anything else. Update it when you start and finish tasks.

**Companion file:** [`AGENT_CONTEXT.md`](file:///[absolute/path/to/AGENT_CONTEXT.md]) - stack, conventions, schemas, guardrails.

---

## Current State

```
OVERALL STATUS : NOT STARTED
ACTIVE PHASE   : -
ACTIVE TASK    : -
LAST UPDATED   : -
LAST AGENT     : -
NOTES          : Awaiting Phase 1 start.
```

**Phase status at a glance:**

| Phase | Name | Status |
|---|---|---|
| 1 | [Phase Name] | `[ ] NOT STARTED` |
| 2 | [Phase Name] | `[ ] NOT STARTED` |
| 3 | [Phase Name] | `[ ] NOT STARTED` |

---

## How Any Agent Should Pick Up This Work

1. Read this file top-to-bottom.
2. Read `AGENT_CONTEXT.md` for conventions, env, schemas.
3. Find the first phase/task that is NOT marked `[x]` - that is your entry point.
4. Update the "Current State" block: set `ACTIVE PHASE`, `ACTIVE TASK`, `LAST AGENT`, `LAST UPDATED`.
5. On task completion, tick its checkbox `[x]`.
6. On phase completion, update `CODEBASE_INDEX.md` before moving to the next phase.
7. Do NOT refactor or modify completed phases without explicit user instruction.

---

## Stack & Decisions (Quick Reference)

| Layer | Choice | Reason |
|---|---|---|
| [layer] | [choice] | [reason] |

---

## Phase 1 - [Name]

**Entry check:** [What must be true before starting - e.g., "Node >= 18 installed".]
**Exit criteria:** [What must be verifiably true when done - e.g., "`npm run dev` starts without errors".]

### 1.1 - [Sub-task Group]
- [ ] [Atomic task] (file: `path/to/file`)
- [ ] [Atomic task] (file: `path/to/file`)

### 1.2 - [Sub-task Group]
- [ ] [Atomic task] (file: `path/to/file`)

---

## Phase 2 - [Name]

**Entry check:** Phase 1 `[x]` complete. [Any other pre-condition.]
**Exit criteria:** [Verifiable check.]

### 2.1 - [Sub-task Group]
- [ ] [Atomic task] (file: `path/to/file`)

---

## Phase N - [Name]

**Entry check:** Phase N-1 `[x]` complete.
**Exit criteria:** [Verifiable check.]

### N.1 - [Sub-task Group]
- [ ] [Atomic task] (file: `path/to/file`)

---

## Agent Update Protocol

Write short: bullets, about 15 lines or 1.5 KB per entry (key, decision, files, commits, what is open); no copied prompts, reports or git history; edit in place, no appended logs.

When you complete a task:
```
1. Tick the checkbox: [ ] -> [x]
2. Update the "Current State" block at the top of this file.
3. If completing a full phase, update CODEBASE_INDEX.md immediately.
```

When you start a session mid-phase:
```
1. Read Current State block.
2. Read AGENT_CONTEXT.md.
3. Read CODEBASE_INDEX.md (if it exists).
4. Find first unchecked task in the active phase.
5. Do NOT re-read entire source files unless the task directly requires editing them.
```
