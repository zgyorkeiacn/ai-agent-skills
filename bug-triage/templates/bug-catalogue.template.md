# Coding Bug Log

This file records CODING classification results from error-log triage (see the `bug-triage` skill).
An entry is added when a failing test / error log is traced to a genuine defect in the
implementation (the code is missing or incorrect). TEST classification results are excluded, with
one exception: a genuinely instructive case may be kept as a "lessons learned" entry, marked as
such. Entries are append-only - add new ones at the end following the same format; never rewrite
existing entries.

Entry format:

- **Date:** absolute date (YYYY-MM-DD)
- **Test:** the failing test (name / short description)
- **Test file:** path to the test
- **Error:** error type + key message
- **Classification:** CODING (or `TEST (lessons learned)` for a kept test-side case)
- **Root cause:** what was missing/incorrect and why
- **Fix applied:** file + the change (use **Fix proposed:** when the fix was not applied)

---
