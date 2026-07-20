#!/usr/bin/env bash
#
# setup-auth.sh — Mint the admin auth secret + the one-time setup token.
#
# Runs INSIDE the LXC container as root, invoked by proxmox/setup-lxc.sh
# at the end of provisioning. Idempotent: re-running only refreshes the
# setup token (and leaves AUTH_SECRET alone if it already exists).
#
# Writes:
#   /etc/kindred/auth.env      AUTH_SECRET=<32 random bytes base64>   (0640 root:kindred)
#   /etc/kindred/setup-token   <one-time uuid>                        (0640 root:kindred)
#
# Prints the setup-token to stdout (captured by setup-lxc.sh and shown
# to the operator on the console).

set -euo pipefail

KINDRED_USER="${KINDRED_USER:-kindred}"
AUTH_ENV="/etc/kindred/auth.env"
SETUP_TOKEN_FILE="/etc/kindred/setup-token"

install -d -m 0750 -o root -g "$KINDRED_USER" /etc/kindred

# AUTH_SECRET: 32 random bytes, base64. Generated once; preserved across re-runs.
# Mode 0640 root:kindred — the app (kindred group) reads it directly as a
# fallback when the env var isn't loaded (systemd only reads EnvironmentFile
# at unit start; the lazy file read makes ordering bugs self-healing).
if [ ! -s "$AUTH_ENV" ] || ! grep -q '^AUTH_SECRET=' "$AUTH_ENV"; then
  AUTH_SECRET="$(head -c 32 /dev/urandom | base64)"
  cat > "$AUTH_ENV" <<EOF
# Managed by scripts/setup-auth.sh — do not edit by hand.
AUTH_SECRET=${AUTH_SECRET}
EOF
  chmod 0640 "$AUTH_ENV"
  chown root:"$KINDRED_USER" "$AUTH_ENV"
else
  # Existing file: make sure the mode is group-readable (older installs
  # used 0600, which the app cannot read as a fallback).
  chmod 0640 "$AUTH_ENV"
  chown root:"$KINDRED_USER" "$AUTH_ENV"
fi

# One-time setup token: regenerated on every run so re-deploys get a fresh one.
# It's consumed by POST /api/setup and then deleted.
# Mode 0640 root:kindred — the Next.js app (running as kindred) reads it
# directly via fs.readFile to verify the wizard's token input.
SETUP_TOKEN="$(head -c 16 /dev/urandom | base64 | tr -d '/+=' | tr '+/' '-_' | cut -c1-22)"
printf '%s\n' "$SETUP_TOKEN" > "$SETUP_TOKEN_FILE"
chmod 0640 "$SETUP_TOKEN_FILE"
chown root:"$KINDRED_USER" "$SETUP_TOKEN_FILE"

# Print ONLY the setup token to stdout — setup-lxc.sh captures this.
printf '%s\n' "$SETUP_TOKEN"