#!/usr/bin/env bash
# Thin wrapper. All report-selection logic lives in build-all.mjs so the Windows and POSIX paths
# cannot drift into building different sets.
set -euo pipefail
CONFIG="pipeline.config.json"; ENVIRONMENT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --config) CONFIG="$2"; shift 2 ;;
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PIPELINE_DIR="$(node -e "process.stdout.write(require('./$CONFIG').pipelineDir)")"
if [ -n "$ENVIRONMENT" ]; then
  exec node "$PIPELINE_DIR/reports/build-all.mjs" --config "$CONFIG" --env "$ENVIRONMENT"
fi
exec node "$PIPELINE_DIR/reports/build-all.mjs" --config "$CONFIG"
