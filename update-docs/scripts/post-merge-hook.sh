#!/bin/sh
# update-docs post-merge hook
# Fires after: git pull, git merge
# Action: marks the docs folder stale so the next Claude session knows to refresh them.
TOPLEVEL=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
touch "$TOPLEVEL/.docs-stale"
echo "[update-docs] docs/ marked stale. Run /update-docs in your next Claude session."
