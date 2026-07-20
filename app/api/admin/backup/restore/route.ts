import { NextRequest, NextResponse } from "next/server";
import { spawn } from "child_process";
import { openSync, closeSync, writeFileSync } from "fs";
import { join } from "path";
import { isAuthenticated, isSameOrigin } from "@/lib/auth";
import { loadBackupEnv, resticEnv, SNAPSHOT_ID_RE } from "@/lib/backup-runner";
import { acquireJobLock, getJob, getJobSync, jobPaths, readJobLogTail, releaseJobLock, writeJobState, writeJobStateSync } from "@/lib/backup-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const JOB_NAME = "restore";
const RESTORE_SCRIPT = join(process.cwd(), "scripts", "restore.sh");

/**
 * POST — start a restore as a detached background job.
 *
 * Unlike backup/check, restore.sh CANNOT run under run-job.sh: the real
 * (non-dry-run) path restarts kindred.service, which kills every process
 * in the service cgroup — including the wrapper and this script. So
 * restore.sh self-reports phases into $KINDRED_JOB_FILE (downloading →
 * verifying → swapping → restarting), writing "restarting" just before it
 * issues the restart that kills it.
 *
 * Body: { snapshot: "<id>|latest", confirm: "RESTORE", dry_run?: boolean }
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
  const cleanEnv = (await resticEnv()) || {};

  let body: { snapshot?: string; confirm?: string; dry_run?: boolean };
  try {
    body = (await request.json()) as { snapshot?: string; confirm?: string; dry_run?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const snapshot = (body.snapshot || "latest").trim();
  if (snapshot !== "latest" && !SNAPSHOT_ID_RE.test(snapshot)) {
    return NextResponse.json({ error: "Invalid snapshot id." }, { status: 400 });
  }

  // Real restores are destructive — require the typed confirmation phrase.
  // Dry-runs are read-only and skip it.
  const dryRun = body.dry_run === true;
  if (!dryRun && body.confirm !== "RESTORE") {
    return NextResponse.json(
      { error: "Confirmation required. Re-send with confirm: \"RESTORE\" to proceed." },
      { status: 400 },
    );
  }

  // --- synchronous check + lock + seed (no awaits → atomic per event loop)
  const current = getJobSync(JOB_NAME);
  if (current.state === "running" || current.state === "restarting") {
    return NextResponse.json({ ok: false, error: `a restore is already ${current.state}` }, { status: 409 });
  }
  if (!acquireJobLock(JOB_NAME)) {
    const again = getJobSync(JOB_NAME);
    if (again.state === "running" || again.state === "restarting") {
      return NextResponse.json({ ok: false, error: `a restore is already ${again.state}` }, { status: 409 });
    }
    // Stale lock from a crashed/interrupted run — reclaim it.
    releaseJobLock(JOB_NAME);
    if (!acquireJobLock(JOB_NAME)) {
      return NextResponse.json({ ok: false, error: "restore lock contention — retry" }, { status: 409 });
    }
  }

  // Seed status so the UI sees the job even before restore.sh's first write,
  // and truncate the log (restore.sh appends via its stdout/stderr fd).
  writeJobStateSync(JOB_NAME, {
    state: "running",
    phase: "starting",
    started_at: new Date().toISOString(),
  });
  try {
    writeFileSync(jobPaths.logPath(JOB_NAME), "");
  } catch {
    /* first run — file created by the spawn fd below */
  }

  const args = [RESTORE_SCRIPT, snapshot];
  if (dryRun) args.push("--dry-run");

  let pid: number;
  try {
    const logFd = openSync(jobPaths.logPath(JOB_NAME), "a");
    const child = spawn("bash", args, {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: {
        ...process.env,
        ...cleanEnv,
        KINDRED_JOB_FILE: jobPaths.statusPath(JOB_NAME),
      },
    });
    closeSync(logFd);
    child.unref();
    if (typeof child.pid !== "number") {
      throw new Error("spawn returned no pid");
    }
    pid = child.pid;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await writeJobState(JOB_NAME, { state: "error", error: `spawn failed: ${msg}`, finished_at: new Date().toISOString() });
    releaseJobLock(JOB_NAME);
    return NextResponse.json({ ok: false, error: `spawn failed: ${msg}` }, { status: 500 });
  }

  return NextResponse.json({ ok: true, started: true, pid, dry_run: dryRun }, { status: 202 });
}

/**
 * GET — restore job state + log tail.
 *
 * Restart-flip: a job in state "restarting" means restore.sh issued the
 * service restart (which killed restore.sh itself). The fact that THIS
 * request is being served proves the app booted with the restored DB —
 * restore.sh's own health check is dead along with its cgroup — so we
 * atomically flip the job to ok. If the app had failed to boot, this
 * endpoint wouldn't be reachable at all and the operator would use the
 * documented manual rollback (pre-restore copies on disk).
 */
export async function GET(request: NextRequest) {
  if (!(await isAuthenticated(request))) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  let job = await getJob(JOB_NAME);
  if (job.state === "restarting") {
    job = {
      ...job,
      state: "ok",
      phase: "done",
      finished_at: new Date().toISOString(),
      error: null,
    };
    await writeJobState(JOB_NAME, job);
    releaseJobLock(JOB_NAME);
  }
  const log_tail = await readJobLogTail(JOB_NAME);
  return NextResponse.json({ job, log_tail });
}
