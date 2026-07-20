#!/usr/bin/env bash
#
# enable-backup-lxc.sh — Install restic + configure encrypted S3 backups
# inside an existing Kindred LXC container.
#
# Run as root ON THE PROXMOX HOST:
#   ./proxmox/enable-backup-lxc.sh <CT_ID>                # interactive
#   ./proxmox/enable-backup-lxc.sh <CT_ID> <<EOF         # piped answers
#   https://s3.us-west-004.backblazeb2.com
#   kindred-backups
#   kindred/kindred-ct120
#   us-east-1
#   AKID...
#   SECRET...
#   y
#   EOF
#
# Or non-interactive via env:
#   BACKUP_S3_ENDPOINT=... BACKUP_S3_BUCKET=... BACKUP_S3_PREFIX=... \
#   AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... \
#   ./proxmox/enable-backup-lxc.sh <CT_ID>
#
# Idempotent: safe to re-run. Steps (see docs/BACKUPS.md §7):
#   1. Install sqlite3 + ca-certificates in the CT
#   2. Download restic (pinned version, SHA-256 verified) -> /usr/local/bin/restic
#   3. Generate /etc/kindred/restic.pass if missing (32 random bytes)
#   4. Collect (or accept from env) S3 endpoint/bucket/prefix/region/creds
#   5. Write /etc/kindred/backup.env (0600 root:kindred)
#   6. restic init (fails fast on bad creds / non-HTTPS / wrong bucket)
#   7. Probe bucket for Object Lock capability; warn if absent
#   8. Install systemd units + sudoers whitelist
#   9. Enable + start the timer; run an immediate first backup
#   10. Print next-run time + restore runbook

set -euo pipefail

# Pinned restic version. Update both RESTIC_VERSION and RESTIC_SHA256 together.
# The SHA256 below is for the linux_amd64 release archive at
#   https://github.com/restic/restic/releases/download/v<VERSION>/restic_<VERSION>_linux_amd64.bz2
# Verify it on first install (the installer runs `sha256sum -c` and fails
# loudly if it's wrong) — get the official SHA from the release page or
# `curl -fsSL <archive> | shasum -a 256` and paste it here.
RESTIC_VERSION="0.19.1"
RESTIC_SHA256_AMD64="REPLACE_ME_WITH_THE_OFFICIAL_LINUX_AMD64_SHA256_FOR_v0.19.1"

CT_ID="${1:-${CT_ID:-}}"
[ -n "$CT_ID" ] || { echo "Usage: $0 <CT_ID>" >&2; exit 1; }

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root on the Proxmox host."
command -v pct >/dev/null || die "pct not found — must run on a Proxmox host."
pct status "$CT_ID" >/dev/null 2>&1 || die "Container $CT_ID not found or stopped."

# --- Step 1: deps in CT -----------------------------------------------------
log "[$CT_ID] Installing sqlite3 + ca-certificates ..."
pct exec "$CT_ID" -- bash -c 'export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq sqlite3 ca-certificates sudo'

# --- Step 2: install restic binary into CT ----------------------------------
install_or_verify_restic() {
  pct exec "$CT_ID" -- bash -s <<EOF
set -euo pipefail
if command -v /usr/local/bin/restic >/dev/null 2>&1; then
  if /usr/local/bin/restic version | grep -q "restic ${RESTIC_VERSION}"; then
    echo "restic ${RESTIC_VERSION} already installed"; exit 0
  fi
fi
echo "Downloading restic ${RESTIC_VERSION} ..."
cd /tmp
curl -fsSL -o restic.bz2 "https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/restic_${RESTIC_VERSION}_linux_amd64.bz2"
echo "${RESTIC_SHA256_AMD64}  restic.bz2" | sha256sum -c -
bunzip2 -f restic.bz2
install -m 0755 -o root -g root restic /usr/local/bin/restic
rm -f restic
/usr/local/bin/restic version
EOF
}
log "[$CT_ID] Installing restic ${RESTIC_VERSION} ..."
install_or_verify_restic

# --- Step 3 + 4 + 5: collect config, write files ---------------------------
# Resolve config from env first; prompt for anything missing (from /dev/tty).
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-}"
AWS_ACCESS_KEY_ID="${AWS_ACCESS_KEY_ID:-}"
AWS_SECRET_ACCESS_KEY="${AWS_SECRET_ACCESS_KEY:-}"
GENERATE_PASSWORD="${GENERATE_PASSWORD:-y}"

read_if_tty() {
  local var="$1" prompt="$2" default="${3:-}"
  local val=""
  if [ -n "${!var:-}" ]; then return 0; fi
  if [ -t 0 ]; then
    if [ -n "$default" ]; then
      read -r -p "$prompt [$default]: " val
      val="${val:-$default}"
    else
      read -r -p "$prompt: " val
    fi
  else
    # Piped stdin
    read -r val
    val="${val:-$default}"
  fi
  printf -v "$var" '%s' "$val"
}

