# Kindred — Encrypted Backups & One-Click Restore

This document is the authoritative spec and runbook for Kindred's backup,
restore, and admin-auth subsystems. It is written for the self-hosting
operator (you) — read it once before first deploy, keep it around for
restore-from-scratch.

> Status: **Phase 1 (CLI foundation) + minimal admin auth + UI controls**
> shipped together. Object Lock / WORM hardening is documented as a
> Phase 3 follow-up; everything else described here is implemented.

---

## 1. Overview

Kindred's only state is a single SQLite file at `data/kindred.db` running
in WAL mode. Backups are a consistent snapshot of that file, encrypted
client-side, pushed to any S3-compatible backend, snapshot-managed with
retention, and restorable with a single command or one click in the UI.

Tool choices:

- **`restic`** — single static binary, AES-256-CTR client-side encryption,
  native `s3:` backend (any S3-compatible endpoint via URL override),
  snapshot-based with `forget --prune` retention, `check` for integrity.
- **`sqlite3 .backup`** — produces a transactionally-consistent snapshot
  of a WAL-mode database; no need to copy `-wal` / `-shm` artificially.
- **`@node-rs/argon2`** — pre-built napi binaries, no `node-gyp` on the
  LXC, used for the admin password hash.
- **`systemd` timer** — daily 03:00, `RandomizedDelaySec=10m`,
  `Persistent=true` (catches up after downtime).

What we deliberately do **not** do:

- Backup the app code (it lives in git, not in the database).
- Use server-side S3 encryption as the only protection — **the operator
  of the S3 backend must not be able to read your data**. Client-side
  encryption with a key only you hold is the only thing that satisfies
  that.
- Run the backup job as root, or give the backup job host access.

---

## 2. Architecture

```
   LXC container (unprivileged Debian 12, runs as `kindred` user)
   ┌─────────────────────────────────────────────────────────────┐
   │ /opt/kindred/data/kindred.db   (live, WAL mode)             │
   │            │                                                 │
   │            │ sqlite3 .backup  (WAL-safe consistent snapshot) │
   │            ▼                                                 │
   │ /var/lib/kindred-backup/snapshot.db                          │
   │            │                                                 │
   │            │ restic backup  (AES-256 client-side encrypt)    │
   │            ▼                                                 │
   └────────────│────────────────────────────────────────────────┘
                │ TLS (HTTPS only — installer refuses http://)
                ▼
         S3-compatible bucket
         s3://<endpoint>/<bucket>/<prefix>/
         (the backend sees ciphertext only)
```

- Backup job runs **inside the LXC**, as the unprivileged `kindred`
  user, via a systemd timer.
- Secrets in `/etc/kindred/backup.env` (`0600`, `root:kindred`, loaded
  by systemd `EnvironmentFile=`). The restic repo password lives in
  `/etc/kindred/restic.pass` (`0600`, `root:kindred`).
- Neither file is ever in git, ever in the Next.js `process.env`, ever
  readable by the app's HTTP layer directly. The admin API routes read
  status via restic, not by reading the password file in process memory.

---

## 3. Threat model & mitigations

