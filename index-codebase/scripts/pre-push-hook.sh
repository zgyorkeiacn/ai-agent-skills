#!/bin/sh
# index-codebase pre-push hook
# Fires before: git push
# Action: warns (non-blocking) if the codebase index is stale or has drifted.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
if [ -f "$TOPLEVEL/.codebase-index-stale" ]; then
  echo "[index-codebase] WARNING: Codebase index is stale. Consider running /index-codebase refresh before pushing."
fi
# Deterministic drift check (missing/orphan rows). Non-blocking: report only.
CHECK="$TOPLEVEL/.git/hooks/check-module-index.js"
[ -f "$CHECK" ] || CHECK=""
if [ -n "$CHECK" ] && command -v node >/dev/null 2>&1; then
  ( cd "$TOPLEVEL" && node "$CHECK" ) || echo "[index-codebase] WARNING: codebase index drift detected (see above). Non-blocking."
fi
exit 0
