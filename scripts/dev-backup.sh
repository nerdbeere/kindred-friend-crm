#!/usr/bin/env bash
#
# dev-backup.sh — local smoke test of the Kindred backup flow against MinIO.
#
# Brings up MinIO via docker compose, seeds a test SQLite DB with a few
# contacts + a feed token, runs scripts/backup.sh against MinIO, then
# runs a dry-run restore (no service stop, no DB swap) to prove we can
# fetch the encrypted snapshot back and decrypt it. Compares the
# restored bytes against the source. Tears MinIO down on exit.
#
# Requirements: Docker (or OrbStack / colima). No other deps.
#
# Why not a *real* restore.sh here? scripts/restore.sh stops + restarts a
# systemd unit via the sudoers whitelist — only available inside the LXC.
# The disaster-recovery simulation is scripts/dev-restore-test.sh (pulls
# the snapshot back from restic without touching the live DB).
#
# Usage:
#   scripts/dev-backup.sh                    # round-trip
#   scripts/dev-backup.sh --keep             # don't tear down MinIO on exit
#
# Exit non-zero on any failure.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_DIR="$REPO_ROOT/.dev-backup"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33mWARN:\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

KEEP=0
[ "${1:-}" = "--keep" ] && KEEP=1

MINIO_PORT="${MINIO_PORT:-9000}"
MINIO_CONSOLE_PORT="${MINIO_CONSOLE_PORT:-9001}"

command -v docker >/dev/null || die "docker not found"
command -v sqlite3 >/dev/null || die "sqlite3 not found"
command -v restic >/dev/null || die "restic not found (brew install restic / apt install restic)"
[ -x "$REPO_ROOT/scripts/backup.sh" ] || die "scripts/backup.sh missing or not executable"
[ -x "$REPO_ROOT/scripts/restore.sh" ] || die "scripts/restore.sh missing or not executable"

# --- Reset dev dir ---------------------------------------------------------
rm -rf "$DEV_DIR"
mkdir -p "$DEV_DIR/data" "$DEV_DIR/snapshot" "$DEV_DIR/restore"

# --- Bring up MinIO ---------------------------------------------------------
log "Starting MinIO via docker compose ..."
docker compose -f "$REPO_ROOT/docker/minio-compose.yml" up -d

# Wait for MinIO to be healthy + bucket sidecar to finish.
log "Waiting for MinIO + bucket creation to finish ..."
for i in $(seq 1 30); do
  if docker inspect --format '{{.State.Health.Status}}' kindred-minio-test 2>/dev/null | grep -q healthy; then
    if docker inspect --format '{{.State.Status}}' docker-create-bucket-1 2>/dev/null | grep -q exited; then
      break
    fi
  fi
  [ "$i" -lt 30 ] || { docker logs kindred-minio-test 2>&1 | tail -10 >&2; die "MinIO did not become healthy / bucket not created in 60s"; }
  sleep 2
done