| Threat                              | Mitigation                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| S3 backend operator reads data      | Client-side AES-256 via restic; only ciphertext leaves the CT.                                                                              |
| Restic repo password leaks          | `RESTIC_PASSWORD_FILE` `0600 root:kindred`; never in git, app env, or Next.js `process.env`.                                               |
| S3 credentials exfiltrated from CT  | IAM creds scoped to one bucket prefix; only `PutObject` / `GetObject` / `DeleteObject` / `ListObjects`. No bucket-admin.                   |
| Ransomware / malicious deletion     | (Phase 3) Object Lock / WORM where backend supports it (B2, R2, AWS S3, MinIO, Wasabi all do). Separate read-only creds for restore-only hosts. Weekly `restic check` detects tampering. |
| Silent corruption                   | `restic check --read-data-subset=5%` weekly, full monthly.                                                                                 |
| Backup of a half-written DB        | `sqlite3 .backup` produces a transactionally-consistent snapshot regardless of WAL state.                                                  |
| Restore fails mid-flight            | Pre-restore DB moved aside (last 3 kept as `data/kindred.db.pre-restore.<ts>`); atomic swap; auto-rollback on health-check failure.        |
| Service downtime during restore     | ~5–15s, surfaced in the UI restore confirmation modal and documented in the CLI script output.                                            |
| Container destroyed (disaster)      | "Restore from scratch" runbook in §10; requires saved restic repo password + S3 creds.                                                     |
| Transport sniffing                  | Installer refuses non-`https://` endpoints.                                                                                                 |
| Backups running as root             | No. Runs as unprivileged `kindred`. Sudoers whitelist is one narrow line (see §6).                                                         |
| Setup-window abuse (no admin yet)   | `X-Setup-Token` default-on (random, console-printed, one-time); `POST /api/setup` rate-limited 5/15min/IP; window auto-closes once password is set. |
| Admin endpoint abuse                | Auth + argon2id + CSRF (SameSite=Lax + `Origin` check on admin POSTs) + arg-validated subprocess calls (no shell interpolation). Restore is a destructive action — UI shows a confirmation modal and the API accepts an optional `confirm: "RESTORE"` field. |
| Admin password leak                 | argon2id hash in `settings.admin_password_hash`; rate-limited login (5 / 15 min / IP) with lockout alerting to journald.                    |
| Auth secret leak                    | `AUTH_SECRET` in `/etc/kindred/auth.env` `0600 root:kindred`, never in git; rotatable via script (old cookies invalidated).                 |
| Open `/api/contacts/*` (existing)   | **Known follow-up, not changed in this pass** to avoid breaking Home Assistant and the existing UX. Tracked in §13.                        |

---

## 4. Configuration reference

All secrets live in `/etc/kindred/`. Layout:

```
/etc/kindred/
  backup.env          # S3 endpoint, bucket, prefix, retention, AWS creds (0600 root:kindred)
  restic.pass         # 32 random bytes, the AES key envelope password   (0600 root:kindred)
  auth.env            # AUTH_SECRET for cookie signing                   (0600 root:kindred)
  setup-token         # one-time token for the first-run wizard          (0600 root:kindred), deleted after use
```

`/etc/kindred/backup.env`:

| Var                       | Required | Example                                              | Notes                                                    |
| ------------------------- | -------- | ---------------------------------------------------- | -------------------------------------------------------- |
| `BACKUP_S3_ENDPOINT`      | yes      | `https://s3.us-west-004.backblazeb2.com`             | HTTPS only. Installer rejects `http://`.                |
| `BACKUP_S3_BUCKET`        | yes      | `kindred-backups`                                    | Must exist; installer does not create it.                |
| `BACKUP_S3_PREFIX`        | yes      | `kindred/kindred-ct120`                              | Per-deploy isolation inside a shared bucket.             |
| `BACKUP_S3_REGION`        | no       | `us-east-1`                                          | Often ignored by non-AWS backends.                       |
| `AWS_ACCESS_KEY_ID`       | yes      |                                                      | Scoped IAM creds (see §11).                              |
| `AWS_SECRET_ACCESS_KEY`   | yes      |                                                      |                                                          |
| `RESTIC_PASSWORD_FILE`    | yes      | `/etc/kindred/restic.pass`                           | Loaded by restic via env.                                |
| `BACKUP_KEEP_DAILY`       | no       | `7`                                                  | Default 7.                                               |
| `BACKUP_KEEP_WEEKLY`      | no       | `4`                                                  | Default 4.                                               |
| `BACKUP_KEEP_MONTHLY`     | no       | `6`                                                  | Default 6.                                               |
| `BACKUP_CHECK_WEEKLY`     | no       | `1`                                                  | Default 1 — run `restic check` on Sundays.               |
| `DATABASE_PATH`           | no       | `/opt/kindred/data/kindred.db`                       | Default: `/opt/kindred/data/kindred.db`.                 |
| `BACKUP_SNAPSHOT_DIR`     | no       | `/var/lib/kindred-backup`                            | Where the consistent SQLite snapshot is staged.          |
| `RESTIC_REPOSITORY`       | derived  | `s3:<endpoint>/<bucket>/<prefix>`                    | Computed by scripts; do not set manually.                |

