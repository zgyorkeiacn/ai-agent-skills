#!/bin/sh
# index-codebase post-merge hook
# Fires after: git pull, git merge
# Action: marks the codebase index stale so the next Claude session knows to refresh it.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
touch "$TOPLEVEL/.codebase-index-stale"
echo "[index-codebase] Codebase index marked stale. Run /index-codebase refresh in your next Claude session."
