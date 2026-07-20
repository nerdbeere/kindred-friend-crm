"use client";

import { useState } from "react";

/**
 * Inline "enable backups" form shown on /admin/backups when backups aren't
 * configured yet. Posts to /api/admin/backup/enable, which runs the
 * privileged helper (sudoers-whitelisted) to write /etc/kindred/*, init the
 * restic repo, install the systemd timer and kick off the first backup.
 */
export default function EnableBackupsForm({ onEnabled }: { onEnabled: () => void }) {
  const [endpoint, setEndpoint] = useState("");
  const [bucket, setBucket] = useState("");
  const [prefix, setPrefix] = useState("kindred/backups");
  const [region, setRegion] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [generatePassword, setGeneratePassword] = useState(true);
  const [resticPassword, setResticPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    endpoint.startsWith("https://") &&
    bucket.trim().length > 0 &&
    prefix.trim().length > 0 &&
    accessKeyId.trim().length > 0 &&
    secretAccessKey.trim().length > 0 &&
    (generatePassword || resticPassword.length >= 8);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/backup/enable", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: endpoint.trim(),
          bucket: bucket.trim(),
          prefix: prefix.trim(),
          region: region.trim(),
          access_key_id: accessKeyId.trim(),
          secret_access_key: secretAccessKey.trim(),
          restic_password: generatePassword ? null : resticPassword,
        }),
      });
      const data = await res.json().catch(() => ({ error: "Enable failed." }));
      if (!res.ok) throw new Error(data.error || `Enable failed (HTTP ${res.status}).`);
      onEnabled();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  const inputCls =
    "w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none disabled:opacity-50";
  const labelCls = "block text-xs font-medium text-stone-500";

  return (
    <div className="mt-4 rounded-lg border border-stone-200 bg-white p-5">
      <p className="text-sm text-stone-600">
        Backups aren't configured yet. Point Kindred at an S3-compatible bucket — snapshots are
        encrypted client-side (AES-256 via restic) before they leave this container.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelCls}>S3 endpoint (https://…)</label>
          <input className={inputCls} value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={busy} placeholder="https://s3.eu-central-1.amazonaws.com" />
        </div>
        <div>
          <label className={labelCls}>Bucket</label>
          <input className={inputCls} value={bucket} onChange={(e) => setBucket(e.target.value)} disabled={busy} placeholder="kindred-backups" />
        </div>
        <div>
          <label className={labelCls}>Prefix (path inside bucket)</label>
          <input className={inputCls} value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={busy} />
        </div>
        <div>
          <label className={labelCls}>Region (optional)</label>
          <input className={inputCls} value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy} placeholder="eu-central-1" />
        </div>
        <div className="hidden sm:block" />
        <div>
          <label className={labelCls}>Access key ID</label>
          <input className={inputCls} value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} disabled={busy} autoComplete="off" />
        </div>
        <div>
          <label className={labelCls}>Secret access key</label>
          <input className={inputCls} type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} disabled={busy} autoComplete="new-password" />
        </div>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-stone-700">
            <input type="checkbox" checked={generatePassword} onChange={(e) => setGeneratePassword(e.target.checked)} disabled={busy} />
            Generate a restic repository password for me (stored in <code>/etc/kindred/restic.pass</code>)
          </label>
          {!generatePassword && (
            <input
              className={`${inputCls} mt-2`}
              type="password"
              value={resticPassword}
              onChange={(e) => setResticPassword(e.target.value)}
              disabled={busy}
              placeholder="Your restic password (min 8 chars)"
              autoComplete="new-password"
            />
          )}
        </div>
      </div>
      {error && <p className="mt-3 whitespace-pre-wrap text-sm text-red-600">{error}</p>}
      <div className="mt-4">
        <button
          type="button"
          onClick={submit}
          disabled={!valid || busy}
          className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {busy ? "Enabling…" : "Enable backups"}
        </button>
      </div>
    </div>
  );
}
