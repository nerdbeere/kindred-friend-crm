#!/usr/bin/env node
//
// configure-backup-privileged.js — privileged helper that writes the
// Kindred backup configuration to /etc/kindred/ and installs the systemd
// units + sudoers rule + first backup.
//
// Invoked via sudo by the unprivileged kindred user (the Next.js process),
// both from the first-run wizard's POST /api/setup and from the admin UI's
// POST /api/admin/backup/enable.
//
// Sudoers whitelist (installed by scripts/install-backup-prereqs.sh):
//   kindred ALL=(root) NOPASSWD: /usr/bin/node /opt/kindred/scripts/configure-backup-privileged.js *
// (The trailing ` *` wildcard is mandatory — sudoers matches args EXACTLY
// without it, and the real invocation appends the JSON file path.)
//
// Usage (as root via sudo):
//   sudo -n /usr/bin/node /opt/kindred/scripts/configure-backup-privileged.js <json-file>
//
// The JSON file is a regular file under /tmp owned by the kindred user,
// max 64 KiB. Schema:
//   {
//     "endpoint":  "https://s3.example.com",   // required, https only
//     "bucket":    "kindred-backups",          // required
//     "prefix":    "kindred/kindred-ct120",    // required
//     "region":    "",                          // optional
//     "access_key_id":     "...",               // required
//     "secret_access_key": "...",               // required
//     "restic_password":   "..." | null         // null = generate 32 random bytes
//   }
//
// Output: single JSON line on stdout: {"ok":true} or {"ok":false,"error":"..."}
// Exit code: 0 on success, non-zero on failure.

const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync, spawnSync } = require("child_process");
const crypto = require("crypto");

const KINDRED_USER = process.env.KINDRED_USER || "kindred";
const APP_DIR = "/opt/kindred";
const ETC_DIR = "/etc/kindred";
const SYSTEMD_DST_DIR = "/etc/systemd/system";
const SUDOERS_DST = "/etc/sudoers.d/kindred-backup";

function fail(error) {
  process.stdout.write(JSON.stringify({ ok: false, error }) + "\n");
  process.exit(1);
}

function ok(payload) {
  process.stdout.write(JSON.stringify(Object.assign({ ok: true }, payload)) + "\n");
  process.exit(0);
}

// --- Validate argv ---------------------------------------------------------
const inputPath = process.argv[2];
if (!inputPath) fail("missing input file argument");
if (!inputPath.startsWith("/tmp/")) fail("input file must be under /tmp");
const resolved = path.resolve(inputPath);
if (!resolved.startsWith("/tmp/")) fail("input file must resolve under /tmp");

let stat;
try {
  stat = fs.statSync(resolved);
} catch (e) {
  fail(`cannot stat input file: ${e.message}`);
}
if (!stat.isFile()) fail("input must be a regular file");
if (stat.size > 64 * 1024) fail("input file too large (>64KiB)");

// Verify owner is the kindred user (so an attacker who hasn't already
// compromised the kindred account can't feed this script anything).
try {
  const passwd = fs.readFileSync("/etc/passwd", "utf8");
  const kindredLine = passwd.split("\n").find((l) => l.startsWith(`${KINDRED_USER}:`));
  if (!kindredLine) fail(`no passwd entry for ${KINDRED_USER}`);
  const kindredUid = parseInt(kindredLine.split(":")[2], 10);
  if (stat.uid !== kindredUid) fail(`input file must be owned by ${KINDRED_USER} (uid ${kindredUid}), got uid ${stat.uid}`);
} catch (e) {
  fail(`cannot verify owner: ${e.message}`);
}

// --- Parse + validate JSON -------------------------------------------------
let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(resolved, "utf8"));
} catch (e) {
  fail(`invalid JSON: ${e.message}`);
}

const required = ["endpoint", "bucket", "prefix", "access_key_id", "secret_access_key"];
for (const k of required) {
  if (typeof cfg[k] !== "string" || cfg[k].length === 0) {
    fail(`missing or empty field: ${k}`);
  }
}
if (!cfg.endpoint.startsWith("https://") && !/^http:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(cfg.endpoint)) {
  if (cfg.endpoint.startsWith("http://")) {
    fail("plaintext http:// endpoints are refused — use https:// (loopback is allowed for local testing)");
  }
  fail("endpoint must start with https://");
}
if (typeof cfg.region !== "string") cfg.region = "";
if (typeof cfg.restic_password !== "string" || cfg.restic_password.length === 0) {
  cfg.restic_password = null; // generate
}

