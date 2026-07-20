#!/usr/bin/env bash
#
# install-backup-prereqs.sh — Install the system-level prerequisites the
# Kindred backup subsystem needs inside the LXC container:
#   * sudo (package)              — needed for the privileged helper rule
#   * sqlite3 (package)           — needed for `sqlite3 .backup` snapshots
#   * /etc/sudoers.d/             — created if missing
#   * /etc/sudoers.d/kindred-configure-backup  — NOPASSWD rule for the helper
#
# This script is IDEMPOTENT and safe to re-run. It's called by
# proxmox/setup-lxc.sh during initial provisioning, and can also be run
# by hand on an existing CT to repair a partial install (e.g. a CT that
# was provisioned before the sudoers.d fix):
#
#   pct exec <CT_ID> -- bash /opt/kindred/scripts/install-backup-prereqs.sh
#
# Must run as root inside the CT.

set -euo pipefail

KINDRED_USER="${KINDRED_USER:-kindred}"
SUDOERS_FILE="/etc/sudoers.d/kindred-configure-backup"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run as root inside the container."
id "$KINDRED_USER" >/dev/null 2>&1 || die "User $KINDRED_USER does not exist."

log "Installing sudo + sqlite3 ..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq sudo sqlite3

log "Ensuring /etc/sudoers.d exists ..."
install -d -m 0750 -o root -g root /etc/sudoers.d

log "Writing sudoers rule for the privileged backup helper ..."
cat > "$SUDOERS_FILE" <<'SUDOERS'
# Managed by scripts/install-backup-prereqs.sh
# Lets the unprivileged kindred user invoke the backup-config helper as root.
# The helper validates its input file (path under /tmp, owned by kindred,
# JSON schema) before touching /etc/kindred/*.
kindred ALL=(root) NOPASSWD: /usr/bin/node /opt/kindred/scripts/configure-backup-privileged.js
SUDOERS
chmod 0440 "$SUDOERS_FILE"
chown root:root "$SUDOERS_FILE"

log "Validating sudoers syntax ..."
visudo -cf "$SUDOERS_FILE" >/dev/null || die "visudo check failed for $SUDOERS_FILE"

log "Backup prerequisites installed OK."
echo "  - sudo: $(sudo -V | head -n1)"
echo "  - sqlite3: $(sqlite3 --version | awk '{print $1}')"
echo "  - rule: $SUDOERS_FILE"