`/etc/kindred/auth.env`:

| Var           | Required | Notes                                                              |
| ------------- | -------- | ------------------------------------------------------------------ |
| `AUTH_SECRET`  | yes      | 32 random bytes, base64. Used to sign the `kindred_admin` cookie.  |

Retention default: **1 backup/day at 03:00, 7 daily / 4 weekly / 6 monthly → ~17 snapshots, ~1 year of history.**

---

## 5. First-run setup wizard

The admin account and backups are configured through a one-time wizard,
**not** by hand-editing config files. Flow:

1. Deploy via `proxmox/setup-lxc.sh` (or the one-liner in README). At the
   end, the installer prints a **one-time setup token** to the console,
   e.g.:

   ```
   ===> Setup token (paste into the wizard once): 9f3c1a8e-b7d4-4f02-9a51-2c8e0a1f6b42
   ```

2. Browse to `http://<container-ip>:3000/` — middleware detects no
   `admin_password_hash` in `settings` and redirects you to `/setup`.

3. Wizard step 1: **Create admin password** (12-char min, strength meter).
4. Wizard step 2 (optional, skippable): **Configure encrypted backups** —
   endpoint, bucket, prefix, region, access key, secret key, restic repo
   password (or "generate for me"). Skipping leaves backups unconfigured;
   you can enable later from `/admin/backups`.
5. Wizard step 3: **Summary + Finish**. `POST /api/setup` runs:
   - argon2id-hashes the password and writes `settings.admin_password_hash` (atomic transaction)
   - if backup fields provided: writes `/etc/kindred/backup.env` + `/etc/kindred/restic.pass` (0600 root:kindred), runs `restic init`, installs the systemd units, enables the timer, kicks off the first backup
   - deletes `/etc/kindred/setup-token` (one-time use)
   - signs and sets the `kindred_admin` session cookie — you're logged in immediately
6. After completion, `/api/setup` returns `410 Gone` and middleware stops redirecting.

> **Security note for the open setup window**: while no admin password
> exists, `/api/setup` is the only unauthenticated write route. Mitigations:
> - `X-Setup-Token` header must match `/etc/kindred/setup-token` (default-on; printed on the console by the installer)
> - Rate-limited to 5 attempts / 15 min / IP
> - Window auto-closes on first password set
> - The wizard only ever modifies `admin_password_hash` + `/etc/kindred/*` files; it cannot touch contacts or the feed token
>
> **Operational guidance**: complete the wizard within a few minutes of
> first boot, before exposing the box beyond localhost. If you abandon
> the deploy, the open window persists — `systemctl stop kindred` until
> you're ready.

---

## 6. Sudoers whitelist

Restore needs to stop/restart the `kindred` systemd unit, but the backup
job runs as the unprivileged `kindred` user. One narrow sudoers rule is
written by `enable-backup-lxc.sh` to `/etc/sudoers.d/kindred-backup`
(`0440`, `root:root`):

```
kindred ALL=(root) NOPASSWD: /bin/systemctl restart kindred, /bin/systemctl stop kindred, /bin/systemctl start kindred
```

Nothing else. No `NOPASSWD: ALL`, no wildcards, no shell escapes.

---

## 7. CLI reference

### `scripts/backup.sh`

Runs as `kindred`. Reads `/etc/kindred/backup.env`.