// Disallow shell metachars in fields that will become env vars. We're
// writing via fs.writeFile (no shell), so this is defense-in-depth.
const dangerous = /[\n\r\0]/;
for (const k of ["endpoint", "bucket", "prefix", "region", "access_key_id", "secret_access_key"]) {
  if (dangerous.test(cfg[k])) fail(`field ${k} contains forbidden characters`);
}

// Resolve kindred uid + gid from /etc/passwd. We run as root via sudo,
// so os.userInfo() would return root's ids — useless for chowning files
// that the kindred user needs to read.
function kindredIds() {
  try {
    const passwd = fs.readFileSync("/etc/passwd", "utf8");
    const line = passwd.split("\n").find((l) => l.startsWith(`${KINDRED_USER}:`));
    if (!line) throw new Error(`no passwd entry for ${KINDRED_USER}`);
    const parts = line.split(":");
    return { uid: parseInt(parts[2], 10), gid: parseInt(parts[3], 10) };
  } catch (e) {
    fail(`cannot resolve ${KINDRED_USER} uid/gid from /etc/passwd: ${e.message}`);
  }
}
const { uid: kuid, gid: kgid } = kindredIds();

// --- Write /etc/kindred/ ---------------------------------------------------
try {
  fs.mkdirSync(ETC_DIR, { recursive: true, mode: 0o750 });
  // chown to root:kindred so the kindred user (group) can traverse + read.
  fs.chownSync(ETC_DIR, 0, kgid);
} catch (e) {
  // fall through — /etc/kindred likely already exists
}

// restic.pass: preserve if exists, else generate.
const resticPassPath = path.join(ETC_DIR, "restic.pass");
let resticPass = cfg.restic_password;
if (!resticPass) {
  if (fs.existsSync(resticPassPath) && fs.statSync(resticPassPath).size > 0) {
    resticPass = fs.readFileSync(resticPassPath, "utf8").trim();
  } else {
    resticPass = crypto.randomBytes(32).toString("base64");
  }
}
try {
  // 0640 root:kindred — restic runs as the kindred user (timer + ad-hoc
  // UI-triggered backups) and must be able to READ the password file.
  fs.writeFileSync(resticPassPath, resticPass + "\n", { mode: 0o640 });
  fs.chownSync(resticPassPath, 0, kgid);
  fs.chmodSync(resticPassPath, 0o640);
} catch (e) {
  fail(`failed to write restic.pass: ${e.message}`);
}

// backup.env
const endpoint = cfg.endpoint.replace(/\/$/, "");
const prefix = cfg.prefix.replace(/^\/+/, "").replace(/\/+$/, "");
const backupEnv = [
  "# Managed by scripts/configure-backup-privileged.js — do not edit by hand.",
  `BACKUP_S3_ENDPOINT=${endpoint}`,
  `BACKUP_S3_BUCKET=${cfg.bucket}`,
  `BACKUP_S3_PREFIX=${prefix}`,
  `BACKUP_S3_REGION=${cfg.region}`,
  `AWS_ACCESS_KEY_ID=${cfg.access_key_id}`,
  `AWS_SECRET_ACCESS_KEY=${cfg.secret_access_key}`,
  `RESTIC_PASSWORD_FILE=${resticPassPath}`,
  `BACKUP_KEEP_DAILY=7`,
  `BACKUP_KEEP_WEEKLY=4`,
  `BACKUP_KEEP_MONTHLY=6`,
  `BACKUP_CHECK_WEEKLY=1`,
  `DATABASE_PATH=${APP_DIR}/data/kindred.db`,
  `BACKUP_SNAPSHOT_DIR=/var/lib/kindred-backup`,
  "",
].join("\n");

const backupEnvPath = path.join(ETC_DIR, "backup.env");
try {
  // 0640 root:kindred — the Next.js app (kindred user) reads this via
  // lib/backup-runner.ts, and ad-hoc backup.sh runs source it directly.
  fs.writeFileSync(backupEnvPath, backupEnv, { mode: 0o640 });
  fs.chownSync(backupEnvPath, 0, kgid);
  fs.chmodSync(backupEnvPath, 0o640);
} catch (e) {
  fail(`failed to write backup.env: ${e.message}`);
}

// Snapshot dir
try {
  fs.mkdirSync("/var/lib/kindred-backup", { recursive: true, mode: 0o750 });
  fs.chownSync("/var/lib/kindred-backup", kuid, kgid);
} catch (e) {
  // non-fatal
}

