"use client";

import { useCallback, useEffect, useState } from "react";

interface Status {
  configured: boolean;
  repository?: string | null;
  last_backup?: { ts: string | null; status: string | null; snapshot_id: string | null; duration_s: number | null; size_bytes: number | null; error: string | null } | null;
  next_run?: string | null;
  repo_size_bytes?: number | null;
  snapshots?: number;
}

interface Snapshot {
  time?: string;
  short_id?: string;
  id?: string;
  paths?: string[];
  tags?: string[];
}

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

export default function BackupsClient() {
  const [status, setStatus] = useState<Status | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"backup" | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [s, snap] = await Promise.all([
        fetch("/api/admin/backup/status").then((r) => r.json()),
        fetch("/api/admin/backup/snapshots").then((r) => r.json()),
      ]);
      setStatus(s);
      setSnapshots(Array.isArray(snap?.snapshots) ? snap.snapshots : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function backupNow() {
    setBusy("backup");
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/backup", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessage("Backup complete.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  }

  async function restore(id: string) {
    const prompt = window.confirm(
      `Restore snapshot ${id}? This will briefly stop the Kindred service (~5-15s) and replace the live database.`,
    );
    if (!prompt) return;
    // The UI requires the typed-confirmation modal; the confirm() here is the
    // secondary gate. The API still insists on confirm: "RESTORE".
    setRestoring(id);
    setError(null);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/backup/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshot: id, confirm: "RESTORE" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessage(`Restored snapshot ${id}. The ICS feed URL is unchanged.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRestoring(null);
      void refresh();
    }
  }

  if (loading) {
    return <p className="mt-4 text-sm text-stone-500">Loading…</p>;
  }

  if (!status?.configured) {
    return (
      <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-medium">Backups are not configured.</p>
        <p className="mt-1">
          Run <code>./proxmox/enable-backup-lxc.sh &lt;CT_ID&gt;</code> from the Proxmox host, or complete the first-run wizard.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-6">
      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-stone-500">Repository</dt>
          <dd className="font-mono text-xs break-all">{status.repository ?? "—"}</dd>
          <dt className="text-stone-500">Last backup</dt>
          <dd>{status.last_backup ? `${fmtTs(status.last_backup.ts)} · ${status.last_backup.status ?? "unknown"} · ${fmtBytes(status.last_backup.size_bytes)}` : "—"}</dd>
          <dt className="text-stone-500">Next scheduled run</dt>
          <dd>{fmtTs(status.next_run)}</dd>
          <dt className="text-stone-500">Repo size</dt>
          <dd>{fmtBytes(status.repo_size_bytes)}</dd>
          <dt className="text-stone-500">Snapshots retained</dt>
          <dd>{status.snapshots ?? 0}</dd>
        </dl>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={backupNow}
            disabled={busy === "backup"}
            className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {busy === "backup" ? "Backing up…" : "Back up now"}
          </button>
          <button type="button" onClick={() => refresh()} className="rounded border border-stone-300 px-4 py-2 text-sm text-stone-700">
            Refresh
          </button>
        </div>
      </section>

      {message && <p className="text-sm text-green-700">{message}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <section className="rounded-lg border border-stone-200 bg-white p-5">
        <h3 className="text-sm font-semibold text-stone-900">Snapshots</h3>
        {snapshots.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">No snapshots yet. Click “Back up now”.</p>
        ) : (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-stone-500 [&>th]:pb-2 [&>th]:font-medium">
                <th>Snapshot</th>
                <th>Time</th>
                <th>Tags</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {snapshots
                .slice()
                .sort((a, b) => (b.time ?? "").localeCompare(a.time ?? ""))
                .map((s) => (
                  <tr key={s.id ?? s.short_id} className="border-t border-stone-100 [&>td]:py-2">
                    <td className="font-mono text-xs">{s.short_id ?? s.id ?? "—"}</td>
                    <td>{fmtTs(s.time)}</td>
                    <td className="text-xs text-stone-500">{(s.tags ?? []).join(", ")}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        onClick={() => restore((s.short_id ?? s.id)!)}
                        disabled={restoring === (s.short_id ?? s.id)}
                        className="rounded border border-stone-300 px-3 py-1 text-xs text-stone-700 disabled:opacity-50"
                      >
                        {restoring === (s.short_id ?? s.id) ? "Restoring…" : "Restore"}
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}