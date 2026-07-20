"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmModal from "./ConfirmModal";
import EnableBackupsForm from "./EnableBackupsForm";

/* ------------------------------------------------------------------ types */

interface JobState {
  state: "idle" | "running" | "restarting" | "ok" | "error";
  pid: number | null;
  started_at: string | null;
  finished_at: string | null;
  exit_code: number | null;
  error: string | null;
  phase?: string | null;
  interrupted?: boolean;
}

interface Status {
  configured: boolean;
  repository?: string | null;
  endpoint?: string | null;
  bucket?: string | null;
  prefix?: string | null;
  region?: string | null;
  schedule?: string;
  retention?: { keep_daily: string; keep_weekly: string; keep_monthly: string; check_weekly: string };
  last_backup?: { ts: string | null; status: string | null; snapshot_id: string | null; duration_s: number | null; size_bytes: number | null; error: string | null } | null;
  next_run?: string | null;
  repo_size_bytes?: number | null;
  file_count?: number | null;
  snapshots?: number;
  jobs?: { backup: JobState; check: JobState; restore: JobState };
}

interface Snapshot {
  time?: string;
  short_id?: string;
  id?: string;
  paths?: string[];
  tags?: string[];
  hostname?: string;
}

type JobKind = "backup" | "check" | "restore";

const JOB_ENDPOINT: Record<JobKind, string> = {
  backup: "/api/admin/backup",
  check: "/api/admin/backup/check",
  restore: "/api/admin/backup/restore",
};

const IDLE_JOB: JobState = { state: "idle", pid: null, started_at: null, finished_at: null, exit_code: null, error: null };

/* ---------------------------------------------------------------- helpers */

