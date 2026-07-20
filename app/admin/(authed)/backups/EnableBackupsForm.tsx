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
      <p className="text-sm text-night/65">
        Backups aren't configured yet. Point Kindred at an S3-compatible bucket — snapshots are
        encrypted client-side (AES-256 via restic) before they leave this container.
      </p>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="S3 endpoint (https://…)" className="sm:col-span-2">
          <Input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} disabled={busy} placeholder="https://s3.eu-central-1.amazonaws.com" />
        </Field>
        <Field label="Bucket">
          <Input value={bucket} onChange={(e) => setBucket(e.target.value)} disabled={busy} placeholder="kindred-backups" />
        </Field>
        <Field label="Prefix (path inside bucket)">
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} disabled={busy} />
        </Field>
        <Field label="Region (optional)">
          <Input value={region} onChange={(e) => setRegion(e.target.value)} disabled={busy} placeholder="eu-central-1" />
        </Field>
        <div className="hidden sm:block" />
        <Field label="Access key ID">
          <Input value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} disabled={busy} autoComplete="off" />
        </Field>
        <Field label="Secret access key">
          <Input type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} disabled={busy} autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-2">
          <label className="flex items-center gap-2 text-sm text-night/75">
            <input type="checkbox" checked={generatePassword} onChange={(e) => setGeneratePassword(e.target.checked)} disabled={busy} />
            Generate a restic repository password for me (stored in <code>/etc/kindred/restic.pass</code>)
          </label>
          {!generatePassword && (
            <Input
              className="mt-2"
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
