#!/usr/bin/env bash
#
# restore.sh — Restore Kindred's SQLite DB from an encrypted S3 snapshot.
#
# Runs INSIDE the LXC container as the `kindred` user (typically invoked
# via the admin UI, or by hand).
#
# Usage:
#   scripts/restore.sh latest                       # restore newest snapshot
#   scripts/restore.sh <snapshot-id>                # restore specific snapshot
#   scripts/restore.sh latest --dry-run             # preview, no service stop
#   scripts/restore.sh latest --dry-run --target /tmp/foo  # dry-run to path
#
# Safety features (see docs/BACKUPS.md §7):
#   * Always moves the current DB aside BEFORE swapping (keeps last 3)
#   * Atomic mv into place
#   * Health check after service restart; automatic rollback on failure
#   * --dry-run restores into a temp dir, does not stop the service
#
# Service control uses the sudoers whitelist (§6):
#   kindred ALL=(root) NOPASSWD: /bin/systemctl {restart,stop,start} kindred

set -euo pipefail

# --- Config -----------------------------------------------------------------
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/kindred/backup.env}"
if [ -f "$BACKUP_ENV_FILE" ] && [ -z "${BACKUP_S3_ENDPOINT:-}" ]; then
  # shellcheck disable=SC1090
  set -a; . "$BACKUP_ENV_FILE"; set +a
fi

DATABASE_PATH="${DATABASE_PATH:-/opt/kindred/data/kindred.db}"
DATABASE_DIR="$(dirname "$DATABASE_PATH")"

BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-}"
RESTIC_PASSWORD_FILE="${RESTIC_PASSWORD_FILE:-/etc/kindred/restic.pass}"

APP_PORT="${APP_PORT:-3000}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:${APP_PORT}/}"
SERVICE_NAME="${SERVICE_NAME:-kindred}"

# --- Args -------------------------------------------------------------------
SNAPSHOT_ID="${1:-latest}"
DRY_RUN=0
DRY_RUN_TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRY_RUN=1; shift ;;
    --target)  DRY_RUN_TARGET="$2"; shift 2 ;;
    --help|-h)
      sed -n '2,24p' "$0"; exit 0 ;;
    *) SNAPSHOT_ID="$1"; shift ;;
  esac
done

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
  local status="$1" snapshot_id="$2" error="${3:-}"
  printf '{"event":"restore","status":"%s","snapshot_id":"%s","error":"%s","ts":"%s"}\n' \
    "$status" "$snapshot_id" "$error" "$(date -u +%FT%TZ)" \
    | logger -t kindred-restore 2>/dev/null || true
}

# --- Job-file progress (UI-triggered restores) -------------------------------
# When the admin API spawns us, it sets KINDRED_JOB_FILE to the restore
# job's status file. We overwrite it at each phase so the UI can follow
# progress — crucially including "restarting", written JUST BEFORE the
# `systemctl restart` that kills this script (we're in the service's
# cgroup). The API treats a dead pid + state "restarting" as expected.
JOB_FILE="${KINDRED_JOB_FILE:-}"
write_job() {
  # write_job <state> <phase> [error]
  [ -n "$JOB_FILE" ] || return 0
  local state="$1" phase="$2" error="${3:-}"
  local tmp="$JOB_FILE.tmp.$$"
  {
    printf '{"state":"%s","phase":"%s","pid":%s,"started_at":"%s",' \
      "$state" "$phase" "$$" "${JOB_STARTED_AT:-$(date -u +%FT%TZ)}"
    case "$state" in
      ok|error) printf '"finished_at":"%s",' "$(date -u +%FT%TZ)" ;;
      *)        printf '"finished_at":null,' ;;
    esac
    if [ -n "$error" ]; then
      printf '"exit_code":1,"error":"%s"}\n' "$error"
    else
      printf '"exit_code":null,"error":null}\n'
    fi
  } > "$tmp" 2>/dev/null && mv -f "$tmp" "$JOB_FILE" 2>/dev/null || true
}
JOB_STARTED_AT="$(date -u +%FT%TZ)"

