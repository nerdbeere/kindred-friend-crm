import { NextRequest, NextResponse } from "next/server";
import { isAuthenticated, isSameOrigin } from "@/lib/auth";
import { loadBackupEnv } from "@/lib/backup-runner";
import { getJob, readJobLogTail, startJob } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_NAME = "check";

/**
 * POST — start `restic check --read-data-subset=5%` as a background job.
 * Read-only: verifies repository structure + samples 5% of pack data.
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

  const result = await startJob(JOB_NAME, ["restic", "check", "--read-data-subset=5%"], env);
  if (!result.started) {
    const status = result.reason.includes("already") ? 409 : 500;
    return NextResponse.json({ ok: false, error: result.reason }, { status });
  }
  return NextResponse.json({ ok: true, started: true, pid: result.pid }, { status: 202 });
}

/** GET — current check job state + log tail. */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  const job = await getJob(JOB_NAME);
  const log_tail = await readJobLogTail(JOB_NAME);
  return NextResponse.json({ job, log_tail });
}
