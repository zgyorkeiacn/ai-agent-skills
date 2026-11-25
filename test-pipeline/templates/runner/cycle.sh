#!/usr/bin/env bash
# Cycle rendezvous, POSIX twin of cycle.ps1. Source this; it defines functions only.
#
# Same contract as the PowerShell version: every environment drops a marker, one claims the
# reporting, and the claim is atomic so two environments finishing in the same second cannot both
# win. See cycle.ps1 for the full reasoning.

cycle_id() { date +%Y-%m-%dT%H; }

# Absolute on purpose - see the note in cycle.ps1. A relative path resolves against whatever
# directory cron happened to start in.
cycle_dir() {
  local runs_dir="$1"
  mkdir -p "$runs_dir/cycle"
  (cd "$runs_dir/cycle" && pwd)
}

# write_cycle_marker <runsDir> <slot> <status:ran|skipped> [runId]
write_cycle_marker() {
  local runs_dir="$1" slot="$2" status="$3" run_id="${4:-}"
  local dir; dir="$(cycle_dir "$runs_dir")"
  local path="$dir/$(cycle_id).$slot.json"
  # Write then move, so a poller never reads a half-written marker.
  printf '{"slot":"%s","status":"%s","runId":"%s","at":"%s"}' \
    "$slot" "$status" "$run_id" "$(date -Iseconds)" > "$path.tmp"
  mv -f "$path.tmp" "$path"
}

# have_slots <runsDir> -> prints the slot names that have reported in
have_slots() {
  local dir; dir="$(cycle_dir "$1")"
  local cid; cid="$(cycle_id)"
  for f in "$dir/$cid".*.json; do
    [ -e "$f" ] || continue
    basename "$f" | sed "s/^$cid\.//; s/\.json$//"
  done
}

# wait_for_cycle <runsDir> <timeoutMinutes> <slot...> -> 0 complete, 1 timed out
wait_for_cycle() {
  local runs_dir="$1" timeout_min="$2"; shift 2
  local deadline=$(( $(date +%s) + timeout_min * 60 ))
  local announced=0
  while :; do
    local present missing=""
    present="$(have_slots "$runs_dir")"
    for s in "$@"; do
      echo "$present" | grep -qx "$s" || missing="$missing $s"
    done
    [ -z "$missing" ] && return 0
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "[cycle] timed out after ${timeout_min}m waiting for:$missing"
      return 1
    fi
    if [ "$announced" -eq 0 ]; then echo "[cycle] waiting for:$missing"; announced=1; fi
    sleep 15
  done
}

# claim_cycle_report <runsDir> -> 0 for the single winner, 1 for everyone else
#
# `set -o noclobber` with `>` fails when the target exists, and the redirection is atomic. This is
# deliberately not "test -f then create": every environment can clear the wait in the same instant.
claim_cycle_report() {
  local f; f="$(cycle_dir "$1")/$(cycle_id).claimed"
  if (set -o noclobber; printf '%s %s' "$$" "$(date -Iseconds)" > "$f") 2>/dev/null; then
    return 0
  fi
  return 1
}

# cycle_run_ids <runsDir> <slot...> -> run ids in the order the slots were given
# Only 'ran' markers with a non-empty runId contribute; a skip completes the cycle but adds no run.
cycle_run_ids() {
  local runs_dir="$1"; shift
  local dir; dir="$(cycle_dir "$runs_dir")"
  local cid; cid="$(cycle_id)"
  for s in "$@"; do
    local f="$dir/$cid.$s.json"
    [ -e "$f" ] || continue
    grep -q '"status":"ran"' "$f" || continue
    local id; id="$(sed -n 's/.*"runId":"\([^"]*\)".*/\1/p' "$f")"
    [ -n "$id" ] && echo "$id"
  done
}

prune_cycle_markers() {
  local dir; dir="$(cycle_dir "$1")"
  local keep="${2:-200}"
  ls -1t "$dir" 2>/dev/null | tail -n "+$((keep + 1))" | while read -r f; do
    rm -f "$dir/$f"
  done
}

# A lock name unique to this checkout. A fixed global name would make two clones on one host
# serialise against each other for no reason, and the symptom is an unexplained stall.
report_lock_path() {
  local repo_root="$1"
  local hash
  hash="$(printf '%s' "$repo_root" | tr '[:upper:]' '[:lower:]' | cksum | cut -d' ' -f1)"
  echo "${TMPDIR:-/tmp}/test-pipeline-reports-$hash.lock"
}