```
sqlite3 <DATABASE_PATH> ".backup '<SNAPSHOT_PATH>'"          # consistent snapshot
restic backup <SNAPSHOT_DIR> --tag kindred --tag <hostname>   # encrypted upload
restic forget --keep-daily N --keep-weekly N --keep-monthly N --prune
# Sundays: restic check --read-data-subset=5%
```

Exit codes:

| Code | Meaning                                           |
| ---- | ------------------------------------------------- |
| 0    | success                                           |
| 2    | missing config (no `backup.env`, no `restic.pass`) |
| 3    | `sqlite3` binary missing                          |
| 4    | `restic` binary missing                           |
| 5    | snapshot creation failed                          |
| 6    | restic backup failed                              |
| 7    | restic forget/prune failed (non-fatal: logs only) |
| 8    | restic check failed (non-fatal: logs only)        |

Emits a single JSON status line to journald tagged `kindred-backup`:

```json
{"status":"ok","snapshot_id":"abc123...","duration_s":12,"size_bytes":4096,"repo_size_bytes":12345}
```

### `scripts/restore.sh [snapshot-id|latest] [--dry-run]`

Runs as `kindred`; uses the sudoers rule for service control.

```
restic restore <id> --target <TMPDIR>
sudo systemctl stop kindred
mv <DB> <DB>.pre-restore.<unix-ts>     # keeps last 3
mv <TMPDIR>/snapshot.db <DB>
chown kindred:kindred <DB>
sudo systemctl start kindred
# poll GET / for health
# on failure: roll back to the most-recent pre-restore copy, restart, exit nonzero
```

- `--dry-run` restores into a temp dir and compares with the live DB; does not stop the service.
- Keeps the last 3 pre-restore copies; older ones are pruned.

### `proxmox/enable-backup-lxc.sh <CT_ID> [--interactive]`

Run as root on the Proxmox host. Idempotent. Steps:

1. Installs `sqlite3`, `ca-certificates` in the CT if missing.
2. Downloads `restic` (pinned version, SHA-256 verified) to `/usr/local/bin/restic` (`0755`).
3. Generates `/etc/kindred/restic.pass` (32 random bytes from `/dev/urandom`) if missing.
4. Prompts for (or accepts via env: `BACKUP_S3_*`, `AWS_*`) the S3 endpoint/bucket/prefix/region/creds.
5. Writes `/etc/kindred/backup.env` (`0600 root:kindred`).
6. Runs `restic init` (fails fast on bad creds / unreachable endpoint / non-HTTPS).
7. Probes the bucket for Object Lock capability; warns if not available — non-fatal.
8. Installs `systemd/kindred-backup.service` + `systemd/kindred-backup.timer`; writes the sudoers rule (§6).
9. Enables + starts the timer; runs an immediate first backup.
10. Prints next-run time + restore runbook summary.

Source-tests the connection first (`restic snapshots`), so a wrong
bucket/creds fails before any state is touched.

---

## 8. Systemd units

`systemd/kindred-backup.service` (installed to `/etc/systemd/system/` in the CT):

```ini
[Unit]
Description=Kindred encrypted backup to S3
Documentation=file:///opt/kindred/docs/BACKUPS.md
After=network-online.target kindred.service
Wants=network-online.target
# Don't start if backups aren't configured.
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
# Hardening
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
```

`systemd/kindred-backup.timer`:

```ini
[Unit]
Description=Run Kindred backup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=10m
Unit=kindred-backup.service

[Install]
WantedBy=timers.target
```

Status:

```
systemctl status kindred-backup.timer
systemctl list-timers kindred-backup.timer
journalctl -u kindred-backup.service -n 50
```

---

## 9. Admin auth & the UI

### Login

- `/admin/login` — single form, password only.
- `POST /api/admin/login` — argon2id verify, signed `kindred_admin` cookie (HttpOnly, `SameSite=Lax`, `Secure` when HTTPS, 14d). Rate-limited 5 / 15 min / IP, lockout alert to journald.
- `POST /api/admin/logout` — clears the cookie.
- Password rotation at `/admin/settings` (re-auth required).

