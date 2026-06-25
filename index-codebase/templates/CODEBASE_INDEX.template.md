# Codebase Index - {REPO_NAME}

> **Audience:** AI coding agents and developers. Read this before grepping the source tree.
> Maps every source file to its role + key exports so you can jump straight to the right module
> instead of scanning the entire codebase cold.

_Last verified against commit `{SHA}` - re-verify rows if source changed (see Maintenance)._

---

## {dir-name}/

| File | Role | Key exports |
|------|------|-------------|
| [{file.ts}]({dir-name}/{file.ts}) | {role description - max 80 chars} | `ExportA()`, `ExportB`, `TypeC` |

---

## Typical data flow

```
{entry-point} -> {next layer} -> {next layer}
  -> {branch A}
  -> {branch B}
```

---

## Maintenance

- Update the `Last verified against commit` line whenever you re-sync rows.
- When you add or remove a source file, add/remove its row in the same change.
- Run `/index-codebase refresh` after any significant refactor, or after `git pull` if
  `.codebase-index-stale` is present at the repo root.
