"use client";

import { useState } from "react";

type Step = 1 | 2 | 3;

interface BackupForm {
  enabled: boolean;
  endpoint: string;
  bucket: string;
  prefix: string;
  region: string;
  access_key_id: string;
  secret_access_key: string;
  restic_password: string;
  generate_password: boolean;
}

const EMPTY_BACKUP: BackupForm = {
  enabled: false,
  endpoint: "",
  bucket: "",
  prefix: "",
  region: "",
  access_key_id: "",
  secret_access_key: "",
  restic_password: "",
  generate_password: true,
};

function strength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["too short", "weak", "fair", "good", "strong"];
  return { score: Math.min(4, score) as 0 | 1 | 2 | 3 | 4, label: labels[Math.min(4, score)] };
}

export default function SetupWizard() {
  const [step, setStep] = useState<Step>(1);
  const [setupToken, setSetupToken] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [backup, setBackup] = useState<BackupForm>(EMPTY_BACKUP);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwStrength = strength(adminPassword);
  const passwordsMatch = adminPassword === adminPasswordConfirm;
  const pwOk = adminPassword.length >= 12 && passwordsMatch;
  const tokenOk = setupToken.trim().length > 0;
  const step1Ok = pwOk && tokenOk;

  async function submit() {
    if (!pwOk) {
      setError("Password must be at least 12 characters and match the confirmation.");
      setStep(1);
      return;
    }
    if (!tokenOk) {
      setError("Setup token is required — it's printed on the console by the installer.");
      setStep(1);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        setup_token: setupToken.trim(),
        admin_password: adminPassword,
        admin_password_confirm: adminPasswordConfirm,
        backups: {
          enabled: backup.enabled,
          endpoint: backup.endpoint,
          bucket: backup.bucket,
          prefix: backup.prefix,
          region: backup.region,
          access_key_id: backup.access_key_id,
          secret_access_key: backup.secret_access_key,
          restic_password: backup.generate_password || !backup.restic_password ? null : backup.restic_password,
        },
      };
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Setup failed." }));
        throw new Error(data.error || `Setup failed (HTTP ${res.status}).`);
      }
      // Cookie is set server-side; redirect to /admin/backups (or home if backups skipped).
      window.location.href = backup.enabled ? "/admin/backups" : "/admin";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
      <ol className="mb-6 flex items-center gap-2 text-xs text-stone-500">
        <li className={step === 1 ? "font-semibold text-stone-900" : ""}>1 · Admin account</li>
        <span>·</span>
        <li className={step === 2 ? "font-semibold text-stone-900" : ""}>2 · Encrypted backups</li>
        <span>·</span>
        <li className={step === 3 ? "font-semibold text-stone-900" : ""}>3 · Confirm</li>
      </ol>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700">Setup token</label>
            <input
              type="text"
              autoComplete="off"
              spellCheck={false}
              className="mt-1 w-full rounded border border-stone-300 px-3 py-2 font-mono text-sm"
              value={setupToken}
              onChange={(e) => setSetupToken(e.target.value)}
              placeholder="e.g. abc123XYZ…"
              required
            />
            <p className="mt-1 text-xs text-stone-500">
              The installer printed this on the console at the end of provisioning. It's also at{" "}
              <code>/etc/kindred/setup-token</code> inside the CT.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700">Admin password</label>
            <input
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              minLength={12}
              required
            />
            <p className="mt-1 text-xs text-stone-500">
              At least 12 characters. Strength: <span className="font-mono">{pwStrength.label}</span>
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700">Confirm admin password</label>
            <input
              type="password"
              autoComplete="new-password"
              className="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
              value={adminPasswordConfirm}
              onChange={(e) => setAdminPasswordConfirm(e.target.value)}
              minLength={12}
              required
            />
            {adminPasswordConfirm.length > 0 && !passwordsMatch && (
              <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!step1Ok}
              onClick={() => setStep(2)}
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <p className="text-sm text-stone-600">
            Backups are client-side encrypted (<code>restic</code>, AES-256) and pushed to any
            S3-compatible endpoint over HTTPS. You can configure this now or skip and enable later
            from <code>/admin/backups</code>.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={backup.enabled}
              onChange={(e) => setBackup({ ...backup, enabled: e.target.checked })}
            />
            Configure encrypted backups now
          </label>
          {backup.enabled && (
            <div className="space-y-3 rounded border border-stone-200 bg-stone-50 p-3">
              <Field label="S3 endpoint (https://…)" value={backup.endpoint} onChange={(v) => setBackup({ ...backup, endpoint: v })} placeholder="https://s3.us-west-004.backblazeb2.com" />
              <Field label="Bucket" value={backup.bucket} onChange={(v) => setBackup({ ...backup, bucket: v })} placeholder="kindred-backups" />
              <Field label="Prefix" value={backup.prefix} onChange={(v) => setBackup({ ...backup, prefix: v })} placeholder="kindred/kindred-ct120" />
              <Field label="Region (often blank for non-AWS)" value={backup.region} onChange={(v) => setBackup({ ...backup, region: v })} placeholder="" optional />
              <Field label="Access key id" value={backup.access_key_id} onChange={(v) => setBackup({ ...backup, access_key_id: v })} placeholder="" />
              <Field label="Secret access key" value={backup.secret_access_key} onChange={(v) => setBackup({ ...backup, secret_access_key: v })} placeholder="" type="password" />
              <label className="flex items-center gap-2 text-xs text-stone-600">
                <input
                  type="checkbox"
                  checked={backup.generate_password}
                  onChange={(e) => setBackup({ ...backup, generate_password: e.target.checked })}
                />
                Generate the restic repo password for me (recommended)
              </label>
              {!backup.generate_password && (
                <Field label="Restic repo password" value={backup.restic_password} onChange={(v) => setBackup({ ...backup, restic_password: v })} placeholder="" type="password" />
              )}
            </div>
          )}
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(1)} className="rounded px-4 py-2 text-sm text-stone-600">
              Back
            </button>
            <button
              type="button"
              onClick={() => {
                if (backup.enabled) {
                  const required = [backup.endpoint, backup.bucket, backup.prefix, backup.access_key_id, backup.secret_access_key];
                  if (required.some((v) => !v) || !backup.endpoint.startsWith("https://")) {
                    setError("Fill in all required backup fields. Endpoint must be https://.");
                    return;
                  }
                }
                setError(null);
                setStep(3);
              }}
              className={backup.enabled ? "rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white" : "rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white"}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="rounded border border-stone-200 bg-stone-50 p-3 text-sm">
            <p className="font-medium">Admin account</p>
            <p className="text-stone-600">12-character password, argon2id-hashed.</p>
          </div>
          <div className="rounded border border-stone-200 bg-stone-50 p-3 text-sm">
            <p className="font-medium">Encrypted backups</p>
            {backup.enabled ? (
              <p className="text-stone-600">
                {backup.endpoint}/{backup.bucket}/{backup.prefix}
                {backup.generate_password ? " · restic password auto-generated (stored in /etc/kindred/restic.pass)." : " · using your restic password."}
              </p>
            ) : (
              <p className="text-stone-600">Skipped — enable later from /admin/backups.</p>
            )}
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-between">
            <button type="button" onClick={() => setStep(2)} className="rounded px-4 py-2 text-sm text-stone-600" disabled={submitting}>
              Back
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting}
              className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting ? "Setting up…" : "Finish setup"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  type?: string;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-stone-700">
        {label} {optional && <span className="text-stone-400">(optional)</span>}
      </label>
      <input
        type={type}
        className="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
    </div>
  );
}