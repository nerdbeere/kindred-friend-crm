#!/usr/bin/env bash
#
# dev-restore-test.sh — disaster-recovery simulation against local MinIO.
#
# Seeds a DB, backs it up, then DELETES the local DB (simulating a
# container-destroyed scenario) and pulls a fresh copy back from the
# restic repo via `restic restore` (without using scripts/restore.sh,
# which needs systemd). Asserts the restored DB matches the source
# row-for-row. Tears MinIO down on exit.
#
# This proves the operator can recover the database on a fresh container
# with only: (1) the saved restic repo password, (2) the S3 endpoint /
# bucket / prefix, (3) IAM creds with GetObject/ListObjects on the
# prefix. See docs/BACKUPS.md §10.B.
#
# Usage:
#   scripts/dev-restore-test.sh
#   scripts/dev-restore-test.sh --keep

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEV_DIR="$REPO_ROOT/.dev-restore-test"

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

rm -rf "$DEV_DIR"
mkdir -p "$DEV_DIR/data" "$DEV_DIR/snapshot" "$DEV_DIR/restore"

# --- Bring up MinIO ---------------------------------------------------------
log "Starting MinIO via docker compose ..."
docker compose -f "$REPO_ROOT/docker/minio-compose.yml" up -d

log "Waiting for MinIO + bucket creation to finish ..."
for i in $(seq 1 30); do
  if docker inspect --format '{{.State.Health.Status}}' kindred-minio-test 2>/dev/null | grep -q healthy; then
    if docker inspect --format '{{.State.Status}}' docker-create-bucket-1 2>/dev/null | grep -q exited; then
      break
    fi
  fi
  [ "$i" -lt 30 ] || die "MinIO did not become healthy in 60s"
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

# --- Creds + repo password --------------------------------------------------
cat > "$DEV_DIR/restic.pass" <<'EOF'
dev-test-restic-password-do-not-use-in-production-M0xFreeBeer==
EOF

cat > "$DEV_DIR/backup.env" <<EOF
BACKUP_S3_ENDPOINT=http://localhost:${MINIO_PORT}
BACKUP_S3_BUCKET=kindred-test
BACKUP_S3_PREFIX=kindred/dev-restore
BACKUP_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
RESTIC_PASSWORD_FILE=$DEV_DIR/restic.pass
DATABASE_PATH=$DEV_DIR/data/kindred.db
BACKUP_SNAPSHOT_DIR=$DEV_DIR/snapshot
EOF
chmod 0600 "$DEV_DIR/backup.env" "$DEV_DIR/restic.pass"

# --- Seed DB ----------------------------------------------------------------
log "Seeding test DB ..."
sqlite3 "$DEV_DIR/data/kindred.db" <<'SQL'
CREATE TABLE contacts (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, birth_month INTEGER NOT NULL, birth_day INTEGER NOT NULL, birth_year INTEGER, notes TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO contacts (name, birth_month, birth_day, birth_year, notes) VALUES ('Ada Lovelace', 12, 10, 1815, 'mathematician'), ('Alan Turing', 6, 23, 1912, 'computer scientist'), ('Grace Hopper', 12, 9, 1906, 'compiler pioneer');
INSERT INTO settings (key, value) VALUES ('feed_token', 'dev-restore-test-token');
SQL
SRC_SHA="$(sha256sum "$DEV_DIR/data/kindred.db" | awk '{print $1}')"

# --- Backup -----------------------------------------------------------------
log "Initializing restic repo (idempotent) ..."
set -a; . "$DEV_DIR/backup.env"; set +a
ENDPOINT="${BACKUP_S3_ENDPOINT%/}"; PREFIX="${BACKUP_S3_PREFIX#/}"; PREFIX="${PREFIX%/}"
export RESTIC_REPOSITORY="s3:${ENDPOINT}/${BACKUP_S3_BUCKET}/${PREFIX}"
export RESTIC_PASSWORD_FILE AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION="${BACKUP_S3_REGION:-us-east-1}"
if ! restic snapshots >/dev/null 2>&1; then
  restic init || die "restic init failed"
fi
set +a

log "Backing up ..."
BACKUP_ENV_FILE="$DEV_DIR/backup.env" bash "$REPO_ROOT/scripts/backup.sh" || die "backup.sh failed"

# --- Simulate disaster: wipe the local DB + the snapshot dir ---------------
log "Disaster simulation: deleting local DB + snapshot dir ..."
rm -rf "$DEV_DIR/data" "$DEV_DIR/snapshot"
mkdir -p "$DEV_DIR/data"

# --- Manual restic restore (as if on a fresh CT) ---------------------------
log "Running restic restore directly (no systemd, no scripts/restore.sh) ..."
set -a; . "$DEV_DIR/backup.env"; set +a
ENDPOINT="${BACKUP_S3_ENDPOINT%/}"; PREFIX="${BACKUP_S3_PREFIX#/}"; PREFIX="${PREFIX%/}"
export RESTIC_REPOSITORY="s3:${ENDPOINT}/${BACKUP_S3_BUCKET}/${PREFIX}"
export RESTIC_PASSWORD_FILE
export AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_REGION="${BACKUP_S3_REGION:-us-east-1}"

mkdir -p "$DEV_DIR/restore"
restic restore latest --target "$DEV_DIR/restore" || die "restic restore failed"

RESTORED_DB="$(find "$DEV_DIR/restore" -name 'snapshot.db' -print -quit)"
[ -n "$RESTORED_DB" ] || die "no snapshot.db in restore output"

log "Placing restored DB at $DEV_DIR/data/kindred.db ..."
mkdir -p "$DEV_DIR/data"
cp "$RESTORED_DB" "$DEV_DIR/data/kindred.db"
DST_SHA="$(sha256sum "$DEV_DIR/data/kindred.db" | awk '{print $1}')"

# --- Verify -----------------------------------------------------------------
PASS=0
if [ "$SRC_SHA" = "$DST_SHA" ]; then
  log "Disaster-recovery OK — restored DB byte-identical to source."
  PASS=1
else
  warn "SHAs differ — verifying row-level equality ..."
  ROW_DIFF="$(sqlite3 "$DEV_DIR/data/kindred.db" "SELECT name FROM contacts ORDER BY id;" | diff - <(printf 'Ada Lovelace\nAlan Turing\nGrace Hopper\n') | wc -l | tr -d '[:space:]')"
  TOKEN="$(sqlite3 "$DEV_DIR/data/kindred.db" "SELECT value FROM settings WHERE key='feed_token';")"
  if [ "$ROW_DIFF" = "0" ] && [ "$TOKEN" = "dev-restore-test-token" ]; then
    log "Row-level + token verification passed."
    PASS=1
  else
    die "Row-level verification FAILED — content differs (ROW_DIFF=$ROW_DIFF, TOKEN=[$TOKEN])."
  fi
fi

cat <<SUMMARY

==============================================================
  dev-restore-test.sh — disaster recovery simulation finished
    Source DB sha256:   $SRC_SHA
    Restored DB sha256: $DST_SHA
    Pass criteria:      ${PASS:+row-level verification passed}
    MinIO console:      http://localhost:${MINIO_CONSOLE_PORT}  (minioadmin / minioadmin)
    Test artifacts:     $DEV_DIR
==============================================================
SUMMARY
exit 0