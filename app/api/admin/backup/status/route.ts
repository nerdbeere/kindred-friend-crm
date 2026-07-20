import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth";
import { loadBackupEnv, resticStats, resticSnapshots, runBinSync } from "@/lib/backup-runner";
import { getJob } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const env = await loadBackupEnv();
  const configured = Boolean(env.RESTIC_REPOSITORY && env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY && env.RESTIC_PASSWORD_FILE);

  if (!configured) {
    return NextResponse.json({
      configured: false,
      last_backup: null,
      last_check: null,
      next_run: null,
      repo_size_bytes: null,
      snapshots: 0,
    });
  }

  // next scheduled run, parsed from `systemctl show kindred-backup.timer -p NextElapseRealtime --value`
  const nextRun = runBinSync("systemctl", ["show", "kindred-backup.timer", "-p", "NextElapseRealtime", "--value"]);
  // last backup start, from the systemd unit's last activation
  const lastBackupActivated = runBinSync("systemctl", ["show", "kindred-backup.service", "-p", "ActiveEnterTimestamp", "--value"]);
  const lastResultState = runBinSync("systemctl", ["show", "kindred-backup.service", "-p", "Result", "--value"]);

  // Try to fetch the last JSON status line from journald
  const lastJournal = runBinSync("journalctl", ["-u", "kindred-backup.service", "-t", "kindred-backup", "-n", "1", "-o", "json", "--no-pager"]);
  let lastBackupJson: { status?: string; snapshot_id?: string; duration_s?: number; size_bytes?: number; repo_size_bytes?: number; ts?: string; error?: string } | null = null;
  for (const line of lastJournal.stdout.split("\n").reverse()) {
    const trimmed = line.trim();
    if (trimmed.startsWith("{")) {
      try {
        const parsed = JSON.parse(trimmed);
        const body = typeof parsed.MESSAGE === "string" ? parsed.MESSAGE : "";
        if (body.trim().startsWith("{")) {
          lastBackupJson = JSON.parse(body);
          break;
        }
      } catch {
        continue;
      }
    }
  }

  let stats: { total_size?: number; total_file_count?: number } = {};
  let snapshots: unknown[] = [];
  try {
    [stats, snapshots] = await Promise.all([resticStats(), resticSnapshots()]);
  } catch {
    // ignore — status endpoint stays useful even if restic is unreachable
  }

  // Background job states let the UI resume polling after a page reload.
  const [backupJob, checkJob, restoreJob] = await Promise.all([getJob("backup"), getJob("check"), getJob("restore")]);

  return NextResponse.json({
    configured: true,
    repository: env.RESTIC_REPOSITORY,
    endpoint: env.BACKUP_S3_ENDPOINT || null,
    bucket: env.BACKUP_S3_BUCKET || null,
    prefix: env.BACKUP_S3_PREFIX || null,
    region: env.BACKUP_S3_REGION || null,
    schedule: "daily 03:00 (10m randomized delay)",
    retention: {
      keep_daily: env.BACKUP_KEEP_DAILY || "7",
      keep_weekly: env.BACKUP_KEEP_WEEKLY || "4",
      keep_monthly: env.BACKUP_KEEP_MONTHLY || "6",
      keep_within_hours: env.BACKUP_KEEP_WITHIN_HOURS || "24",
      check_weekly: env.BACKUP_CHECK_WEEKLY || "1",
    },
    last_backup: lastBackupJson
      ? {
          ts: lastBackupJson.ts || null,
          status: lastBackupJson.status || null,
          snapshot_id: lastBackupJson.snapshot_id || null,
          duration_s: lastBackupJson.duration_s || null,
          size_bytes: lastBackupJson.size_bytes || null,
          error: lastBackupJson.error || null,
        }
      : lastBackupActivated.stdout.trim()
        ? { ts: lastBackupActivated.stdout.trim(), status: lastResultState.stdout.trim() === "success" ? "ok" : "unknown", snapshot_id: null, duration_s: null, size_bytes: null, error: null }
        : null,
    last_check: null, // populated by parsing journalctl for "check" events; left null for now
    next_run: nextRun.stdout.trim() || null,
    repo_size_bytes: stats?.total_size ?? null,
    file_count: stats?.total_file_count ?? null,
    snapshots: Array.isArray(snapshots) ? snapshots.length : 0,
    jobs: {
      backup: backupJob,
      check: checkJob,
      restore: restoreJob,
    },
  });
}