#!/usr/bin/env bash
# One scheduled run against ONE environment, then the reports if this run wins the claim.
# POSIX twin of run-cycle.ps1; same gates, same invariants.
#
#   ./run-cycle.sh --environment qc2 [--config pipeline.config.json] [--no-reports]
set -uo pipefail

ENVIRONMENT=""
CONFIG="pipeline.config.json"
NO_REPORTS=0

while [ $# -gt 0 ]; do
  case "$1" in
    --environment) ENVIRONMENT="$2"; shift 2 ;;
    --config)      CONFIG="$2"; shift 2 ;;
    --no-reports)  NO_REPORTS=1; shift ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$ENVIRONMENT" ] || { echo "--environment is required" >&2; exit 2; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$REPO_ROOT"
# shellcheck source=cycle.sh
. "$SCRIPT_DIR/cycle.sh"

[ -f "$CONFIG" ] || { echo "[run] no config at $CONFIG" >&2; exit 1; }
q() { node -e "const c=require('./$CONFIG');process.stdout.write(String($1))"; }

PIPELINE_DIR="$(q 'c.pipelineDir')"
RUNS_DIR="$(q 'c.runsDir')"
SLOTS="$(q 'c.environments.filter(e=>e.enabled!==false).map(e=>e.name).join(" ")')"
WAIT_MIN="$(q 'c.schedule.cycleWaitMinutes||20')"
KEEP_LOGS="$(q 'c.retention.runLogs||200')"

EXISTS="$(q "c.environments.some(e=>e.name==='$ENVIRONMENT')")"
[ "$EXISTS" = "true" ] || { echo "[run] '$ENVIRONMENT' is not in the config. Known: $SLOTS" >&2; exit 1; }

BASE_URL_CFG="$(q "(c.environments.find(e=>e.name==='$ENVIRONMENT').baseUrl)||''")"
PROBE_KIND="$(q "(c.environments.find(e=>e.name==='$ENVIRONMENT').probe||{}).kind||'none'")"
PROBE_PATH="$(q "(c.environments.find(e=>e.name==='$ENVIRONMENT').probe||{}).path||'/'")"
PROBE_STATUS="$(q "(c.environments.find(e=>e.name==='$ENVIRONMENT').probe||{}).expectStatus||200")"
PROBE_TIMEOUT="$(q "(c.environments.find(e=>e.name==='$ENVIRONMENT').probe||{}).timeoutSeconds||20")"

mkdir -p "$RUNS_DIR/logs"
RUN_ID="$(date +%Y-%m-%dT%H-%M-%S)"
LOCK="$RUNS_DIR/.running-$ENVIRONMENT"
SKIP_LOG="$RUNS_DIR/skipped.log"

# A skipped slot is recorded here and NOWHERE else. It must never reach history.jsonl: a non-run and
# a failed run mean opposite things, and every report is only readable while the two stay apart.
write_skip() {
  echo "$(date '+%Y-%m-%d %H:%M:%S')  $RUN_ID  $ENVIRONMENT  SKIPPED - $1" >> "$SKIP_LOG"
  echo "[run] skipped - $1"
  # Mark the cycle too, or every other environment waits the full timeout for a run that is never
  # coming.
  write_cycle_marker "$RUNS_DIR" "$ENVIRONMENT" skipped || true
}

# cron has no jitter of its own; see install-schedule.sh.
if [ "${JITTER_MINUTES:-0}" -gt 0 ] 2>/dev/null; then
  sleep $(( RANDOM % (JITTER_MINUTES * 60) ))
fi

# ---- Gate A: hold ----------------------------------------------------------
HOLD="$RUNS_DIR/hold-until.txt"
if [ -f "$HOLD" ]; then
  UNTIL="$(head -n1 "$HOLD" | tr -d '[:space:]')"
  if UNTIL_TS="$(date -d "$UNTIL" +%s 2>/dev/null)"; then
    if [ "$(date +%s)" -lt "$UNTIL_TS" ]; then
      write_skip "held until $UNTIL"; exit 0
    fi
    rm -f "$HOLD"
  else
    echo "[run] unparseable hold-until.txt ('$UNTIL') - ignoring"
  fi
fi

# ---- Gate B: is the environment up? ----------------------------------------
# An HTTP probe rather than a TCP connect where possible: a dead environment often still accepts
# connections and answers 503 to everything, which a TCP probe reads as healthy and which then
# produces an entire red run that means nothing.
# Retried, not single-shot. First contact can fail while a VPN or zero-trust tunnel establishes its
# route, and a second attempt moments later succeeds. Single-shot turns that into a skipped run
# every time the machine wakes, which is indistinguishable from a real outage in the skip log.
PROBE_ATTEMPTS="$(q "(c.environments.find(e=>e.name==='$ENVIRONMENT').probe||{}).attempts||3")"
PROBE_GAP="$(q "(c.environments.find(e=>e.name==='$ENVIRONMENT').probe||{}).retryGapSeconds||3")"

probe_once() {
  case "$PROBE_KIND" in
    none) return 0 ;;
    tcp)
      host="$(printf '%s' "$BASE_URL_CFG" | sed -E 's#^[a-z]+://([^/:]+).*#\1#')"
      port="$(printf '%s' "$BASE_URL_CFG" | sed -nE 's#^https://.*#443#p;s#^http://.*#80#p')"
      (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null && return 0 || return 1 ;;
    http)
      code="$(curl -sS -o /dev/null -w '%{http_code}' -m "$PROBE_TIMEOUT" -k \
              "${BASE_URL_CFG%/}$PROBE_PATH" 2>/dev/null || echo 000)"
      if [ "$code" = "$PROBE_STATUS" ]; then return 0; fi
      # 000 means the transport never completed - worth retrying. Any real status code is the
      # environment answering and declining; retrying will not change its mind.
      if [ "$code" != "000" ]; then
        echo "[run] probe returned $code, expected $PROBE_STATUS"
        return 2
      fi
      return 1 ;;
    *) return 0 ;;
  esac
}