# --- Preflight --------------------------------------------------------------
[ -n "$BACKUP_S3_ENDPOINT" ]   || die "BACKUP_S3_ENDPOINT unset" 2
[ -n "$BACKUP_S3_BUCKET" ]     || die "BACKUP_S3_BUCKET unset" 2
[ -n "$BACKUP_S3_PREFIX" ]     || die "BACKUP_S3_PREFIX unset" 2
[ -f "$RESTIC_PASSWORD_FILE" ] || die "RESTIC_PASSWORD_FILE missing: $RESTIC_PASSWORD_FILE" 2
command -v restic  >/dev/null || die "restic binary not found" 4
command -v sqlite3 >/dev/null || die "sqlite3 binary not found" 3
[ -n "$SNAPSHOT_ID" ] || die "no snapshot id given (use 'latest' or a specific id)"

if [ "$(id -un)" != "$SERVICE_NAME" ] && [ "$DRY_RUN" = "0" ]; then
  die "must run as user '$SERVICE_NAME' (currently $(id -un)) — try: sudo -u $SERVICE_NAME $0 $*"
fi

# Derive restic repo URL same as backup.sh
case "$BACKUP_S3_ENDPOINT" in
  https://*) ;;
  http://localhost[:/]*|http://localhost|http://127.0.0.1[:/]*|http://127.0.0.1)
    # Loopback only — safe for local MinIO testing.
    ;;
  http://*) die "BACKUP_S3_ENDPOINT must be https:// — refusing cleartext: $BACKUP_S3_ENDPOINT" 2 ;;
esac
ENDPOINT_NO_SLASH="${BACKUP_S3_ENDPOINT%/}"
PREFIX_NO_LEADING="${BACKUP_S3_PREFIX#/}"
PREFIX_NO_TRAILING="${PREFIX_NO_LEADING%/}"
export RESTIC_REPOSITORY="s3:${ENDPOINT_NO_SLASH}/${BACKUP_S3_BUCKET}/${PREFIX_NO_TRAILING}"
[ -n "$BACKUP_S3_REGION" ] && export RESTIC_S3_REGION="$BACKUP_S3_REGION"
export AWS_REGION="${BACKUP_S3_REGION:-us-east-1}"

# Resolve "latest" to a concrete id so we can log it.
# `restic snapshots --latest 1` does the newest-pick server-side — parsing
# the full list by hand picked the OLDEST snapshot (restic sorts oldest
# first), which was a real bug.
if [ "$SNAPSHOT_ID" = "latest" ]; then
  log "Resolving 'latest' snapshot ..."
  RESOLVE_OUT="$(restic snapshots --json --latest 1 2>/dev/null || true)"
  if [ -z "$RESOLVE_OUT" ] || [ "$RESOLVE_OUT" = "null" ] || [ "$RESOLVE_OUT" = "[]" ]; then
    die "no snapshots in repository — nothing to restore" 6
  fi
  SNAPSHOT_ID="$(printf '%s\n' "$RESOLVE_OUT" \
    | grep -oE '"(short_id|id)":"[a-f0-9]+"' \
    | head -n1 | cut -d'"' -f4 || true)"
  [ -n "$SNAPSHOT_ID" ] || die "could not resolve 'latest' from restic snapshots output" 6
  log "Latest snapshot: $SNAPSHOT_ID"
fi

