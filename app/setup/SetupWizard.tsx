"use client";

import { useState } from "react";

function strength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  let score = 0;
  if (pw.length >= 12) score++;
  if (pw.length >= 16) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["too short", "weak", "fair", "good", "strong"];
  return { score: Math.min(4, score) as 0 | 1 | 2 | 3 | 4, label: labels[Math.min(4, score)] };
}

/**
 * First-run setup: one page — setup token + admin password. Encrypted
 * backups are configured afterwards from /admin/backups.
 */
export default function SetupWizard() {
  const [setupToken, setSetupToken] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [adminPasswordConfirm, setAdminPasswordConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pwStrength = strength(adminPassword);
  const passwordsMatch = adminPassword === adminPasswordConfirm;
  const pwOk = adminPassword.length >= 12 && passwordsMatch;
  const tokenOk = setupToken.trim().length > 0;
  const formOk = pwOk && tokenOk;

  async function submit() {
    if (!formOk) {
      setError("Enter the setup token and a matching 12+ character password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          setup_token: setupToken.trim(),
          admin_password: adminPassword,
          admin_password_confirm: adminPasswordConfirm,
        }),
      });
      const data = await res.json().catch(() => ({ error: `Setup failed (HTTP ${res.status}).` }));
      if (!res.ok) {
        throw new Error(data.error || `Setup failed (HTTP ${res.status}).`);
      }
      // Logged in immediately (cookie set server-side). Land on the backups
      // page — it shows the "enable backups" form when unconfigured, which
      // is the natural next step after setup.
      window.location.href = "/admin/backups";
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm focus:border-stone-500 focus:outline-none disabled:opacity-50";

  return (
    <div className="mt-6 rounded-lg border border-stone-200 bg-white p-5">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-stone-700">Setup token</label>
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            className={`${inputCls} font-mono`}
            value={setupToken}
            onChange={(e) => setSetupToken(e.target.value)}
            placeholder="e.g. abc123XYZ…"
            disabled={submitting}
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
            className={inputCls}
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            minLength={12}
            disabled={submitting}
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
            className={inputCls}
            value={adminPasswordConfirm}
            onChange={(e) => setAdminPasswordConfirm(e.target.value)}
            minLength={12}
            disabled={submitting}
            required
          />
          {adminPasswordConfirm.length > 0 && !passwordsMatch && (
            <p className="mt-1 text-xs text-red-600">Passwords do not match.</p>
          )}
        </div>
        {error && <p className="whitespace-pre-wrap text-sm text-red-600">{error}</p>}
        <div className="flex items-center justify-between">
          <p className="text-xs text-stone-400">Encrypted backups: configure afterwards in the admin UI.</p>
          <button
            type="button"
            onClick={submit}
            disabled={!formOk || submitting}
            className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {submitting ? "Setting up…" : "Finish setup"}
          </button>
        </div>
      </div>
    </div>
  );
}