### CSRF

`SameSite=Lax` cookie + `Origin` header check on admin POSTs. No token dance.

### `/admin/backups` page

- Status card: last backup time, last `check` time, next scheduled run, repo size, days of history.
- "Back up now" button → `POST /api/admin/backup`.
- Snapshot table (paginated) → `GET /api/admin/backup/snapshots`.
- Per-row "Restore" button → confirmation modal showing timestamp + "brief service downtime" warning → `POST /api/admin/backup/restore { snapshot, confirm: "RESTORE" }`.

### Admin API routes

All require auth. All exec scripts with **arg-validated inputs** passed
via `execFile` (no shell interpolation, no user input in `--repo` etc.).

| Method | Path                              | Purpose                                       |
| ------ | --------------------------------- | --------------------------------------------- |
| POST   | `/api/admin/backup`               | Trigger ad-hoc backup                         |
| GET    | `/api/admin/backup/status`        | Last backup / check / next-run / repo stats   |
| GET    | `/api/admin/backup/snapshots`     | `restic snapshots --json` wrapper             |
| POST   | `/api/admin/backup/restore`       | Body `{ snapshot, confirm }` runs restore.sh   |
| POST   | `/api/admin/backup/enable`        | Wraps `enable-backup-lxc.sh` (sudoers-wlisted) |
| GET    | `/api/admin/backup/config`        | Current retention schedule                    |
| PUT    | `/api/admin/backup/config`        | Update retention (writes `backup.env`)        |
| POST   | `/api/admin/login`                | Login                                         |
| POST   | `/api/admin/logout`               | Logout                                        |
| GET    | `/api/admin/settings`             | Settings page data                             |
| PUT    | `/api/admin/settings`             | Password rotation                             |

### `middleware.ts`

- Matches `/admin/*` and `/api/admin/*` — requires valid `kindred_admin` cookie, else 401 (API) or redirect to `/admin/login` (page).
- While `settings.admin_password_hash` is empty: redirects both to `/setup`.
- Allows `/setup`, `POST /api/setup`, `/api/feed/*`, `/api/contacts/*`, `/` through at all times.

---

## 10. Restore runbooks

### A. Regular restore (UI or CLI)

**UI**: `/admin/backups` → pick snapshot → "Restore" → confirm in modal.
The API runs `scripts/restore.sh <id>`, the page polls
`/api/admin/backup/status` until the service is healthy, then reflects
the new "last restored" time. Brief service downtime (~5–15s) is
expected.

**CLI** (inside the CT):

```bash
sudo -u kindred /opt/kindred/scripts/restore.sh latest
# or:
sudo -u kindred /opt/kindred/scripts/restore.sh <snapshot-id>
# dry-run (no service stop, no swap):
sudo -u kindred /opt/kindred/scripts/restore.sh latest --dry-run
```

The feed token lives in the DB → the ICS feed URL survives the restore.

### B. Restore from scratch (disaster: container destroyed)

Requirements: the saved restic repo password (`/etc/kindred/restic.pass`
— back this up somewhere safe, e.g. a password manager), the S3 endpoint
/ bucket / prefix, and IAM creds with `GetObject`/`ListObjects` on that
prefix.