log "[$CT_ID] Collecting backup configuration ..."
[ -n "$BACKUP_S3_ENDPOINT" ] || read_if_tty BACKUP_S3_ENDPOINT "S3 endpoint (https://...)"
[ -n "$BACKUP_S3_BUCKET" ]   || read_if_tty BACKUP_S3_BUCKET   "S3 bucket name"
[ -n "$BACKUP_S3_PREFIX" ]   || read_if_tty BACKUP_S3_PREFIX   "S3 prefix (e.g. kindred/kindred-ct120)"
read_if_tty BACKUP_S3_REGION "S3 region (often blank for non-AWS)" ""
[ -n "$AWS_ACCESS_KEY_ID" ] || read_if_tty AWS_ACCESS_KEY_ID "AWS access key id"
[ -n "$AWS_SECRET_ACCESS_KEY" ] || {
  if [ -t 0 ]; then
    read -rs -p "AWS secret access key: " AWS_SECRET_ACCESS_KEY; echo
  else
    read -r AWS_SECRET_ACCESS_KEY
  fi
}

case "$BACKUP_S3_ENDPOINT" in
  https://*) ;;
  http://*)  die "BACKUP_S3_ENDPOINT must be https:// — refusing cleartext: $BACKUP_S3_ENDPOINT" ;;
  *)         die "BACKUP_S3_ENDPOINT must start with https:// — got: $BACKUP_S3_ENDPOINT" ;;
esac

# Push config into CT as /etc/kindred/backup.env (0600 root:kindred).
pct exec "$CT_ID" -- bash -s <<EOF
set -euo pipefail
install -d -m 0750 -o root -g kindred /etc/kindred

# Generate restic repo password if missing (32 bytes from /dev/urandom).
if [ ! -s /etc/kindred/restic.pass ]; then
  echo "Generating /etc/kindred/restic.pass ..."
  head -c 32 /dev/urandom | base64 > /etc/kindred/restic.pass.tmp
  mv /etc/kindred/restic.pass.tmp /etc/kindred/restic.pass
fi
chmod 0600 /etc/kindred/restic.pass
chown root:kindred /etc/kindred/restic.pass

# Write backup.env
cat > /etc/kindred/backup.env <<ENV
# Managed by proxmox/enable-backup-lxc.sh — do not edit by hand; re-run that script.
BACKUP_S3_ENDPOINT=${BACKUP_S3_ENDPOINT}
BACKUP_S3_BUCKET=${BACKUP_S3_BUCKET}
BACKUP_S3_PREFIX=${BACKUP_S3_PREFIX}
BACKUP_S3_REGION=${BACKUP_S3_REGION}
AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
RESTIC_PASSWORD_FILE=/etc/kindred/restic.pass
BACKUP_KEEP_DAILY=7
BACKUP_KEEP_WEEKLY=4
BACKUP_KEEP_MONTHLY=6
BACKUP_CHECK_WEEKLY=1
DATABASE_PATH=/opt/kindred/data/kindred.db
BACKUP_SNAPSHOT_DIR=/var/lib/kindred-backup
ENV
chmod 0600 /etc/kindred/backup.env
chown root:kindred /etc/kindred/backup.env

mkdir -p /var/lib/kindred-backup
chown kindred:kindred /var/lib/kindred-backup
chmod 0750 /var/lib/kindred-backup
EOF

# --- Step 6: restic init (test creds + create repo) ------------------------
log "[$CT_ID] Initializing restic repository ..."
pct exec "$CT_ID" -- bash -c '
  set -a; . /etc/kindred/backup.env; set +a
  ENDPOINT="${BACKUP_S3_ENDPOINT%/}"
  PREFIX="${BACKUP_S3_PREFIX#/}"; PREFIX="${PREFIX%/}"
  export RESTIC_REPOSITORY="s3:${ENDPOINT}/${BACKUP_S3_BUCKET}/${PREFIX}"
  [ -n "$BACKUP_S3_REGION" ] && export RESTIC_S3_REGION="$BACKUP_S3_REGION"
  export AWS_REGION="${BACKUP_S3_REGION:-us-east-1}"
  # idempotent init
  if /usr/local/bin/restic snapshots >/dev/null 2>&1; then
    echo "Repo already initialized."
  else
    /usr/local/bin/restic init
  fi
' || die "restic init failed — check endpoint/bucket/creds (and HTTPS)"

# --- Step 7: probe Object Lock (non-fatal) ----------------------------------
log "[$CT_ID] Probing bucket for Object Lock support ..."
OBJECT_LOCK_NOTE=""
if pct exec "$CT_ID" -- bash -c '
  set -a; . /etc/kindred/backup.env; set +a
  ENDPOINT="${BACKUP_S3_ENDPOINT%/}"; PREFIX="${BACKUP_S3_PREFIX#/}"; PREFIX="${PREFIX%/}"
  export RESTIC_REPOSITORY="s3:${ENDPOINT}/${BACKUP_S3_BUCKET}/${PREFIX}"
  /usr/local/bin/restic self-test >/dev/null 2>&1
