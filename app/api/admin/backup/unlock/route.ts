import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, isSameOrigin } from "@/lib/auth";
import { loadBackupEnv, resticUnlock } from "@/lib/backup-runner";
import { getJob } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/backup/unlock — run `restic unlock` to clear a stale
 * repository lock (left behind by a killed/timed-out job, a server
 * restart mid-operation, or a manual restic run that never finished).
 *
 * Refuses while any of OUR tracked jobs (backup/check/restore) are
 * active — restic unlock does not check whether the lock's owner is
 * actually still running, so removing it mid-operation can corrupt that
 * operation. We can only verify our own jobs; a lock held by something
 * else entirely (e.g. a concurrent manual `restic` run on the box) is not
 * detectable here — the confirmation modal says so.
 */
export async function POST(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
  }

  const env = await loadBackupEnv();
  if (!env.RESTIC_REPOSITORY) {
    return NextResponse.json({ error: "Backups are not configured." }, { status: 409 });
  }

  const [backupJob, checkJob, restoreJob] = await Promise.all([getJob("backup"), getJob("check"), getJob("restore")]);
  const jobs: Array<{ name: string; state: string }> = [
    { name: "backup", state: backupJob.state },
    { name: "check", state: checkJob.state },
    { name: "restore", state: restoreJob.state },
  ];
  const active = jobs.filter((j) => j.state === "running" || j.state === "restarting");
  if (active.length > 0) {
    return NextResponse.json(
      { error: `Refusing to unlock — ${active.map((j) => j.name).join(", ")} job is still ${active[0].state}. Wait for it to finish first.` },
      { status: 409 },
    );
  }

  const result = await resticUnlock();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error || "unlock failed", output: result.output }, { status: 500 });
  }
  return NextResponse.json({ ok: true, output: result.output });
}