# --- Dry-run path: restore into a temp dir, do NOT touch the live DB ---------
if [ "$DRY_RUN" = "1" ]; then
  TMPDIR="${DRY_RUN_TARGET:-$(mktemp -d -t kindred-restore-dryrun.XXXXXX)}"
  write_job running dry-run
  log "DRY RUN: restoring snapshot $SNAPSHOT_ID into $TMPDIR"
  RESTORE_OWNED=0
  if [ -n "$DRY_RUN_TARGET" ]; then
    mkdir -p "$TMPDIR"
  fi
  if ! restic restore "$SNAPSHOT_ID" --target "$TMPDIR" >/dev/null 2>&1; then
    write_job error dry-run "dry-run restore failed"
    die "dry-run restore failed" 7
  fi
  RESTORED_DB="$(find "$TMPDIR" -name 'snapshot.db' -print -quit || true)"
  if [ -z "$RESTORED_DB" ]; then
    write_job error dry-run "snapshot has no snapshot.db"
    die "snapshot has no snapshot.db — restore target: $TMPDIR" 7
  fi
  if [ -f "$DATABASE_PATH" ]; then
    if cmp -s "$RESTORED_DB" "$DATABASE_PATH"; then
      log "DRY RUN: restored snapshot is IDENTICAL to live DB — no changes would be applied"
    else
      log "DRY RUN: restored snapshot DIFFERS from live DB — restore would change $(stat -c %s "$RESTORED_DB" 2>/dev/null || stat -f %z "$RESTORED_DB") bytes vs current $(stat -c %s "$DATABASE_PATH" 2>/dev/null || stat -f %z "$DATABASE_PATH") bytes"
    fi
  else
    log "DRY RUN: live DB not present at $DATABASE_PATH — restore would create it"
  fi
  log "DRY RUN: files restored under $TMPDIR (review and delete manually)"
  emit_status dry-run "$SNAPSHOT_ID" ""
  write_job ok dry-run
  exit 0
fi

# --- Real restore: prepare temp dir ----------------------------------------
write_job running downloading
RESTORE_DIR="$(mktemp -d -t kindred-restore.XXXXXX)"
trap 'rm -rf "$RESTORE_DIR"' EXIT
log "Restoring snapshot $SNAPSHOT_ID into $RESTORE_DIR ..."
if ! restic restore "$SNAPSHOT_ID" --target "$RESTORE_DIR" >/dev/null 2>&1; then
  emit_status error "$SNAPSHOT_ID" "restic restore failed"
  write_job error downloading "restic restore failed"
  die "restic restore failed for snapshot $SNAPSHOT_ID" 7
fi
RESTORED_DB="$(find "$RESTORE_DIR" -name 'snapshot.db' -print -quit || true)"
[ -n "$RESTORED_DB" ] || { emit_status error "$SNAPSHOT_ID" "snapshot has no snapshot.db"; write_job error downloading "snapshot has no snapshot.db"; die "snapshot has no snapshot.db (target: $RESTORE_DIR)" 7; }

# Quick sanity: is it a real SQLite file?
write_job running verifying
sqlite3 "$RESTORED_DB" "PRAGMA integrity_check;" >/tmp/.kindred-restore-integrity.$$ 2>&1 || {
  cat /tmp/.kindred-restore-integrity.$$ >&2
  rm -f /tmp/.kindred-restore-integrity.$$
  emit_status error "$SNAPSHOT_ID" "integrity_check failed"
  write_job error verifying "integrity_check failed"
  die "restored snapshot failed integrity_check — refusing to swap" 7
}
rm -f /tmp/.kindred-restore-integrity.$$

# --- If live DB exists, move it aside (keep last 3 pre-restore copies) ------
write_job running swapping
PRE_RESTORE_COPY=""
if [ -f "$DATABASE_PATH" ]; then
  TS="$(date +%s)"
  PRE_RESTORE_COPY="${DATABASE_PATH}.pre-restore.${TS}"
  log "Moving current DB aside -> $PRE_RESTORE_COPY"
  # Drop WAL/shm sidecars so the restored main DB stands on its own.
  rm -f "$DATABASE_PATH-wal" "$DATABASE_PATH-shm" 2>/dev/null || true
  mv "$DATABASE_PATH" "$PRE_RESTORE_COPY"
  # Prune to last 3 pre-restore copies.
  ( cd "$DATABASE_DIR" && ls -1t "$(basename "$DATABASE_PATH").pre-restore."* 2>/dev/null | tail -n +4 | xargs -r rm -- )
fi

