#!/usr/bin/env bash
#
# update.sh — Update Kindred to the latest commit of the deployed branch.
#
# Runs INSIDE the LXC container, as root:
#   bash /opt/kindred/scripts/update.sh
#
# Or from the Proxmox host:
#   pct exec <CT_ID> -- bash /opt/kindred/scripts/update.sh
#   (or use proxmox/update-lxc.sh)
#
# Steps: git pull -> npm ci -> npm run build -> repair system prerequisites
# -> restart service -> health check.
# The SQLite database (data/) is not tracked by git and survives updates.
# The ICS feed token is stored in the database, so the feed URL never changes.

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/kindred}"
APP_PORT="${APP_PORT:-3000}"
SERVICE_USER="${SERVICE_USER:-kindred}"
SERVICE_NAME="${SERVICE_NAME:-kindred}"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this script as root."
[ -d "$APP_DIR/.git" ] || die "$APP_DIR is not a git checkout."

as_app_user() {
  su -s /bin/bash "$SERVICE_USER" -c "cd '$APP_DIR' && $*"
}

log "Pulling latest code..."
as_app_user "git pull --ff-only"

log "Installing dependencies..."
as_app_user "npm ci --no-audit --no-fund"

log "Building..."
as_app_user "npm run build"

log "Repairing auth and backup prerequisites..."
# Idempotent repair for CTs provisioned by any older installer. In
# particular, this rewrites/verifies the sudoers rule that the admin backup
# UI requires and repairs auth.env's group-read mode for the lazy fallback.
bash "$APP_DIR/scripts/setup-auth.sh" >/dev/null
bash "$APP_DIR/scripts/install-backup-prereqs.sh"

log "Restarting $SERVICE_NAME service..."
systemctl restart "$SERVICE_NAME"

log "Waiting for the app to come up..."
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${APP_PORT}/" >/dev/null 2>&1; then
    break
  fi
  [ "$i" -lt 30 ] || die "App did not start in time — check: journalctl -u $SERVICE_NAME"
  sleep 2
done

TOKEN="$(as_app_user "node scripts/print-feed-token.js" | tr -d '[:space:]')"
IP="$(hostname -I | awk '{print $1}')"

cat <<SUMMARY

==============================================================
 Update complete.

   Web UI:     http://${IP}:${APP_PORT}
   ICS feed:   http://${IP}:${APP_PORT}/api/feed/${TOKEN}.ics
               (unchanged — the token lives in the database)
==============================================================
SUMMARY
