"use client";

import { useState } from "react";
import { Button, Card, Field, Input } from "@/app/components/ui";

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

  return (
    <Card className="mt-6">
      <div className="space-y-4">
        <Field
          label="Setup token"
          htmlFor="setup_token"
          hint={
            <>
              The installer printed this on the console at the end of provisioning. It's also at{" "}
              <code>/etc/kindred/setup-token</code> inside the CT.
            </>
          }
        >
          <Input
            id="setup_token"
            type="text"
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            value={setupToken}
            onChange={(e) => setSetupToken(e.target.value)}
            placeholder="e.g. abc123XYZ…"
            disabled={submitting}
            required
          />
        </Field>
        <Field
          label="Admin password"
          htmlFor="admin_password"
          hint={<>At least 12 characters. Strength: <span className="font-mono">{pwStrength.label}</span></>}
        >
          <Input
            id="admin_password"
            type="password"
            autoComplete="new-password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            minLength={12}
            disabled={submitting}
            required
          />
        </Field>
        <Field label="Confirm admin password" htmlFor="admin_password_confirm">
          <Input
            id="admin_password_confirm"
            type="password"
            autoComplete="new-password"
            value={adminPasswordConfirm}
            onChange={(e) => setAdminPasswordConfirm(e.target.value)}
            minLength={12}
            disabled={submitting}
            required
          />
          {adminPasswordConfirm.length > 0 && !passwordsMatch && (
            <p className="mt-1 text-xs font-medium text-red-700">Passwords do not match.</p>
          )}
        </Field>
        {error && <p className="whitespace-pre-wrap text-sm font-medium text-red-700">{error}</p>}
        <div className="flex items-center justify-between">
          <p className="text-xs text-night/45">Encrypted backups: configure afterwards in the admin UI.</p>
          <Button type="button" onClick={submit} disabled={!formOk || submitting}>
            {submitting ? "Setting up…" : "Finish setup"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
