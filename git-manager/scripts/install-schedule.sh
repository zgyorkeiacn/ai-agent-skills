#!/usr/bin/env bash
#
# Register (or remove) the daily git-manager credential probe as a cron entry.
#
# The probe runs `node creds.mjs probe`, which checks every registered token and writes
# pat-status.json.
#
# Cron runs with a minimal environment: no login shell, a bare PATH, and none of the variables a
# terminal session sets. So node is resolved to an ABSOLUTE path at install time rather than
# trusting cron's PATH, which is the usual reason a working command fails only under cron.
#
# Usage:
#   bash install-schedule.sh --time 09:00
#   bash install-schedule.sh --uninstall

set -euo pipefail

TIME="09:00"
UNINSTALL=0
TAG="# git-manager-credential-probe"

while [ $# -gt 0 ]; do
  case "$1" in
    --time)      TIME="$2"; shift 2 ;;
    --uninstall) UNINSTALL=1; shift ;;
    -h|--help)   sed -n '2,20p' "$0"; exit 0 ;;
    *)           echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

# Read the current crontab; an empty one exits non-zero, which must not abort the script.
current="$(crontab -l 2>/dev/null || true)"
# Drop any previous entry so repeated installs replace rather than accumulate.
cleaned="$(printf '%s\n' "$current" | grep -vF "$TAG" || true)"

if [ "$UNINSTALL" -eq 1 ]; then
  if [ "$current" = "$cleaned" ]; then
    echo "no git-manager cron entry to remove"
  else
    printf '%s\n' "$cleaned" | crontab -
    echo "removed the git-manager cron entry"
  fi
  exit 0
fi

if ! printf '%s' "$TIME" | grep -Eq '^([01][0-9]|2[0-3]):[0-5][0-9]$'; then
  echo "--time must be HH:MM in 24-hour form, got '$TIME'" >&2
  exit 1
fi
HOUR="${TIME%%:*}"
MIN="${TIME##*:}"
# Strip a leading zero so cron does not read the value as octal.
HOUR="$((10#$HOUR))"
MIN="$((10#$MIN))"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROBE="$SCRIPT_DIR/creds.mjs"
[ -f "$PROBE" ] || { echo "creds.mjs not found in $SCRIPT_DIR" >&2; exit 1; }

NODE="$(command -v node || true)"
[ -n "$NODE" ] || { echo "node was not found on PATH. Install Node.js, then re-run." >&2; exit 1; }

LOG_DIR="${GIT_MANAGER_HOME:-$HOME/.claude/credentials}"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/probe.log"

# On macOS a cron job touching the keychain may prompt or be denied until Terminal/cron is
# granted Full Disk Access; the log is where that shows up.
# `|| true` is deliberate. `probe` exits non-zero when a credential is dead or expiring, which is
# what makes it usable as a CI gate - but cron treats a non-zero exit as job failure and mails
# the user about it on every run until the token is fixed. The real state is in pat-status.json
# and is surfaced by `status`; cron only needs to know the run happened.
ENTRY="$MIN $HOUR * * * { \"$NODE\" \"$PROBE\" probe || true; } >> \"$LOG\" 2>&1 $TAG"

printf '%s\n%s\n' "$cleaned" "$ENTRY" | grep -v '^$' | crontab -

echo "installed cron entry, runs daily at $TIME"
echo "  $ENTRY"
echo "verify with:  crontab -l | grep git-manager"
echo "log:          $LOG"