cleanup() {
  if [ "$KEEP" = "1" ]; then
    warn "MinIO kept up — tear down with: docker compose -f '$REPO_ROOT/docker/minio-compose.yml' down -v"
    return
  fi
  log "Tearing down MinIO ..."
  docker compose -f "$REPO_ROOT/docker/minio-compose.yml" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

# --- Write test credentials + restic password ------------------------------
cat > "$DEV_DIR/restic.pass" <<'EOF'
dev-test-restic-password-do-not-use-in-production-M0xFreeBeer==
EOF
RESTIC_PASSWORD_FILE="$DEV_DIR/restic.pass"

cat > "$DEV_DIR/backup.env" <<EOF
BACKUP_S3_ENDPOINT=http://localhost:${MINIO_PORT}
BACKUP_S3_BUCKET=kindred-test
BACKUP_S3_PREFIX=kindred/dev-test
BACKUP_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
RESTIC_PASSWORD_FILE=$RESTIC_PASSWORD_FILE
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
BACKUP_KEEP_MONTHLY=6
BACKUP_CHECK_WEEKLY=0
DATABASE_PATH=$DEV_DIR/data/kindred.db
BACKUP_SNAPSHOT_DIR=$DEV_DIR/snapshot
EOF
chmod 0600 "$DEV_DIR/backup.env" "$RESTIC_PASSWORD_FILE"

# --- Seed test DB with a few contacts + feed token -------------------------
log "Seeding test SQLite DB at $DEV_DIR/data/kindred.db ..."
sqlite3 "$DEV_DIR/data/kindred.db" <<'SQL'
CREATE TABLE contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL DEFAULT '',
  birth_month INTEGER NOT NULL,
  birth_day INTEGER NOT NULL,
  birth_year INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO contacts (first_name, last_name, birth_month, birth_day, birth_year, notes) VALUES
  ('Ada', 'Lovelace', 12, 10, 1815, 'mathematician'),
  ('Alan', 'Turing', 6, 23, 1912, 'computer scientist'),
  ('Grace', 'Hopper', 12, 9, 1906, 'compiler pioneer');
INSERT INTO settings (key, value) VALUES ('feed_token', 'dev-test-token-do-not-use');
SQL
sqlite3 "$DEV_DIR/data/kindred.db" "PRAGMA integrity_check;"
SRC_SHA="$(sha256sum "$DEV_DIR/data/kindred.db" | awk '{print $1}')"
log "Source DB sha256: $SRC_SHA"

# --- 1. Backup --------------------------------------------------------------
# Init the restic repo (first-run only). In a real CT this is done by
# scripts/configure-backup-privileged.js; for the local test we do it by hand.
log "Initializing restic repo (idempotent) ..."
set -a; . "$DEV_DIR/backup.env"; set +a
ENDPOINT="${BACKUP_S3_ENDPOINT%/}"; PREFIX="${BACKUP_S3_PREFIX#/}"; PREFIX="${PREFIX%/}"
export RESTIC_REPOSITORY="s3:${ENDPOINT}/${BACKUP_S3_BUCKET}/${PREFIX}"
export RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION="${BACKUP_S3_REGION:-us-east-1}"
if ! restic snapshots >/dev/null 2>&1; then
  restic init || die "restic init failed"
fi
set +a

log "Running scripts/backup.sh against MinIO ..."
if ! BACKUP_ENV_FILE="$DEV_DIR/backup.env" bash "$REPO_ROOT/scripts/backup.sh"; then
  die "backup.sh failed"
fi
log "Backup OK."

# --- 2. Dry-run restore to prove we can fetch + decrypt --------------------
log "Running scripts/restore.sh latest --dry-run --target $DEV_DIR/restore ..."
if ! DATABASE_PATH="$DEV_DIR/data/kindred.db" \
     BACKUP_ENV_FILE="$DEV_DIR/backup.env" \
     bash "$REPO_ROOT/scripts/restore.sh" latest --dry-run --target "$DEV_DIR/restore"; then
  die "dry-run restore failed"
fi

RESTORED_DB="$(find "$DEV_DIR/restore" -name 'snapshot.db' -print -quit)"
if [ -z "$RESTORED_DB" ]; then
  die "dry-run restore did not produce a snapshot.db under $DEV_DIR/restore"
fi
DST_SHA="$(sha256sum "$RESTORED_DB" | awk '{print $1}')"
log "Restored (dry-run) DB sha256: $DST_SHA"

PASS=0
if [ "$SRC_SHA" = "$DST_SHA" ]; then
  log "Round-trip OK — restored DB byte-identical to source."
  PASS=1
else
  warn "SHAs differ — verifying row-level equality (WAL checkpoint may reorder pages)..."
  ROW_DIFF="$(sqlite3 "$RESTORED_DB" "SELECT first_name || ' ' || last_name FROM contacts ORDER BY id;" | diff - <(sqlite3 "$DEV_DIR/data/kindred.db" "SELECT first_name || ' ' || last_name FROM contacts ORDER BY id;") | wc -l | tr -d '[:space:]')"
  TOKEN_DIFF="$(sqlite3 "$RESTORED_DB" "SELECT value FROM settings WHERE key='feed_token';" | diff - <(sqlite3 "$DEV_DIR/data/kindred.db" "SELECT value FROM settings WHERE key='feed_token';") | wc -l | tr -d '[:space:]')"
  if [ "$ROW_DIFF" = "0" ] && [ "$TOKEN_DIFF" = "0" ]; then
    log "Row-level + token verification passed."
    PASS=1
  else
    die "Row-level verification FAILED — content differs (ROW_DIFF=$ROW_DIFF TOKEN_DIFF=$TOKEN_DIFF)."
  fi
fi

# --- Summary ----------------------------------------------------------------
cat <<SUMMARY

==============================================================
  dev-backup.sh — round-trip test finished
    Source DB sha256:  $SRC_SHA
    Restored DB sha256: $DST_SHA
    Pass criteria:      ${PASS:+row-level verification passed}
    MinIO console:      http://localhost:${MINIO_CONSOLE_PORT}  (minioadmin / minioadmin)
    Test artifacts:     $DEV_DIR
==============================================================
SUMMARY
exit 0