```bash
# 1. On the Proxmox host: provision a fresh CT and deploy the app
curl -fsSL https://raw.githubusercontent.com/nerdbeere/kindred-friend-crm-install/main/setup-lxc.sh | bash

# 2. Write the restored backup config by hand if you don't want the wizard:
pct exec <CT_ID> -- bash -c '
  install -d -m 700 -o root -g kindred /etc/kindred
  cat > /etc/kindred/restic.pass <<EOF
  <paste the 32-byte password you saved>
  EOF
  chmod 600 /etc/kindred/restic.pass
  chown root:kindred /etc/kindred/restic.pass

  cat > /etc/kindred/backup.env <<EOF
  BACKUP_S3_ENDPOINT=https://...
  BACKUP_S3_BUCKET=...
  BACKUP_S3_PREFIX=...
  AWS_ACCESS_KEY_ID=...
  AWS_SECRET_ACCESS_KEY=...
  RESTIC_PASSWORD_FILE=/etc/kindred/restic.pass
  EOF
  chmod 600 /etc/kindred/backup.env
  chown root:kindred /etc/kindred/backup.env
'

# 3. Install restic + restore the latest snapshot
pct exec <CT_ID> -- bash -c '
  apt-get update -qq && apt-get install -y -qq sqlite3 ca-certificates curl
  # download restic per the version pinned in enable-backup-lxc.sh
  curl -fsSL https://github.com/restic/restic/releases/download/v0.16.4/restic_0.16.4_linux_amd64.bz2 \
    | bunzip2 > /usr/local/bin/restic && chmod 0755 /usr/local/bin/restic
  sudo -u kindred /opt/kindred/scripts/restore.sh latest
'

# 4. Re-complete the wizard or skip by setting the password hash directly
#    (the wizard is recommended; it'll detect the restored DB and skip the
#    backup-config step since /etc/kindred/backup.env already exists).
```

### C. Restore a single contact (selective)

Restic snapshots are whole-DB by design. To pull a single contact out
without restoring the live DB:

```bash
sudo -u kindred /opt/kindred/scripts/restore.sh <snapshot-id> --dry-run --target /tmp/k
sqlite3 /tmp/k/snapshot.db ".dump contacts" | grep -A5 "John"
```

Then `INSERT` the row by hand.

---

## 11. IAM policy template (S3 backend)

Minimum permissions for the backup service account (AWS S3 / B2 / R2 /
MinIO / Wasabi — all support roughly this shape):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:ListBucket"],
      "Resource": "arn:aws:s3:::kindred-backups",
      "Condition": {"StringLike": {"s3:prefix": ["kindred/kindred-ct120/*"]}}
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject"],
      "Resource": "arn:aws:s3:::kindred-backups/kindred/kindred-ct120/*"
    }
  ]
}
```

For a restore-only host (e.g. disaster recovery off-site), drop
`PutObject`/`DeleteObject`; keep only `GetObject` + `ListBucket`.

---

## 12. Testing locally before deploying

A MinIO-based round-trip harness lives in the repo so you can verify
the entire backup → encrypt → upload → restore → swap → health check
flow before pointing it at a real S3 backend.

```bash
# Bring up MinIO in Docker, seed a test DB, run backup + restore, assert
# round-trip byte-equality, tear down:
npm run dev:backup-test

