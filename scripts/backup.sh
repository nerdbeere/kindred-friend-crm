#!/usr/bin/env bash
#
# backup.sh — Kindred encrypted backup to S3.
#
# Runs INSIDE the LXC container as the `kindred` user (via systemd).
# Reads /etc/kindred/backup.env (loaded by systemd EnvironmentFile=).
#
# Steps:
#   1. Consistent SQLite snapshot via `sqlite3 .backup` (WAL-safe)
#   2. restic backup (AES-256 client-side encryption)
#   3. restic forget --prune (retention)
#   4. (Sundays) restic check --read-data-subset=5% (integrity)
#   5. Emit JSON status line to journald
#
# Exit codes (see docs/BACKUPS.md §7):
#   0 success
#   2 missing config
#   3 sqlite3 binary missing
#   4 restic binary missing
#   5 snapshot creation failed
#   6 restic backup failed
#   7 restic forget/prune failed (non-fatal: logs only)
#   8 restic check failed (non-fatal: logs only)

set -euo pipefail

# --- Config (overridable via env for local dev) -----------------------------
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/kindred/backup.env}"
if [ -f "$BACKUP_ENV_FILE" ] && [ -z "${BACKUP_S3_ENDPOINT:-}" ]; then
  # shellcheck disable=SC1090
  set -a; . "$BACKUP_ENV_FILE"; set +a
fi

DATABASE_PATH="${DATABASE_PATH:-/opt/kindred/data/kindred.db}"
SNAPSHOT_DIR="${BACKUP_SNAPSHOT_DIR:-/var/lib/kindred-backup}"
SNAPSHOT_PATH="$SNAPSHOT_DIR/snapshot.db"

BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/etc/kindred/restic.pass}"

KEEP_DAILY="${BACKUP_KEEP_DAILY:-7}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-6}"
# Rolling window in which NO snapshot is pruned: all backups from the last
# N hours survive, so a manual backup never replaces another one from the
# current day. Daily/weekly/monthly thinning applies beyond the window.
# 0 disables the window (pure daily/weekly/monthly thinning).
KEEP_WITHIN_HOURS="${BACKUP_KEEP_WITHIN_HOURS:-24}"
CHECK_WEEKLY="${BACKUP_CHECK_WEEKLY:-1}"

# --- Helpers ----------------------------------------------------------------
# Colorize only on a real terminal — job logs + journald get plain text.
if [ -t 1 ]; then
  log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
  warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
  die()  { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit "${2:-1}"; }
else
  log()  { printf '==> %s\n' "$*"; }
  warn() { printf 'WARN: %s\n' "$*" >&2; }
  die()  { printf 'ERROR: %s\n' "$*" >&2; exit "${2:-1}"; }
fi

emit_status() {
  # Single JSON line to journald tagged kindred-backup.
  local status="$1" snapshot_id="${2:-}" duration_s="${3:-}" size_bytes="${4:-}" repo_size_bytes="${5:-}" error="${6:-}"
  printf '{"status":"%s","snapshot_id":"%s","duration_s":%s,"size_bytes":%s,"repo_size_bytes":%s,"error":"%s","ts":"%s"}\n' \
    "$status" "$snapshot_id" "${duration_s:-0}" "${size_bytes:-0}" "${repo_size_bytes:-0}" "$error" "$(date -u +%FT%TZ)" \
    | logger -t kindred-backup 2>/dev/null || true
}

