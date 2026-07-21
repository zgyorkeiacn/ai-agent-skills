<!--
Single catalogue entry skeleton. Copy the block below, replace the placeholders, bump N to the next
number after the last "## Entry" in the catalogue, and APPEND it (never rewrite existing entries).
Log CODING verdicts only; keep a TEST verdict only as a marked "lessons learned" case.
-->

## Entry N

**Date:** YYYY-MM-DD
**Test:** <failing test name or short description>
**Test file:** <path/to/test>
**Error:** <error type + key message, e.g. "TypeError: X is not a function">

**Classification:** CODING

**Root cause:** <what was missing/incorrect and why the code produced the failure>

**Fix applied:** `<path/to/source>` - <the exact change>
<!-- use "**Fix proposed:**" instead when the fix was analyzed but not applied -->

---

<!-- ------------------------------------------------------------------ -->
<!-- Filled example (delete when using) -->
<!--

## Entry 1

**Date:** 2026-07-14
**Test:** `checkAchievements > [301-ac-2] returns [] when user has zero achievements and no conditions met`
**Test file:** `test/engine/achievements.test.js`
**Error:** `expect(received).toHaveLength(0)` - Received `["all_complete"]`

**Classification:** CODING

**Root cause:** `allCategoriesComplete` used `getCategories().every(...)`, and `[].every(...)` returns
`true` (vacuous truth). `getCategories()` legitimately returns `[]` before init, so a zero-activity
user was wrongly awarded the "completed everything" badge - a wrong result on an in-contract input.

**Fix applied:** `src/engine/achievements.js` - `return cats.length > 0 && cats.every(c => categoryComplete(u, c.id))`

-->