probe_ok() {
  i=1
  while [ "$i" -le "$PROBE_ATTEMPTS" ]; do
    probe_once
    rc=$?
    [ "$rc" -eq 0 ] && { [ "$i" -gt 1 ] && echo "[run] probe succeeded on attempt $i"; return 0; }
    [ "$rc" -eq 2 ] && return 1
    [ "$i" -lt "$PROBE_ATTEMPTS" ] && sleep "$PROBE_GAP"
    i=$(( i + 1 ))
  done
  echo "[run] probe failed after $PROBE_ATTEMPTS attempt(s)"
  return 1
}
# CI intake: an environment with source=ci reads finished pipeline runs instead of running the suite;
# there is no environment of ours to probe.
IS_CI="$(q "(c.environments.find(e=>e.name==='$ENVIRONMENT').source)==='ci'")"
if [ "$IS_CI" != "true" ] && ! probe_ok; then write_skip "$ENVIRONMENT is not answering its health probe"; exit 0; fi

# ---- Gate C: is a previous run of THIS environment still going? ------------
# Per environment, not global: one shared lock would silently turn "run both" into "run one".
if [ -f "$LOCK" ]; then
  OWNER="$(awk '{print $2}' "$LOCK" 2>/dev/null || echo '')"
  if [ -n "$OWNER" ] && kill -0 "$OWNER" 2>/dev/null; then
    write_skip "previous run still going (pid $OWNER)"; exit 0
  fi
  echo "[run] clearing stale lock from pid ${OWNER:-unknown}"
  rm -f "$LOCK"
fi
echo "$RUN_ID $$" > "$LOCK"

LOG="$RUNS_DIR/logs/run-$RUN_ID-$ENVIRONMENT.log"
STARTED="$(date -Iseconds)"

cleanup() {
  rm -f "$LOCK"
  # Retention. history.jsonl is never touched: one line per run, the input to every report, and not
  # regenerable. Logs are bulky and reproducible.
  ls -1t "$RUNS_DIR/logs"/run-*.log 2>/dev/null | tail -n "+$((KEEP_LOGS + 1))" | xargs -r rm -f
}
trap cleanup EXIT

if [ "$IS_CI" = "true" ]; then
  # Poll the provider and record any new completed run. Exit 0 ingested, 10 nothing new, 3 could not
  # poll; the latter two are skips, never history records. The token comes from an environment
  # variable named in the config, never a command line.
  node "$PIPELINE_DIR/ingest/ci-intake.mjs" --config "$CONFIG" --environment "$ENVIRONMENT"
  CI_RC=$?
  if [ "$CI_RC" -eq 10 ]; then write_skip "no new completed CI run"; exit 0; fi
  if [ "$CI_RC" -ne 0 ]; then write_skip "CI poll failed (exit $CI_RC)"; exit 0; fi
else
# ---- Run -------------------------------------------------------------------
[ -n "$BASE_URL_CFG" ] && export BASE_URL="$BASE_URL_CFG"
export TEST_ENV="$ENVIRONMENT"
CMD="$(q 'c.runner.command')"
CMD="${CMD//\{env\}/$ENVIRONMENT}"
CMD="${CMD//\{baseUrl\}/$BASE_URL_CFG}"

echo "[run] $ENVIRONMENT : $CMD"
# Exit code deliberately ignored: a suite with failing tests exits non-zero and that is a good run.
# Pass/fail comes from the results file, the only source that can tell "3 tests failed" apart from
# "the runner could not start".
sh -c "$CMD" > "$LOG" 2>&1 || true
FINISHED="$(date -Iseconds)"

# ---- Record ----------------------------------------------------------------
COLLECT_ARGS=(--config "$CONFIG" --run-id "$RUN_ID" --env "$ENVIRONMENT" --started "$STARTED" --finished "$FINISHED")
[ -n "$BASE_URL_CFG" ] && COLLECT_ARGS+=(--base-url "$BASE_URL_CFG")
if ! node "$PIPELINE_DIR/ingest/collect-run.mjs" "${COLLECT_ARGS[@]}"; then
  # No readable results means we do not know what happened. A fabricated zero-row record would enter
  # the history as a real datapoint and quietly drag every average down.
  write_skip "results could not be read"; exit 0
fi

fi

# ---- Rendezvous ------------------------------------------------------------
write_cycle_marker "$RUNS_DIR" "$ENVIRONMENT" ran "$RUN_ID"
[ "$NO_REPORTS" -eq 1 ] && { echo "[run] --no-reports, done"; exit 0; }

# shellcheck disable=SC2086
wait_for_cycle "$RUNS_DIR" "$WAIT_MIN" $SLOTS || echo "[cycle] proceeding with an incomplete cycle"

if ! claim_cycle_report "$RUNS_DIR"; then
  echo "[cycle] $(cycle_id) already claimed by another environment - not reporting here"
  exit 0
fi
# shellcheck disable=SC2086
echo "[cycle] $(cycle_id) claimed - reporting for: $(cycle_run_ids "$RUNS_DIR" $SLOTS | tr '\n' ' ')"

# A second, coarser guard, named per checkout so unrelated clones do not block each other.
LOCKFILE="$(report_lock_path "$REPO_ROOT")"
exec 9>"$LOCKFILE"
if command -v flock >/dev/null 2>&1; then
  flock -w 600 9 || echo "[reports] waited 10 min for another writer - generating anyway"
fi
"$SCRIPT_DIR/build-reports.sh" --config "$CONFIG"

prune_cycle_markers "$RUNS_DIR"