# --- Preflight --------------------------------------------------------------
[ -n "$BACKUP_S3_ENDPOINT" ]   || { emit_status error "" 0 0 0 "BACKUP_S3_ENDPOINT unset"; die "BACKUP_S3_ENDPOINT unset (no $BACKUP_ENV_FILE?)" 2; }
[ -n "$BACKUP_S3_BUCKET" ]     || { emit_status error "" 0 0 0 "BACKUP_S3_BUCKET unset"; die "BACKUP_S3_BUCKET unset" 2; }
[ -n "$BACKUP_S3_PREFIX" ]     || { emit_status error "" 0 0 0 "BACKUP_S3_PREFIX unset"; die "BACKUP_S3_PREFIX unset" 2; }
[ -n "$AWS_ACCESS_KEY_ID" ]    || { emit_status error "" 0 0 0 "AWS_ACCESS_KEY_ID unset"; die "AWS_ACCESS_KEY_ID unset" 2; }
[ -n "$AWS_SECRET_ACCESS_KEY" ]|| { emit_status error "" 0 0 0 "AWS_SECRET_ACCESS_KEY unset"; die "AWS_SECRET_ACCESS_KEY unset" 2; }
[ -f "$RESTIC_PASSWORD_FILE" ] || { emit_status error "" 0 0 0 "RESTIC_PASSWORD_FILE missing"; die "RESTIC_PASSWORD_FILE missing: $RESTIC_PASSWORD_FILE" 2; }

case "$BACKUP_S3_ENDPOINT" in
  https://*) ;;
  http://localhost[:/]*|http://localhost|http://127.0.0.1[:/]*|http://127.0.0.1)
    # Loopback only — safe for local MinIO testing. Refused for any other host.
    ;;
  http://*)  emit_status error "" 0 0 0 "endpoint not HTTPS"; die "BACKUP_S3_ENDPOINT must be https:// — refusing cleartext: $BACKUP_S3_ENDPOINT" 2 ;;
  *)         emit_status error "" 0 0 0 "endpoint malformed"; die "BACKUP_S3_ENDPOINT must start with https:// — got: $BACKUP_S3_ENDPOINT" 2 ;;
esac

command -v sqlite3 >/dev/null || { emit_status error "" 0 0 0 "sqlite3 missing"; die "sqlite3 binary not found" 3; }
command -v restic  >/dev/null || { emit_status error "" 0 0 0 "restic missing";  die "restic binary not found"  4; }

# Derive restic repo URL from endpoint/bucket/prefix.
# Strip trailing slash from endpoint; strip leading slash from prefix.
ENDPOINT_NO_SLASH="${BACKUP_S3_ENDPOINT%/}"
PREFIX_NO_LEADING="${BACKUP_S3_PREFIX#/}"
PREFIX_NO_TRAILING="${PREFIX_NO_LEADING%/}"
export RESTIC_REPOSITORY="s3:${ENDPOINT_NO_SLASH}/${BACKUP_S3_BUCKET}/${PREFIX_NO_TRAILING}"
if [ -n "$BACKUP_S3_REGION" ]; then
  export RESTIC_S3_REGION="$BACKUP_S3_REGION"
fi
# MinIO and some others need this so restic uses path-style addressing.
export AWS_REGION="${BACKUP_S3_REGION:-us-east-1}"

# --- Prepare snapshot dir ---------------------------------------------------
mkdir -p "$SNAPSHOT_DIR"
rm -f "$SNAPSHOT_PATH" "$SNAPSHOT_PATH-wal" "$SNAPSHOT_PATH-shm"

# --- 1. Consistent SQLite snapshot -----------------------------------------
log "Creating consistent snapshot of $DATABASE_PATH -> $SNAPSHOT_PATH ..."
if ! sqlite3 "$DATABASE_PATH" ".backup '$SNAPSHOT_PATH'" 2>/dev/null; then
  emit_status error "" 0 0 0 "sqlite3 .backup failed"
  die "sqlite3 .backup failed (DB path: $DATABASE_PATH)" 5
fi
SNAPSHOT_SIZE="$(stat -c %s "$SNAPSHOT_PATH" 2>/dev/null || stat -f %z "$SNAPSHOT_PATH")"

