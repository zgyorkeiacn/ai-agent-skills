#!/bin/sh
# index-codebase pre-push hook
# Fires before: git push
# Action: warns (non-blocking) if the codebase index is stale.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ -f "$TOPLEVEL/.codebase-index-stale" ]; then
  echo "[index-codebase] WARNING: Codebase index is stale. Consider running /index-codebase refresh before pushing."
fi
exit 0
