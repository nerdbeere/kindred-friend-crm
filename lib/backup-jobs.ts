import { spawn } from "child_process";
import { mkdir, readFile, writeFile, open, rename } from "fs/promises";
import { readFileSync, existsSync, statSync, mkdirSync, rmdirSync, writeFileSync, renameSync } from "fs";
import { join } from "path";

/**
 * Named background jobs (backup / check / restore) with file-based state
 * the admin API can poll. Jobs run detached via scripts/run-job.sh, so a
 * long backup doesn't hold an HTTP request open, and the UI can reconnect
 * and resume polling after a page reload (or app restart — the main
 * kindred.service has no PrivateTmp, so /tmp survives).
 *
 * Layout: $KINDRED_JOB_DIR/<name>.{json,log,lock}  (default /tmp/kindred-jobs)
 *
 * Security: job names are validated ^[a-z0-9-]+$ and only ever come from
 * server-side constants; argv arrays are passed without shell interpolation.
 */

const JOB_DIR = process.env.KINDRED_JOB_DIR || "/tmp/kindred-jobs";
const RUN_JOB_SCRIPT = join(process.cwd(), "scripts", "run-job.sh");

export const JOB_NAME_RE = /^[a-z0-9-]+$/;

export type JobStateName = "idle" | "running" | "restarting" | "ok" | "error";

export interface JobState {
  state: JobStateName;
  pid: number | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error: string | null;
  /** Optional progress phase written by the command itself (restore.sh). */
  phase?: string | null;
  /** True when state was synthesized because the recorded pid is gone. */
  interrupted?: boolean;
}

const IDLE: JobState = {
  state: "idle",
  pid: null,
  started_at: null,
  finished_at: null,
  exit_code: null,
  error: null,
};

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means the process exists but isn't ours — treat as alive.
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

function statusPath(name: string): string {
  return join(JOB_DIR, `${name}.json`);
}

function logPath(name: string): string {
  return join(JOB_DIR, `${name}.log`);
}

function lockPath(name: string): string {
  return join(JOB_DIR, `${name}.lock`);
}

/**
 * Atomic cross-process "job is starting" gate. mkdir is atomic on POSIX:
 * the first caller wins, concurrent callers get false. Because Node's route
 * handlers interleave at await points, the lock — not the status file — is
 * the authoritative double-start guard.
 */
export function acquireJobLock(name: string): boolean {
  if (!JOB_NAME_RE.test(name)) return false;
  try {
    mkdirSync(JOB_DIR, { recursive: true, mode: 0o700 });
    mkdirSync(lockPath(name));
    return true;
  } catch {
    return false;
  }
}

export function releaseJobLock(name: string): void {
  try {
    rmdirSync(lockPath(name));
  } catch {
    /* missing or non-empty — harmless */
  }
}

/** Read + normalize the job state, detecting dead-pid "running" states. */
export async function getJob(name: string): Promise<JobState> {
  if (!JOB_NAME_RE.test(name)) return IDLE;
  let raw: string;
  try {
    raw = await readFile(statusPath(name), "utf8");
  } catch {
    return IDLE;
  }
  let parsed: Partial<JobState>;
  try {
    parsed = JSON.parse(raw) as Partial<JobState>;
  } catch {
    return IDLE;
  }
  const job: JobState = {
    state: (parsed.state as JobStateName) || "idle",
    pid: typeof parsed.pid === "number" ? parsed.pid : null,
    started_at: parsed.started_at ?? null,
    finished_at: parsed.finished_at ?? null,
    exit_code: typeof parsed.exit_code === "number" ? parsed.exit_code : null,
    error: parsed.error ?? null,
    phase: parsed.phase ?? null,
  };

  // A "restarting" restore is EXPECTED to have a dead pid (the service
  // restart killed it) — leave it alone unless it's been stuck >15 min.
  if (job.state === "restarting") {
    try {
      const ageMs = Date.now() - statSync(statusPath(name)).mtimeMs;
      if (ageMs > 15 * 60 * 1000) {
        return { ...job, state: "error", error: "restart timed out — check service status manually", interrupted: true };
      }
    } catch {
      /* keep */
    }
    return job;
  }

  if (job.state === "running") {
    if (job.pid && !pidAlive(job.pid)) {
      return {
        ...job,
        state: "error",
        error: "job process disappeared (killed or server restarted)",
        interrupted: true,
      };
    }
    // Staleness guard: a "running" job older than 6h can't be trusted.
    if (job.started_at) {
      const ageMs = Date.now() - new Date(job.started_at).getTime();
      if (Number.isFinite(ageMs) && ageMs > 6 * 60 * 60 * 1000) {
        return { ...job, state: "error", error: "job timed out (stale status file)", interrupted: true };
      }
    }
  }
  return job;
}

/** Synchronous variant for use in route handlers that already validated. */
export function getJobSync(name: string): JobState {
  if (!JOB_NAME_RE.test(name)) return IDLE;
  try {
    const raw = readFileSync(statusPath(name), "utf8");
    const parsed = JSON.parse(raw) as Partial<JobState>;
    const job: JobState = {
      state: (parsed.state as JobStateName) || "idle",
      pid: typeof parsed.pid === "number" ? parsed.pid : null,
      started_at: parsed.started_at ?? null,
      finished_at: parsed.finished_at ?? null,
      exit_code: typeof parsed.exit_code === "number" ? parsed.exit_code : null,
      error: parsed.error ?? null,
      phase: parsed.phase ?? null,
    };
    if (job.state === "restarting") {
      try {
        if (Date.now() - statSync(statusPath(name)).mtimeMs > 15 * 60 * 1000) {
          return { ...job, state: "error", error: "restart timed out — check service status manually", interrupted: true };
        }
      } catch {
        /* keep */
      }
      return job;
    }
    if (job.state === "running" && job.pid && !pidAlive(job.pid)) {
      return { ...job, state: "error", error: "job process disappeared (killed or server restarted)", interrupted: true };
    }
    return job;
  } catch {
    return IDLE;
  }
}

