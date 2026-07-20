import { spawn, spawnSync } from "child_process";
import { readFile } from "fs/promises";

/**
 * Wrappers around the on-box scripts (backup.sh, restore.sh, restic itself)
 * used by the admin API routes.
 *
 * All subprocess invocations pass args via execFile-style arrays (no shell
 * interpolation). User input is arg-validated before reaching here. See
 * docs/BACKUPS.md §3 (threat model) and §9 (admin UI).
 */

const BACKUP_ENV_FILE = process.env.BACKUP_ENV_FILE || "/etc/kindred/backup.env";

interface LoadedBackupEnv {
  RESTIC_REPOSITORY?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  AWS_REGION?: string;
  RESTIC_PASSWORD_FILE?: string;
  RESTIC_S3_REGION?: string;
  BACKUP_S3_ENDPOINT?: string;
  BACKUP_S3_BUCKET?: string;
  BACKUP_S3_PREFIX?: string;
  BACKUP_S3_REGION?: string;
  [k: string]: string | undefined;
}

let cachedEnv: LoadedBackupEnv | null = null;

/** Drop the cached /etc/kindred/backup.env parse (call after config changes). */
export function invalidateBackupEnvCache(): void {
  cachedEnv = null;
}

export async function loadBackupEnv(): Promise<LoadedBackupEnv> {
  if (cachedEnv) return cachedEnv;
  const out: LoadedBackupEnv = {};
  try {
    const txt = await readFile(BACKUP_ENV_FILE, "utf8");
    for (const line of txt.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 0) continue;
      const k = trimmed.slice(0, eq).trim();
      const v = trimmed.slice(eq + 1).trim();
      out[k] = v;
    }
  } catch {
    // No config — backups not enabled.
  }
  const endpoint = (out.BACKUP_S3_ENDPOINT || "").replace(/\/$/, "");
  const prefix = (out.BACKUP_S3_PREFIX || "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (endpoint && out.BACKUP_S3_BUCKET && prefix) {
    out.RESTIC_REPOSITORY = `s3:${endpoint}/${out.BACKUP_S3_BUCKET}/${prefix}`;
    if (out.BACKUP_S3_REGION) out.RESTIC_S3_REGION = out.BACKUP_S3_REGION;
    out.AWS_REGION = out.BACKUP_S3_REGION || "us-east-1";
  }
  cachedEnv = out;
  return out;
}

export function backupsConfigured(): Promise<boolean> {
  return loadBackupEnv().then((e) => Boolean(e.RESTIC_REPOSITORY && e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY && e.RESTIC_PASSWORD_FILE));
}

interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/** Spawn a command + stream output to a string with no shell. */
export function runBin(bin: string, args: string[], env?: Record<string, string | undefined>, timeoutMs = 60000): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { env: env ? { ...process.env, ...env } : process.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* */ }
    }, timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, stdout, stderr: stderr + `\nspawn error: ${err.message}`, exitCode: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, exitCode: code });
    });
  });
}

/** Synchronous variant for fire-and-forget shellouts. */
export function runBinSync(bin: string, args: string[], env?: Record<string, string | undefined>, timeoutMs = 60000): RunResult {
  const r = spawnSync(bin, args, { env: env ? { ...process.env, ...env } : process.env, encoding: "utf8", timeout: timeoutMs });
  return { ok: r.status === 0, stdout: r.stdout || "", stderr: r.stderr || "", exitCode: r.status };
}

/** Strict snapshot-id shape (restic uses 64-char hex or short ids >= 4 chars). */
export const SNAPSHOT_ID_RE = /^[a-f0-9]{4,64}$/;

/** Read-only restic wrapper for listing snapshots / stats. */
export async function resticSnapshots(): Promise<unknown[]> {
  const env = await loadBackupEnv();
  if (!env.RESTIC_REPOSITORY) return [];
  const r = await runBin("restic", ["snapshots", "--json"], env, 15000);
  if (!r.ok) return [];
  try {
    const parsed = JSON.parse(r.stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function resticStats(): Promise<{ total_size?: number; total_file_count?: number }> {
  const env = await loadBackupEnv();
  if (!env.RESTIC_REPOSITORY) return {};
  const r = await runBin("restic", ["stats", "--json"], env, 15000);
  if (!r.ok) return {};
  try {
    return JSON.parse(r.stdout);
  } catch {
    return {};
  }
}

/**
 * Delete a snapshot and prune unreferenced data. Blocking (no service
 * impact — restic locks are per-repo and short-lived here).
 */
export async function resticForgetSnapshot(id: string): Promise<{ ok: boolean; error?: string }> {
  const env = await loadBackupEnv();
  if (!env.RESTIC_REPOSITORY) return { ok: false, error: "not configured" };
  const r = await runBin("restic", ["forget", id, "--prune"], env, 180000);
  if (!r.ok) {
    return { ok: false, error: (r.stderr || r.stdout || `exit ${r.exitCode}`).trim().slice(-600) };
  }
  return { ok: true };
}

/**
 * List file paths inside a snapshot. `restic ls --json` emits one JSON
 * object per line: a leading {"message_type":"snapshot"} summary, then one
 * {"message_type":"node","type":"file"|"dir",...} per filesystem node.
 */
export async function resticListFiles(id: string): Promise<string[]> {
  const env = await loadBackupEnv();
  if (!env.RESTIC_REPOSITORY) return [];
  const r = await runBin("restic", ["ls", id, "--json"], env, 30000);
  if (!r.ok) return [];
  const paths: string[] = [];
  for (const line of r.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const obj = JSON.parse(trimmed) as { message_type?: string; type?: string; path?: string };
      if (obj.message_type === "node" && obj.type === "file" && typeof obj.path === "string") {
        paths.push(obj.path);
      }
    } catch {
      /* skip malformed lines */
    }
  }
  return paths;
}

/** Build the env restic needs (merged backup.env), or null if unconfigured. */
export async function resticEnv(): Promise<Record<string, string> | null> {
  const env = await loadBackupEnv();
  if (!env.RESTIC_REPOSITORY) return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}