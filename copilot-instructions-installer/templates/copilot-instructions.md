# Project Instructions - GitHub Copilot

## 1. Stop Wasting Tokens (Zero Fluff)
You operate under strict token-efficiency rules. Drop all conversational filler, pleasantries, and transitions (e.g., "Sure, I can help," "Important to note," "In conclusion"). Your only goal is to provide maximum information in the shortest possible output.

- Start your response directly with the answer or the code block.
- Never repeat or summarize my prompt back to me.
- If data can fit in a table, use a Markdown table instead of paragraphs.
- Keep the vocabulary precise but the layout dead simple.
- Use a regular hyphen (`-`) for prose and code; never use the em-dash (`—`).

## 2. Surgical Code Diffs Only
To stop background scratchpad execution and ghost token burning, format all code edits strictly as unified diffs.

- **Forbidden:** Do not rewrite unchanged boilerplate, entire functions, or full files.
- **Required:** Output only the modified lines using clear git-style diff blocks.
- **Comments:** No inline documentation, lengthy JSDoc blocks, or conversational comments inside code outputs.

#### Allowed Code Output Example:
```diff
--- path/to/file.ts
+++ path/to/file.ts
@@ -12,3 +12,3 @@
-const oldLine = 'example';
+const newLine = 'example';
```

## 3. Session Resume & Codebase Orientation
Session Resume: Before your first response, read AGENT_CONTEXT.md and the Current State block in implementation_plan.md at the repo root. This makes work resumable without re-reading the whole codebase.

Code Orientation: When modifying repo source files, read docs/AGENT_MODULE_INDEX.md first to map file-to-module exports instead of grepping blindly.

## 4. Context & Scope Restraints
Strict Scoping: Only look at explicitly referenced file paths or active editor tabs. Do not scan adjacent directories unless explicitly commanded.

Ignore Unrelated Tabs: Ignore open tabs that don't share a direct dependency chain with the current task.

Omit Heavy Files: Treat lockfiles (package-lock.json, pnpm-lock.yaml), auto-generated API clients, database migrations, and massive mock JSON files as totally empty.

## 5. Strict Autonomous Agent Restrictions
Hard Iteration Cap: If running in a multi-step workflow mode, never exceed 3 execution loops. If a solution fails a syntax check after the second attempt, halt and ask for direction.

No Automated Debugging Loops: Do not attempt to fix test failures or build errors in a continuous cycle. Show the initial failure stack trace and stop.

No Blanket Refactoring: Reject broad prompts like "improve performance." Require a specific service or class target.

Disable Autonomous Web Retrieval: Do not scrape external docs or search the web for minor syntax questions. Use local internal project context only.

## 6. Architectural Preferences
Lean Code First: Write highly atomic, modular code. Avoid large monolithic blocks.

Keep it Simple: Separate concerns cleanly and make data flow obvious. Avoid generic abstractions that make the code hard to follow.

## 7. Verification & Syntax
Internal Check: Do a mental syntax check before outputting any code. Do not rely on me to report errors to fix cascading syntax issues.

Verification Command: Following any code generation, output the exact terminal command needed to validate the changes (e.g., npm run typecheck or tsc --noEmit) as the very last line of your response.
