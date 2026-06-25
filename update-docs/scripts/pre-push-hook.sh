#!/bin/sh
# update-docs pre-push hook
# Fires before: git push
# Action: warns (non-blocking) if the docs folder is stale.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ -f "$TOPLEVEL/.docs-stale" ]; then
  echo "[update-docs] WARNING: docs/ is stale. Consider running /update-docs before pushing."
fi
exit 0