# --- Atomic swap ------------------------------------------------------------
log "Placing restored DB at $DATABASE_PATH ..."
mv "$RESTORED_DB" "$DATABASE_PATH" || {
  emit_status error "$SNAPSHOT_ID" "atomic mv failed"
  write_job error swapping "atomic mv failed"
  if [ -n "$PRE_RESTORE_COPY" ]; then
    warn "mv failed — rolling back to $PRE_RESTORE_COPY ..."
    mv "$PRE_RESTORE_COPY" "$DATABASE_PATH" || true
  fi
  die "atomic mv into place failed" 8
}
# Set proper ownership (DB must be readable by the kindred service user).
if id "$SERVICE_NAME" >/dev/null 2>&1; then
  chown "$SERVICE_NAME:$SERVICE_NAME" "$DATABASE_PATH"
fi
chmod 0640 "$DATABASE_PATH"

# --- Restart service + health check ----------------------------------------
# IMPORTANT: when this script was spawned by the admin API, we run inside
# kindred.service's cgroup — the restart below SIGTERMs us. Write the
# "restarting" phase BEFORE issuing it so the UI knows the swap already
# happened and the downtime is expected. The health check + rollback below
# still run for CLI-triggered restores (root shell, own cgroup).
write_job restarting restarting
log "Restarting $SERVICE_NAME ..."
if command -v systemctl >/dev/null 2>&1; then
  # Use the sudoers-whitelisted command.
  sudo /bin/systemctl restart "$SERVICE_NAME" 2>/dev/null || systemctl restart "$SERVICE_NAME" 2>/dev/null || true
elif command -v npm >/dev/null 2>&1; then
  warn "systemctl not found — service not restarted automatically. Restart by hand."
else
  warn "systemctl not found — service not restarted automatically."
fi

log "Waiting for app to come up at $HEALTH_URL ..."
HEALTH_OK=0
for i in $(seq 1 30); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    HEALTH_OK=1
    break
  fi
  sleep 2
done

if [ "$HEALTH_OK" != "1" ]; then
  warn "App did not come up after restore — rolling back ..."
  write_job running rollback "health check failed, rolling back"
  if [ -n "$PRE_RESTORE_COPY" ] && [ -f "$PRE_RESTORE_COPY" ]; then
    rm -f "$DATABASE_PATH"
    mv "$PRE_RESTORE_COPY" "$DATABASE_PATH"
    chown "$SERVICE_NAME:$SERVICE_NAME" "$DATABASE_PATH" 2>/dev/null || true
    chmod 0640 "$DATABASE_PATH"
    if command -v systemctl >/dev/null 2>&1; then
      sudo /bin/systemctl restart "$SERVICE_NAME" 2>/dev/null || systemctl restart "$SERVICE_NAME" 2>/dev/null || true
    fi
    emit_status rollback "$SNAPSHOT_ID" "health check failed, rolled back"
    write_job error rollback "health check failed, rolled back"
    die "app did not come up — rolled back to pre-restore DB ($DATABASE_PATH)" 8
  else
    emit_status error "$SNAPSHOT_ID" "health check failed, no pre-restore copy"
    write_job error rollback "health check failed, no pre-restore copy"
    die "app did not come up and no pre-restore copy found — service may be down, investigate" 8
  fi
fi

# --- Re-print the feed URL (token lives in DB → unchanged) ------------------
log "Restore complete — snapshot $SNAPSHOT_ID"
if [ -f "/opt/kindred/scripts/print-feed-token.js" ]; then
  TOKEN="$(node /opt/kindred/scripts/print-feed-token.js 2>/dev/null | tr -d '[:space:]' || true)"
  if [ -n "$TOKEN" ]; then
    IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
    [ -n "$IP" ] || IP="<container-ip>"
    printf '\n   ICS feed: http://%s:%s/api/feed/%s.ics\n\n' "$IP" "$APP_PORT" "$TOKEN"
  fi
fi
emit_status ok "$SNAPSHOT_ID" ""
write_job ok done
exit 0