' 2>/dev/null; then
  OBJECT_LOCK_NOTE="Maybe (could not confirm via restic)"
else
  OBJECT_LOCK_NOTE="Unknown — see docs/BACKUPS.md §13 (Phase 3 follow-up)"
fi
warn "Object Lock status: $OBJECT_LOCK_NOTE"

# --- Step 8: install systemd units + sudoers whitelist ----------------------
log "[$CT_ID] Installing systemd units + sudoers whitelist ..."

# Resolve the repo root from this script's location (so it works regardless
# of where it's invoked from).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVICE_UNIT_SRC="$REPO_ROOT/systemd/kindred-backup.service"

if [ -f "$SERVICE_UNIT_SRC" ]; then
  pct push "$CT_ID" "$SERVICE_UNIT_SRC" /etc/systemd/system/kindred-backup.service
else
  # Fallback: inline the unit (kept in sync with systemd/kindred-backup.service).
  pct exec "$CT_ID" -- bash -c "cat > /etc/systemd/system/kindred-backup.service <<'UNIT'
[Unit]
Description=Kindred encrypted backup to S3
Documentation=file:///opt/kindred/docs/BACKUPS.md
After=network-online.target kindred.service
Wants=network-online.target
ConditionPathExists=/etc/kindred/backup.env

[Service]
Type=oneshot
User=kindred
Group=kindred
EnvironmentFile=/etc/kindred/backup.env
WorkingDirectory=/opt/kindred
ExecStart=/usr/bin/env bash /opt/kindred/scripts/backup.sh
Nice=10
IOSchedulingClass=best-effort
IOSchedulingPriority=7
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
ReadWritePaths=/var/lib/kindred-backup /opt/kindred/data
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
RestrictRealtime=yes
MemoryDenyWriteExecute=yes
LockPersonality=yes
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources

[Install]
WantedBy=multi-user.target
UNIT"
fi

pct exec "$CT_ID" -- bash -c "cat > /etc/systemd/system/kindred-backup.timer <<'UNIT'
[Unit]
Description=Run Kindred backup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=10m
Unit=kindred-backup.service

[Install]
WantedBy=timers.target
UNIT"

# Sudoers whitelist — §6 of docs/BACKUPS.md.
pct exec "$CT_ID" -- bash -c "install -d -m 0750 -o root -g root /etc/sudoers.d
cat > /etc/sudoers.d/kindred-backup <<'SUDOERS'
# Managed by proxmox/enable-backup-lxc.sh
# Allows the kindred backup job to stop/start/restart its own service for restores.
kindred ALL=(root) NOPASSWD: /bin/systemctl restart kindred, /bin/systemctl stop kindred, /bin/systemctl start kindred
SUDOERS
chmod 0440 /etc/sudoers.d/kindred-backup
chown root:root /etc/sudoers.d/kindred-backup
visudo -cf /etc/sudoers.d/kindred-backup >/dev/null"

# --- Step 9: enable timer + immediate first backup -------------------------
log "[$CT_ID] Enabling timer + running immediate first backup ..."
pct exec "$CT_ID" -- systemctl daemon-reload
pct exec "$CT_ID" -- systemctl enable --now kindred-backup.timer
pct exec "$CT_ID" -- bash -c 'su -s /bin/bash kindred -c "cd /opt/kindred && bash /opt/kindred/scripts/backup.sh"' || warn "First backup failed — check: pct exec $CT_ID -- journalctl -u kindred-backup.service -n 50"

# --- Step 10: summary -------------------------------------------------------
NEXT_RUN="$(pct exec "$CT_ID" -- systemctl list-timers kindred-backup.timer 2>/dev/null | awk 'NR==2 {print $1, $2, $3, $4, $5}' || echo unknown)"

cat <<SUMMARY

==============================================================
  Encrypted backups enabled for CT $CT_ID

    Repository:   s3://${BACKUP_S3_ENDPOINT%/}/${BACKUP_S3_BUCKET}/${BACKUP_S3_PREFIX#/}
    Next run:     ${NEXT_RUN}
    Config:       /etc/kindred/backup.env (0600 root:kindred)
    Repo passwd:  /etc/kindred/restic.pass (0600 root:kindred)
                  ^^^ back this up off-box (e.g. password manager).
                      Without it, your encrypted backups are unrecoverable.

    Sudoers:      /etc/sudoers.d/kindred-backup (0440)

  Run a manual backup:
    pct exec $CT_ID -- su -s /bin/bash kindred -c 'bash /opt/kindred/scripts/backup.sh'

  Restore (latest):
    pct exec $CT_ID -- su -s /bin/bash kindred -c 'bash /opt/kindred/scripts/restore.sh latest'

  Or via the web UI: http://<container-ip>:${APP_PORT:-3000}/admin/backups
==============================================================
SUMMARY