function fmtBytes(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MiB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GiB`;
}

function fmtTs(ts: string | null | undefined): string {
  if (!ts) return "—";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

function timeAgo(ts: string | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts).getTime();
  if (!Number.isFinite(d)) return "";
  const s = Math.max(0, Math.floor((Date.now() - d) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function isActive(job: JobState | undefined | null): boolean {
  return job?.state === "running" || job?.state === "restarting";
}

/** Active, or finished within the last 10 minutes — worth showing in the UI. */
function isRelevant(job: JobState | undefined | null): boolean {
  if (!job || job.state === "idle") return false;
  if (isActive(job)) return true;
  const ts = job.finished_at ?? job.started_at;
  if (!ts) return false;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) && Date.now() - t < 10 * 60 * 1000;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const s = status || "unknown";
  const cls =
    s === "ok"
      ? "bg-green-100 text-green-800"
      : s === "error" || s === "failed"
        ? "bg-red-100 text-red-800"
        : s === "warn"
          ? "bg-amber-100 text-amber-800"
          : "bg-stone-100 text-stone-700";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{s}</span>;
}

function JobBadge({ job }: { job: JobState }) {
  if (job.state === "running") {
    return <span className="inline-block animate-pulse rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">running{job.phase ? ` · ${job.phase}` : ""}</span>;
  }
  if (job.state === "restarting") {
    return <span className="inline-block animate-pulse rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">service restarting…</span>;
  }
  return <StatusBadge status={job.state === "idle" ? null : job.state} />;
}

/* ------------------------------------------------------------------ main */

export default function BackupsClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Record<JobKind, JobState>>({ backup: IDLE_JOB, check: IDLE_JOB, restore: IDLE_JOB });
  const [logs, setLogs] = useState<Record<JobKind, string>>({ backup: "", check: "", restore: "" });
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const logRefs = useRef<Record<JobKind, HTMLPreElement | null>>({ backup: null, check: null, restore: null });

  /* ---------------------------------------------------------- data load */

  const refresh = useCallback(async () => {
    try {
      const [s, snap] = await Promise.all([
        fetch("/api/admin/backup/status").then((r) => r.json()),
        fetch("/api/admin/backup/snapshots").then((r) => r.json()),
      ]);
      setStatus(s);
      setSnapshots(Array.isArray(snap?.snapshots) ? snap.snapshots : []);
      if (s?.jobs) {
        setJobs((prev) => ({
          backup: isActive(prev.backup) ? prev.backup : (s.jobs.backup ?? IDLE_JOB),
          check: isActive(prev.check) ? prev.check : (s.jobs.check ?? IDLE_JOB),
          restore: isActive(prev.restore) ? prev.restore : (s.jobs.restore ?? IDLE_JOB),
        }));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* --------------------------------------------------------- job polling */

  const anyActive = isActive(jobs.backup) || isActive(jobs.check) || isActive(jobs.restore);

  useEffect(() => {
    if (!anyActive) return;
    let cancelled = false;

    const tick = async () => {
      for (const kind of ["backup", "check", "restore"] as JobKind[]) {
        const current = jobs[kind];
        if (!isActive(current)) continue;
        try {
          const res = await fetch(JOB_ENDPOINT[kind]);
          if (!res.ok) continue; // e.g. mid-restart 502 — keep polling
          const data = await res.json();
          if (cancelled) return;
          const job: JobState = data.job ?? IDLE_JOB;
          setJobs((prev) => ({ ...prev, [kind]: job }));
          if (typeof data.log_tail === "string") {
            setLogs((prev) => ({ ...prev, [kind]: data.log_tail }));
          }
          if (!isActive(job)) {
            // Terminal state reached — refresh the page data.
            if (kind === "restore" && job.state === "ok") {
              setMessage("Restore complete — the service restarted with the restored database. The ICS feed URL is unchanged.");
            } else if (kind === "backup" && job.state === "ok") {
              setMessage("Backup complete.");
            } else if (job.state === "error") {
              setError(`${kind} failed: ${job.error || "unknown error"}`);
            }
            void refresh();
          }
        } catch {
          // Network error — expected while the service restarts during a
          // restore. Keep polling; the interval stays alive.
        }
      }
    };

    const id = setInterval(() => void tick(), 2000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyActive, jobs.backup.state, jobs.check.state, jobs.restore.state]);

  // Auto-scroll job logs to the bottom as they grow.
  useEffect(() => {
    for (const kind of ["backup", "check", "restore"] as JobKind[]) {
      const el = logRefs.current[kind];
      if (el) el.scrollTop = el.scrollHeight;
    }
  }, [logs]);

  /* ------------------------------------------------------------- actions */

  async function startSimpleJob(kind: "backup" | "check") {
    setError(null);
    setMessage(null);
    setLogs((prev) => ({ ...prev, [kind]: "" }));
    setJobs((prev) => ({ ...prev, [kind]: { ...IDLE_JOB, state: "running", started_at: new Date().toISOString() } }));
    try {
      const res = await fetch(JOB_ENDPOINT[kind], { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setJobs((prev) => ({ ...prev, [kind]: { ...IDLE_JOB, state: "error", error: data.error || `HTTP ${res.status}` } }));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function startRestore(snapshot: string, dryRun: boolean) {
    setModalBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(JOB_ENDPOINT.restore, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dryRun ? { snapshot, dry_run: true } : { snapshot, confirm: "RESTORE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRestoreTarget(null);
      setLogs((prev) => ({ ...prev, restore: "" }));
      setJobs((prev) => ({ ...prev, restore: { ...IDLE_JOB, state: "running", phase: dryRun ? "dry-run" : "starting", started_at: new Date().toISOString() } }));
      if (dryRun) setMessage("Dry-run started — the service keeps running.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModalBusy(false);
    }
  }

  async function deleteSnapshot(snapshot: string) {
    setModalBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch(JOB_ENDPOINT.backup + "/snapshots", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot, confirm: "DELETE" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setDeleteTarget(null);
      setMessage(`Snapshot ${snapshot.slice(0, 8)} deleted and pruned.`);
      void refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setModalBusy(false);
    }
  }

  /* -------------------------------------------------------------- render */

  if (loading) {
    return <p className="mt-4 text-sm text-stone-500">Loading…</p>;
  }

  if (!status?.configured) {
    return <EnableBackupsForm onEnabled={() => void refresh()} />;
  }

  const lb = status.last_backup;
  const sorted = snapshots.slice().sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""));

  return (
    <div className="mt-4 space-y-6">
      {/* ---------------------------------------------------- status cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Repository</h3>
          <p className="mt-2 break-all font-mono text-xs text-stone-800">{status.repository ?? "—"}</p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">Schedule</dt><dd>{status.schedule ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Next run</dt><dd title={fmtTs(status.next_run)}>{fmtTs(status.next_run)}</dd></div>
            <div className="flex justify-between">
              <dt className="text-stone-500">Retention</dt>
              <dd>{status.retention ? `${status.retention.keep_daily}d / ${status.retention.keep_weekly}w / ${status.retention.keep_monthly}m` : "—"}</dd>
            </div>
          </dl>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Last backup</h3>
          {lb ? (
            <>
              <p className="mt-2"><StatusBadge status={lb.status} /> <span className="ml-1 text-sm text-stone-600">{timeAgo(lb.ts)}</span></p>
              <dl className="mt-2 space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-stone-500">Time</dt><dd>{fmtTs(lb.ts)}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">Duration</dt><dd>{lb.duration_s != null ? `${lb.duration_s}s` : "—"}</dd></div>
                <div className="flex justify-between"><dt className="text-stone-500">DB size</dt><dd>{fmtBytes(lb.size_bytes)}</dd></div>
                {lb.snapshot_id && (
                  <div className="flex justify-between"><dt className="text-stone-500">Snapshot</dt><dd className="font-mono text-xs">{lb.snapshot_id.slice(0, 8)}</dd></div>
                )}
              </dl>
              {lb.error && <p className="mt-2 text-xs text-red-600">{lb.error}</p>}
            </>
          ) : (
            <p className="mt-2 text-sm text-stone-500">No backup has run yet.</p>
          )}
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Storage</h3>
          <dl className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><dt className="text-stone-500">Repository size</dt><dd>{fmtBytes(status.repo_size_bytes)}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Files backed up</dt><dd>{status.file_count ?? "—"}</dd></div>
            <div className="flex justify-between"><dt className="text-stone-500">Snapshots kept</dt><dd>{status.snapshots ?? 0}</dd></div>
          </dl>
        </section>
      </div>

      {/* -------------------------------------------------------- actions */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => startSimpleJob("backup")}
          disabled={isActive(jobs.backup)}
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {isActive(jobs.backup) ? "Backing up…" : "Back up now"}
        </button>
        <button
          type="button"
          onClick={() => startSimpleJob("check")}
          disabled={isActive(jobs.check)}
          className="rounded border border-stone-300 px-4 py-2 text-sm text-stone-700 disabled:opacity-50"
        >
          {isActive(jobs.check) ? "Checking…" : "Check integrity"}
        </button>
        <button type="button" onClick={() => void refresh()} className="rounded border border-stone-300 px-4 py-2 text-sm text-stone-700">
          Refresh
        </button>
        {isRelevant(jobs.backup) && !isActive(jobs.backup) && <JobBadge job={jobs.backup} />}
        {isRelevant(jobs.check) && !isActive(jobs.check) && <JobBadge job={jobs.check} />}
      </div>

      {message && <p className="rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">{message}</p>}
      {error && <p className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      {/* ------------------------------------------------- restore banner */}
      {isRelevant(jobs.restore) && (
        <section className={`rounded-lg border p-4 ${jobs.restore.state === "error" ? "border-red-200 bg-red-50" : isActive(jobs.restore) ? "border-amber-200 bg-amber-50" : "border-green-200 bg-green-50"}`}>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-900">Restore</h3>
            <JobBadge job={jobs.restore} />
          </div>
          {jobs.restore.state === "restarting" && (
            <p className="mt-1 text-sm text-stone-600">
              The database has been swapped and the service is restarting — this page may fail to load for a few seconds. It will recover on its own.
            </p>
          )}
          {jobs.restore.error && <p className="mt-1 text-sm text-red-700">{jobs.restore.error}</p>}
          {logs.restore && (
            <pre
              ref={(el) => { logRefs.current.restore = el; }}
              className="mt-2 max-h-48 overflow-auto rounded bg-stone-900 p-3 font-mono text-xs text-stone-100"
            >
              {logs.restore}
            </pre>
          )}
        </section>
      )}

      {/* ------------------------------------------------- backup log tail */}
      {isRelevant(jobs.backup) && (isActive(jobs.backup) || logs.backup) && (
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-900">Backup log</h3>
            <JobBadge job={jobs.backup} />
          </div>
          <pre
            ref={(el) => { logRefs.current.backup = el; }}
            className="mt-2 max-h-56 overflow-auto rounded bg-stone-900 p-3 font-mono text-xs text-stone-100"
          >
            {logs.backup || "Starting…"}
          </pre>
        </section>
      )}

      {/* -------------------------------------------------- check log tail */}
      {isRelevant(jobs.check) && (isActive(jobs.check) || logs.check) && (
        <section className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-stone-900">Integrity check log</h3>
            <JobBadge job={jobs.check} />
          </div>
          <pre
            ref={(el) => { logRefs.current.check = el; }}
            className="mt-2 max-h-56 overflow-auto rounded bg-stone-900 p-3 font-mono text-xs text-stone-100"
          >
            {logs.check || "Starting…"}
          </pre>
        </section>
      )}

      {/* -------------------------------------------------------- snapshots */}
      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-stone-900">Snapshots</h3>
        {sorted.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">No snapshots yet. Click “Back up now”.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-stone-500 [&>th]:pb-2 [&>th]:font-medium">
                  <th>Snapshot</th>
                  <th>Time</th>
                  <th>Host</th>
                  <th>Tags</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s) => {
                  const sid = s.short_id ?? s.id ?? "";
                  return (
                    <tr key={s.id ?? sid} className="border-t border-stone-100 [&>td]:py-2">
                      <td className="font-mono text-xs">{sid || "—"}</td>
                      <td>
                        {fmtTs(s.time)} <span className="text-xs text-stone-400">{timeAgo(s.time)}</span>
                      </td>
                      <td className="text-xs text-stone-500">{s.hostname ?? "—"}</td>
                      <td className="text-xs text-stone-500">{(s.tags ?? []).join(", ")}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            type="button"
                            onClick={() => setRestoreTarget(sid)}
                            disabled={isActive(jobs.restore)}
                            className="rounded border border-stone-300 px-3 py-1 text-xs text-stone-700 disabled:opacity-50"
                          >
                            Restore…
                          </button>
                          <a
                            href={`/api/admin/backup/download?snapshot=${encodeURIComponent(sid)}`}
                            className="rounded border border-stone-300 px-3 py-1 text-xs text-stone-700"
                          >
                            Download
                          </a>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(sid)}
                            className="rounded border border-red-200 px-3 py-1 text-xs text-red-700"
                          >
                            Delete…
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-stone-400">
          Download fetches and decrypts the snapshot's database on the server and sends it to your browser — nothing on the server changes.
        </p>
      </section>

      {/* ----------------------------------------------------------- modals */}
      {restoreTarget && (
        <ConfirmModal
          title={`Restore snapshot ${restoreTarget.slice(0, 8)}?`}
          phrase="RESTORE"
          confirmLabel="Restore now"
          busy={modalBusy}
          onConfirm={() => void startRestore(restoreTarget, false)}
          onCancel={() => setRestoreTarget(null)}
        >
          <p>
            The live database will be replaced with this snapshot and the service restarts (~5–15s downtime).
            Your current database is kept on disk as a <code>.pre-restore</code> copy, and the ICS feed URL stays the same.
          </p>
          <button
            type="button"
            onClick={() => void startRestore(restoreTarget, true)}
            disabled={modalBusy}
            className="mt-3 text-xs font-medium text-stone-700 underline"
          >
            Run a dry-run first (no downtime, nothing is replaced)
          </button>
        </ConfirmModal>
      )}

      {deleteTarget && (
        <ConfirmModal
          title={`Delete snapshot ${deleteTarget.slice(0, 8)}?`}
          phrase="DELETE"
          confirmLabel="Delete forever"
          busy={modalBusy}
          onConfirm={() => void deleteSnapshot(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        >
          <p>
            The snapshot is removed and its unreferenced data pruned from the repository. This cannot be undone.
            Other snapshots are not affected.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
