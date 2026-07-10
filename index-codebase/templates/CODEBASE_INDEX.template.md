---
type: Index
title: Codebase Index
description: File to role to key-exports map of {REPO_NAME} source, so an agent jumps to the right module instead of grepping the tree cold.
tags: [index, codebase, navigation]
timestamp: {ISO_TIMESTAMP}
---

# Codebase Index - {REPO_NAME}

> **Audience:** AI coding agents and developers. Read this before grepping the source tree.
> Maps every source file to its role + key exports so you can jump straight to the right module
> instead of scanning the entire codebase cold.

_Last verified against commit `{SHA}` - re-verify rows if source changed (see Maintenance)._

---

## Module map (by area)

High-level semantic map for progressive disclosure - one line per functional area, pointing at the
detailed per-directory tables below. (Recommended for repos with many modules; omit for small repos.)

| Area | Key modules | What |
|------|-------------|------|
| {area} | `{entryFile}` | {one-line purpose} |

---

## {dir-name}/

| File | Role | Key exports |
|------|------|-------------|
| [{file.ts}]({dir-name}/{file.ts}) | {role - one clause, <= 140 chars, WHAT not HOW} | `ExportA()`, `ExportB`, `TypeC` |

---

## Typical data flow

```
{entry-point} -> {next layer} -> {next layer}
  -> {branch A}
  -> {branch B}
```

---

## Maintenance

- Keep the YAML frontmatter block at the top; refresh edits target rows only, never the frontmatter.
- Update the `Last verified against commit` line whenever you re-sync rows.
- When you add or remove a source file, add/remove its row in the same change.
- Run `/index-codebase refresh` after any significant refactor, or after `git pull` if
  `.codebase-index-stale` is present at the repo root.
- Run `/index-codebase lint` (or `scripts/check-module-index.js`) to detect drift: source files
  with no row, rows pointing at deleted files, and over-long role cells.