# Simulate a freshly-provisioned container: delete the local DB, restore
# from MinIO, verify the feed token survives:
npm run dev:restore-test
```

What it does (`scripts/dev-backup.sh`):

1. `docker compose -f docker/minio-compose.yml up -d` — MinIO on `localhost:9000`, console `:9001`, ephemeral volume, bucket `kindred-test` pre-created by a `minio/mc` sidecar.
2. Writes throwaway creds to `.dev-backup/backup.env` and `.dev-backup/restic.pass` (both gitignored).
3. Seeds a test SQLite DB with a few contacts + a feed token.
4. Runs `scripts/backup.sh` with `BACKUP_*` env pointed at MinIO.
5. Runs `scripts/restore.sh latest` against a fresh empty `data/` dir.
6. Asserts the restored DB is byte-identical to the source.
7. Prints a results table; non-zero exit on any failure.
8. Tears down the compose stack.

`scripts/dev-restore-test.sh` is the same but deletes the local DB
between backup and restore to simulate disaster recovery.

Requirements on your machine: Docker (or OrbStack / colima), nothing else.

---

## 13. Known follow-ups (not in this pass)

- **Object Lock / WORM hardening (Phase 3)** — installers should probe
  the bucket and, if the backend supports it, create an immutability
  policy on the prefix. Currently only warns.
- **`/api/contacts/*` is unauthenticated** — preserved as-is in this
  pass to avoid breaking Home Assistant and the existing UX. Adding
  a per-session or token-based gate is a separate change.
- **Quarterly automated restore-test into a throwaway CT** — Phase 3.
- **Failure notifications** (ntfy / healthchecks.io ping) — Phase 3.

---

## 14. File layout (this iteration)

```
docs/BACKUPS.md                    # this document
scripts/backup.sh                  # backup logic (runs as kindred)
scripts/restore.sh                 # restore logic (runs as kindred, sudoers-wlist for service ctl)
scripts/dev-backup.sh              # local MinIO round-trip test
scripts/dev-restore-test.sh        # local MinIO disaster-recovery simulation
scripts/setup-auth.sh              # mints AUTH_SECRET + setup-token inside the CT
proxmox/enable-backup-lxc.sh       # install restic + backup.env + sudoers + systemd
systemd/kindred-backup.service     # committed; copied into CT by enable-backup-lxc.sh
systemd/kindred-backup.timer       # committed; copied into CT by enable-backup-lxc.sh
docker/minio-compose.yml           # local test harness
lib/auth.ts                        # argon2 verify, cookie sign/verify, session helpers
lib/db.ts                          # +getSettings() / setSetting() / isFirstRun()
app/setup/page.tsx                 # the 3-step wizard
app/api/setup/route.ts             # POST = complete setup (gated by empty DB + X-Setup-Token)
app/admin/layout.tsx               # auth gate + nav
app/admin/login/page.tsx           # login form
app/admin/backups/page.tsx         # status, snapshot table, restore UI
app/admin/settings/page.tsx        # password rotation
app/api/admin/login/route.ts
app/api/admin/logout/route.ts
app/api/admin/backup/route.ts                 # POST = trigger backup
app/api/admin/backup/status/route.ts
app/api/admin/backup/snapshots/route.ts
app/api/admin/backup/restore/route.ts
app/api/admin/backup/enable/route.ts
app/api/admin/backup/config/route.ts
app/api/admin/settings/route.ts
middleware.ts                      # protects /admin/* and /api/admin/*
```

Edits to existing files:

- `README.md` — add a Backups section pointing here; note that `/admin/*` requires login.
- `.gitignore` — add `.dev-backup/`, `data/*.pre-restore.*`, `proxmox/*.local.env`.
- `package.json` — add `@node-rs/argon2`, add `dev:backup-test` and `dev:restore-test` scripts.
- `proxmox/setup-lxc.sh` — at the end, call `scripts/setup-auth.sh` to mint `AUTH_SECRET` + `setup-token`, and optionally `enable-backup-lxc.sh` when the caller passes `ENABLE_BACKUP=1`.
- `lib/db.ts` — `getSettings()` / `setSetting()` / `isFirstRun()` helpers.

---

## 15. Quick reference

```bash
# Inside the CT, as the kindred user:
/opt/kindred/scripts/backup.sh                          # ad-hoc backup
/opt/kindred/scripts/restore.sh latest                  # restore latest
/opt/kindred/scripts/restore.sh <snapshot-id>           # restore specific
/opt/kindred/scripts/restore.sh latest --dry-run        # preview

# Status:
systemctl status kindred-backup.timer
systemctl list-timers kindred-backup.timer
journalctl -u kindred-backup.service -n 100

# Restic manual (read-only, as kindred):
source /etc/kindred/backup.env
restic snapshots
restic stats
restic check --read-data-subset=5%

# From the Proxmox host:
pct exec <CT_ID> -- systemctl status kindred-backup.timer
./proxmox/enable-backup-lxc.sh <CT_ID>    # (re)enable backups on a deployment
```