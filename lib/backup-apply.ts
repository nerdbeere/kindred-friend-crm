import { mkdtemp, writeFile, unlink } from "fs/promises";
import { join } from "path";
import { spawnSync } from "child_process";

/**
 * Apply a backup configuration via the privileged sudoers-whitelisted
 * helper. Used by both the first-run wizard (POST /api/setup) and the
 * authenticated "enable backups" admin route (POST /api/admin/backup/enable).
 *
 * The helper is /opt/kindred/scripts/configure-backup-privileged.js and
 * the sudoers rule (installed by setup-lxc.sh) is:
 *   kindred ALL=(root) NOPASSWD: /usr/bin/node /opt/kindred/scripts/configure-backup-privileged.js
 */

const CONFIGURE_HELPER = "/opt/kindred/scripts/configure-backup-privileged.js";

export interface BackupConfigInput {
  endpoint: string;
  bucket: string;
  prefix: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  restic_password: string | null;
}

export interface ApplyResult {
  ok: true;
  repository: string;
  first_backup: "ok" | "failed-check-journal";
}

export interface ApplyError {
  ok: false;
  error: string;
}

export async function applyBackupConfig(input: BackupConfigInput): Promise<ApplyResult | ApplyError> {
  // Normalize
  const cfg: BackupConfigInput = {
    endpoint: input.endpoint,
    bucket: input.bucket,
    prefix: input.prefix,
    region: input.region || "",
    access_key_id: input.access_key_id,
    secret_access_key: input.secret_access_key,
    restic_password: input.restic_password || null,
  };

  let tmpDir: string;
  try {
    tmpDir = await mkdtemp(join("/tmp", "kindred-backup-cfg-"));
  } catch (e) {
    return { ok: false, error: `tmp dir: ${e instanceof Error ? e.message : String(e)}` };
  }
  const cfgFile = join(tmpDir, "config.json");
  try {
    await writeFile(cfgFile, JSON.stringify(cfg), { mode: 0o600 });
  } catch (e) {
    return { ok: false, error: `write cfg: ${e instanceof Error ? e.message : String(e)}` };
  }

  const result = spawnSync("sudo", ["-n", "/usr/bin/node", CONFIGURE_HELPER, cfgFile], {
    encoding: "utf8",
    timeout: 120000,
  });

  // Always clean up the temp file.
  try {
    await unlink(cfgFile);
  } catch {
    /* ignore */
  }

  if (result.error || result.status !== 0) {
    const stderr = (result.stderr || "").trim().slice(0, 400);
    const stdout = (result.stdout || "").trim().slice(0, 400);
    const raw = stderr || stdout || result.error?.message || "unknown";
    // Give actionable guidance for the most common failure: the sudoers
    // rule for the privileged helper isn't installed (e.g. the CT was
    // provisioned before the sudoers.d fix).
    if (/a password is required/i.test(raw) || /no sudoers sources/i.test(raw)) {
      return {
        ok: false,
        error:
          "The sudoers rule for the backup helper isn't installed on this container. " +
          "Fix it by running on the Proxmox host: " +
          "`pct exec <CT_ID> -- bash /opt/kindred/scripts/install-backup-prereqs.sh`, " +
          "then retry.",
      };
    }
    return { ok: false, error: `helper exited ${result.status}: ${raw}` };
  }

  // Helper prints a single JSON line on success: {ok:true, repository, first_backup}
  for (const line of (result.stdout || "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed.ok === true) {
          return { ok: true, repository: parsed.repository, first_backup: parsed.first_backup || "ok" };
        }
        return { ok: false, error: parsed.error || "helper reported failure" };
      } catch {
        // fall through
      }
    }
  }
  return { ok: true, repository: `s3:${cfg.endpoint}/${cfg.bucket}/${cfg.prefix}`, first_backup: "ok" };
}