// --- Install restic binary if missing --------------------------------------
function resticInstalled() {
  try {
    execFileSync("/usr/local/bin/restic", ["version"], { stdio: "ignore" });
    return true;
  } catch {
    try {
      execFileSync("restic", ["version"], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}
if (!resticInstalled()) {
  // Install pinned restic via apt if available, else download.
  // (We prefer the explicit version pin in enable-backup-lxc.sh, but this
  // is a fallback so the wizard path works standalone.)
  try {
    execFileSync("bash", ["-c", "apt-get install -y -qq restic 2>/dev/null || true"], { stdio: "ignore" });
  } catch {
    // ignore
  }
}
if (!resticInstalled()) {
  fail("restic binary not installed — run proxmox/enable-backup-lxc.sh or apt install restic");
}

// --- restic init (test creds + create repo) --------------------------------
const repoUrl = `s3:${endpoint}/${cfg.bucket}/${prefix}`;
const env = Object.assign({}, process.env, {
  RESTIC_REPOSITORY: repoUrl,
  RESTIC_PASSWORD_FILE: resticPassPath,
  AWS_ACCESS_KEY_ID: cfg.access_key_id,
  AWS_SECRET_ACCESS_KEY: cfg.secret_access_key,
  AWS_REGION: cfg.region || "us-east-1",
});
if (cfg.region) env.RESTIC_S3_REGION = cfg.region;

const snapshotsResult = spawnSync("restic", ["snapshots", "--json"], { env, encoding: "utf8" });
if (snapshotsResult.status !== 0) {
  // Likely needs init
  const initResult = spawnSync("restic", ["init"], { env, encoding: "utf8" });
  if (initResult.status !== 0) {
    fail(`restic init failed: ${(initResult.stderr || "").trim().slice(0, 400)}`);
  }
}

// --- Install systemd units -------------------------------------------------
const serviceUnit = `[Unit]
Description=Kindred encrypted backup to S3
Documentation=file:///opt/kindred/docs/BACKUPS.md
After=network-online.target kindred.service
Wants=network-online.target
ConditionPathExists=/etc/kindred/backup.env

[Service]
Type=oneshot
User=${KINDRED_USER}
Group=${KINDRED_USER}
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
`;

const timerUnit = `[Unit]
Description=Run Kindred backup daily

[Timer]
OnCalendar=*-*-* 03:00:00
Persistent=true
RandomizedDelaySec=10m
Unit=kindred-backup.service

[Install]
WantedBy=timers.target
`;

const sudoersRule = `# Managed by scripts/configure-backup-privileged.js
# Allows the kindred user to stop/start/restart its own service for restores.
kindred ALL=(root) NOPASSWD: /bin/systemctl restart kindred, /bin/systemctl stop kindred, /bin/systemctl start kindred
`;

try {
  // The `sudo` package provides /etc/sudoers.d/. `mkdirSync` is a no-op
  // if it already exists, and a sane default if it doesn't.
  fs.mkdirSync(path.dirname(SUDOERS_DST), { recursive: true, mode: 0o750 });
  fs.writeFileSync(path.join(SYSTEMD_DST_DIR, "kindred-backup.service"), serviceUnit, { mode: 0o644 });
  fs.writeFileSync(path.join(SYSTEMD_DST_DIR, "kindred-backup.timer"), timerUnit, { mode: 0o644 });
  fs.writeFileSync(SUDOERS_DST, sudoersRule, { mode: 0o440 });
  fs.chownSync(SUDOERS_DST, 0, 0);
  // Validate sudoers syntax (requires `sudo` to be installed — asserted below).
  if (spawnSync("which", ["visudo"], { encoding: "utf8" }).status !== 0) {
    fail("`visudo` not found — install the `sudo` package before running this helper");
  }
  const visudo = spawnSync("visudo", ["-cf", SUDOERS_DST], { encoding: "utf8" });
  if (visudo.status !== 0) {
    fail(`sudoers file failed visudo check: ${(visudo.stderr || "").trim()}`);
  }
} catch (e) {
  fail(`failed to install systemd/sudoers units: ${e.message}`);
}

try {
  execFileSync("systemctl", ["daemon-reload"], { stdio: "ignore" });
  execFileSync("systemctl", ["enable", "--now", "kindred-backup.timer"], { stdio: "ignore" });
} catch (e) {
  fail(`failed to enable timer: ${e.message}`);
}

// --- Kick first backup (fire-and-forget; non-fatal if it fails) ------------
const firstBackup = spawnSync(
  "bash",
  ["-c", `su -s /bin/bash ${KINDRED_USER} -c 'cd ${APP_DIR} && bash ${APP_DIR}/scripts/backup.sh'`],
  { encoding: "utf8", timeout: 120000 },
);
const firstBackupOk = firstBackup.status === 0;

ok({
  repository: repoUrl,
  first_backup: firstBackupOk ? "ok" : "failed-check-journal",
});