# --- 2. restic backup -------------------------------------------------------
START_EPOCH="$(date +%s)"
log "Uploading to $RESTIC_REPOSITORY ..."
if ! SNAPSHOT_OUT="$(restic backup "$SNAPSHOT_DIR" --tag kindred --tag "$(hostname)" --json 2>&1)"; then
  emit_status error "" 0 "$SNAPSHOT_SIZE" 0 "restic backup failed"
  printf '%s\n' "$SNAPSHOT_OUT" >&2
  die "restic backup failed" 6
fi
END_EPOCH="$(date +%s)"
DURATION=$((END_EPOCH - START_EPOCH))

# restic backup --json emits a stream; the final object is the summary with
# "message_type":"summary" and "snapshot_id".
SNAPSHOT_ID="$(printf '%s\n' "$SNAPSHOT_OUT" | grep -E '"message_type":"summary"' | grep -oE '"snapshot_id":"[a-f0-9]+"' | head -n1 | cut -d'"' -f4)"
[ -n "$SNAPSHOT_ID" ] || SNAPSHOT_ID="unknown"

# --- 3. forget + prune (retention) -----------------------------------------
# restic keep-policies are a UNION: a snapshot survives if ANY policy keeps
# it. The keep-within window protects all recent snapshots (incl. same-day
# manual backups); daily/weekly/monthly thin out older history.
FORGET_ARGS=(
  --keep-daily   "$KEEP_DAILY"
  --keep-weekly  "$KEEP_WEEKLY"
  --keep-monthly "$KEEP_MONTHLY"
  --prune
)
if [ "$KEEP_WITHIN_HOURS" != "0" ]; then
  FORGET_ARGS=(--keep-within "${KEEP_WITHIN_HOURS}h" "${FORGET_ARGS[@]}")
fi
if [ "$KEEP_WITHIN_HOURS" != "0" ]; then
  log "Applying retention (within=${KEEP_WITHIN_HOURS}h daily=$KEEP_DAILY weekly=$KEEP_WEEKLY monthly=$KEEP_MONTHLY) ..."
else
  log "Applying retention (daily=$KEEP_DAILY weekly=$KEEP_WEEKLY monthly=$KEEP_MONTHLY) ..."
fi
if ! restic forget "${FORGET_ARGS[@]}" >/dev/null 2>&1; then
  warn "restic forget/prune failed — data is still safely backed up, but retention did not run"
  emit_status warn "$SNAPSHOT_ID" "$DURATION" "$SNAPSHOT_SIZE" 0 "forget-prune-failed"
  # Non-fatal: don't exit. Continue to optional check.
  FORGET_FAILED=1
else
  FORGET_FAILED=0
fi

# --- 4. Repo stats + optional weekly check ---------------------------------
REPO_SIZE_BYTES="$(restic stats --json 2>/dev/null | grep -oE '"total_size":[0-9]+' | head -n1 | cut -d: -f2 || echo 0)"
[ -n "$REPO_SIZE_BYTES" ] || REPO_SIZE_BYTES=0

CHECK_STATUS="skipped"
if [ "$CHECK_WEEKLY" = "1" ] && [ "$(date +%u)" = "7" ]; then
  log "Sunday — running restic check --read-data-subset=5% ..."
  if restic check --read-data-subset=5% >/dev/null 2>&1; then
    CHECK_STATUS="ok"
  else
    warn "restic check failed — integrity issue detected, investigate"
    CHECK_STATUS="failed"
    emit_status warn "$SNAPSHOT_ID" "$DURATION" "$SNAPSHOT_SIZE" "$REPO_SIZE_BYTES" "check-failed"
  fi
fi

# --- 5. Final status --------------------------------------------------------
if [ "$FORGET_FAILED" = "0" ] && [ "$CHECK_STATUS" != "failed" ]; then
  emit_status ok "$SNAPSHOT_ID" "$DURATION" "$SNAPSHOT_SIZE" "$REPO_SIZE_BYTES" ""
fi
log "Backup complete (snapshot $SNAPSHOT_ID, ${DURATION}s, $((SNAPSHOT_SIZE/1024)) KiB)"
exit 0