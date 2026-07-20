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
# The trailing ` *` wildcard is REQUIRED: sudoers matches command arguments
# EXACTLY unless a wildcard is present, and the real invocation always
# appends the JSON config file path. Without it the rule silently never
# matched and sudo demanded a password.
# The helper validates its input file (path under /tmp, owned by kindred,
# JSON schema) before touching /etc/kindred/*.
kindred ALL=(root) NOPASSWD: /usr/bin/node /opt/kindred/scripts/configure-backup-privileged.js *
SUDOERS
chmod 0440 "$SUDOERS_FILE"
chown root:root "$SUDOERS_FILE"

log "Validating sudoers syntax ..."
visudo -cf "$SUDOERS_FILE" >/dev/null || die "visudo check failed for $SUDOERS_FILE"

# Repair permissions on existing config files. Older installers wrote these
# 0600 root:kindred, which the kindred user CANNOT read — breaking the
# app's status endpoint and ad-hoc restic runs. They must be group-readable.
for f in /etc/kindred/backup.env /etc/kindred/restic.pass; do
  if [ -f "$f" ]; then
    chown root:"$KINDRED_USER" "$f"
    chmod 0640 "$f"
    log "Repaired perms on $f (0640 root:$KINDRED_USER)"
  fi
done

# Self-test: invoke the helper AS the kindred user via sudo -n, WITH a
# dummy config-path argument. The dummy arg is REQUIRED: the wildcard rule
# `...configure-backup-privileged.js *` only matches when at least one
# extra argument follows the script path — a bare invocation legitimately
# fails the match and would falsely report a broken rule (verified on
# Debian 12). We expect the helper to RUN and reject the missing file with
# a JSON error; "a password is required" means the rule doesn't match.
SELFTEST_ARG="/tmp/kindred-sudoers-selftest.json"
log "Self-testing the sudoers rule as user $KINDRED_USER ..."
OUT="$(su -s /bin/bash "$KINDRED_USER" -c "sudo -n /usr/bin/node /opt/kindred/scripts/configure-backup-privileged.js $SELFTEST_ARG 2>&1" || true)"
if printf '%s' "$OUT" | grep -qi "a password is required"; then
  die "sudoers rule installed but the helper invocation still demands a password — inspect $SUDOERS_FILE"
fi
printf '  helper responded (sudo OK): %s\n' "$(printf '%s' "$OUT" | head -n1)"

log "Backup prerequisites installed OK."
echo "  - sudo: $(sudo -V | head -n1)"
echo "  - sqlite3: $(sqlite3 --version | awk '{print $1}')"
echo "  - rule: $SUDOERS_FILE"