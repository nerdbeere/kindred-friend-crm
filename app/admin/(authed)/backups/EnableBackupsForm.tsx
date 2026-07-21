"use client";

import { useState } from "react";
import { Button, Card, Field, Input } from "@/app/components/ui";

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

  return (
    <Card className="mt-4">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">Step 1 of 1</p>
      <h2 className="mt-1 text-lg font-bold text-night">Connect encrypted storage</h2>
      <p className="text-sm text-night/65">
        Backups aren't configured yet. Point Kindred at an S3-compatible bucket — snapshots are
        encrypted client-side (AES-256 via restic) before they leave this container.
      </p>
      <p className="mt-2 text-xs leading-5 text-night/50">Create a bucket and credentials with read, write, list, and delete access limited to this backup location. The first backup starts after setup succeeds.</p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="S3 endpoint (https://...)" htmlFor="backup-endpoint" hint="For AWS: https://s3.<region>.amazonaws.com" className="sm:col-span-2">
          <Input id="backup-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={busy} placeholder="https://s3.eu-central-1.amazonaws.com" />
        </Field>
        <Field label="Bucket" htmlFor="backup-bucket">
          <Input id="backup-bucket" value={bucket} onChange={(e) => setBucket(e.target.value)} disabled={busy} placeholder="kindred-backups" />
        </Field>
        <Field label="Folder inside bucket" htmlFor="backup-prefix">
          <Input id="backup-prefix" value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Region (optional)" htmlFor="backup-region" hint="Usually required for AWS.">
          <Input id="backup-region" value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy} placeholder="eu-central-1" />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Access key ID" htmlFor="backup-access-key">
          <Input id="backup-access-key" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} disabled={busy} autoComplete="off" />
        </Field>
        <Field label="Secret access key" htmlFor="backup-secret-key">
          <Input id="backup-secret-key" type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} disabled={busy} autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-2">
          <label htmlFor="generate-restic-password" className="flex items-center gap-2 text-sm text-night/75">
            <input id="generate-restic-password" type="checkbox" checked={generatePassword} onChange={(e) => setGeneratePassword(e.target.checked)} disabled={busy} />
            Generate a restic repository password for me (stored in <code>/etc/kindred/restic.pass</code>)
          </label>
          {!generatePassword && (
            <Input
              className="mt-2"
              id="restic-password"
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
      {error && <p className="mt-3 whitespace-pre-wrap text-sm font-medium text-red-700">{error}</p>}
      <div className="mt-4">
        <Button type="button" onClick={submit} disabled={!valid || busy}>
          {busy ? "Enabling…" : "Enable backups"}
        </Button>
      </div>
    </Card>
  );
}