/** Last `maxBytes` of the job log (default 8 KiB), UTF-8, lossy-tolerant. */
export async function readJobLogTail(name: string, maxBytes = 8192): Promise<string> {
  if (!JOB_NAME_RE.test(name)) return "";
  try {
    const fh = await open(logPath(name), "r");
    try {
      const { size } = await fh.stat();
      const start = Math.max(0, size - maxBytes);
      const len = size - start;
      if (len <= 0) return "";
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, start);
      let text = buf.toString("utf8");
      // Drop a possibly-partial first line when we sliced mid-file.
      if (start > 0) {
        const nl = text.indexOf("\n");
        if (nl >= 0) text = text.slice(nl + 1);
      }
      return text;
    } finally {
      await fh.close();
    }
  } catch {
    return "";
  }
}

/**
 * Start a named job. Returns {started:true} or {started:false, reason}.
 * The child is spawned detached + unref'd so the HTTP request can return
 * immediately and the job survives the route handler.
 *
 * Double-start safety — ATOMICITY INVARIANT: the check → lock → seed →
 * spawn sequence below contains NO awaits (Node executes synchronous code
 * atomically on the event loop), so two concurrent requests can never both
 * pass. A second request always sees either the mkdir lock or the seeded
 * "running" status and gets 409. Stale locks (crashed job) are reclaimed
 * only when the status file confirms a non-active state. run-job.sh is
 * told the lock is pre-held (KINDRED_JOB_LOCK_PREHELD=1) and releases it
 * on exit.
 */
export async function startJob(
  name: string,
  argv: string[],
  env?: Record<string, string | undefined>,
): Promise<{ started: true; pid: number } | { started: false; reason: string }> {
  if (!JOB_NAME_RE.test(name)) return { started: false, reason: "invalid job name" };
  if (argv.length === 0) return { started: false, reason: "no command" };

  // === synchronous critical section (no awaits!) ==========================
  const current = getJobSync(name);
  if (current.state === "running" || current.state === "restarting") {
    return { started: false, reason: `job '${name}' is already ${current.state}` };
  }
  if (!acquireJobLock(name)) {
    // Lock held: either a concurrent start (its seeded status will say
    // running — re-check) or a stale leftover from a crashed job.
    const again = getJobSync(name);
    if (again.state === "running" || again.state === "restarting") {
      return { started: false, reason: `job '${name}' is already ${again.state}` };
    }
    releaseJobLock(name);
    if (!acquireJobLock(name)) {
      return { started: false, reason: `job '${name}' lock contention — retry` };
    }
  }

  if (!existsSync(RUN_JOB_SCRIPT)) {
    releaseJobLock(name);
    return { started: false, reason: `missing ${RUN_JOB_SCRIPT}` };
  }

  // Seed "running" BEFORE spawn so any request handled after this
  // synchronous block sees the job as active. run-job.sh overwrites the
  // seed with its own pid once it starts.
  writeJobStateSync(name, { state: "running", started_at: new Date().toISOString() });

  try {
    const cleanEnv: Record<string, string> = {};
    if (env) {
      for (const [k, v] of Object.entries(env)) {
        if (typeof v === "string") cleanEnv[k] = v;
      }
    }
    const child = spawn("bash", [RUN_JOB_SCRIPT, name, "--", ...argv], {
      detached: true,
      stdio: "ignore",
      env: { ...process.env, ...cleanEnv, KINDRED_JOB_LOCK_PREHELD: "1" },
    });
    child.unref();
    if (typeof child.pid !== "number") {
      writeJobStateSync(name, { state: "error", error: "spawn returned no pid", finished_at: new Date().toISOString() });
      releaseJobLock(name);
      return { started: false, reason: "spawn returned no pid" };
    }
    return { started: true, pid: child.pid };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    writeJobStateSync(name, { state: "error", error: `spawn failed: ${msg}`, finished_at: new Date().toISOString() });
    releaseJobLock(name);
    return { started: false, reason: msg };
  }
  // === end critical section ===============================================
}

/**
 * Write (overwrite) a job's status file directly. Used by the restore route
 * to seed state before handing off to restore.sh, which then updates the
 * file itself through its restart-surviving phases.
 */
export async function writeJobState(name: string, state: Partial<JobState> & { state: JobStateName }): Promise<void> {
  if (!JOB_NAME_RE.test(name)) return;
  await mkdir(JOB_DIR, { recursive: true, mode: 0o700 });
  const full: JobState = {
    pid: null,
    started_at: null,
    finished_at: null,
    exit_code: null,
    error: null,
    ...state,
  };
  const tmp = `${statusPath(name)}.tmp.${process.pid}`;
  await writeFile(tmp, JSON.stringify(full) + "\n", { mode: 0o600 });
  await rename(tmp, statusPath(name));
}

/** Synchronous variant of writeJobState. */
export function writeJobStateSync(name: string, state: Partial<JobState> & { state: JobStateName }): void {
  if (!JOB_NAME_RE.test(name)) return;
  mkdirSync(JOB_DIR, { recursive: true, mode: 0o700 });
  const full: JobState = {
    pid: null,
    started_at: null,
    finished_at: null,
    exit_code: null,
    error: null,
    ...state,
  };
  const tmp = `${statusPath(name)}.tmp.${process.pid}`;
  writeFileSync(tmp, JSON.stringify(full) + "\n", { mode: 0o600 });
  renameSync(tmp, statusPath(name));
}

export const jobPaths = { dir: JOB_DIR, statusPath, logPath };