#!/usr/bin/env bash
#
# run-job.sh — run a command as a named background job, tracking state in
# files the Next.js admin API can poll.
#
# Usage:
#   run-job.sh <name> -- <cmd> [args...]
#
# Layout (JOB_DIR defaults to /tmp/kindred-jobs; the main kindred.service
# has no PrivateTmp, so these files survive an app restart):
#   $JOB_DIR/<name>.json   — status: {"state":"running|ok|error", "pid":N,
#                            "started_at":ISO, "finished_at":ISO|null,
#                            "exit_code":N|null, "error":string|null}
#   $JOB_DIR/<name>.log    — stdout+stderr of the command
#   $JOB_DIR/<name>.lock/  — mkdir lock preventing double-runs
#
# State is written atomically (tmp + mv). Exit code of this wrapper is the
# command's exit code.

set -uo pipefail

NAME="${1:-}"
case "$NAME" in
  ''|*[!a-z0-9-]*)
    echo "run-job.sh: invalid job name '$NAME' (want ^[a-z0-9-]+$)" >&2
    exit 2
    ;;
esac
[ "${2:-}" = "--" ] || { echo "run-job.sh: usage: run-job.sh <name> -- <cmd> [args...]" >&2; exit 2; }
shift 2
[ $# -gt 0 ] || { echo "run-job.sh: no command given" >&2; exit 2; }

JOB_DIR="${KINDRED_JOB_DIR:-/tmp/kindred-jobs}"
mkdir -p "$JOB_DIR"
chmod 0700 "$JOB_DIR" 2>/dev/null || true

STATUS_FILE="$JOB_DIR/$NAME.json"
LOG_FILE="$JOB_DIR/$NAME.log"
LOCK_DIR="$JOB_DIR/$NAME.lock"

write_status() {
  # write_status <state> <exit_code|- > <error|->
  local state="$1" exit_code="${2:--}" error="${3:--}"
  local tmp="$STATUS_FILE.tmp.$$"
  {
    printf '{"state":"%s","pid":%s,"started_at":"%s",' "$state" "$$" "$STARTED_AT"
    if [ "$state" = "running" ]; then
      printf '"finished_at":null,'
    else
      printf '"finished_at":"%s",' "$(date -u +%FT%TZ)"
    fi
    if [ "$exit_code" = "-" ]; then printf '"exit_code":null,'; else printf '"exit_code":%s,' "$exit_code"; fi
    if [ "$error" = "-" ]; then printf '"error":null}\n'; else printf '"error":"%s"}\n' "$error"; fi
  } > "$tmp"
  mv -f "$tmp" "$STATUS_FILE"
}

# --- Lock -------------------------------------------------------------------
# Two modes:
#   * KINDRED_JOB_LOCK_PREHELD=1 (set by the admin API): the API already
#     holds this lock as its atomic double-start gate — we just adopt it
#     and release on exit.
#   * otherwise (CLI use): acquire it ourselves, refuse double-runs.
if [ "${KINDRED_JOB_LOCK_PREHELD:-0}" = "1" ]; then
  mkdir "$LOCK_DIR" 2>/dev/null || true
else
  if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "run-job.sh: job '$NAME' already running (lock exists: $LOCK_DIR)" >&2
    exit 75  # EX_TEMPFAIL
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

STARTED_AT="$(date -u +%FT%TZ)"
: > "$LOG_FILE"
write_status "running"

echo "==> job '$NAME' started $(date -u +%FT%TZ): $*" >> "$LOG_FILE"
"$@" >> "$LOG_FILE" 2>&1
RC=$?
echo "==> job '$NAME' finished $(date -u +%FT%TZ) (exit $RC)" >> "$LOG_FILE"

if [ "$RC" -eq 0 ]; then
  write_status "ok" "$RC"
else
  write_status "error" "$RC" "command exited $RC — see log"
fi
exit "$RC"