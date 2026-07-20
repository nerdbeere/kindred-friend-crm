"use client";

import { useState } from "react";

export default function SettingsClient() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (next.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }
    if (next !== confirm) {
      setError("New password and confirmation do not match.");
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setOk("Password updated.");
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 max-w-md space-y-4 rounded-lg border border-stone-200 bg-white p-5">
      <div>
        <label className="block text-sm font-medium text-stone-700">Current password</label>
        <input
          type="password"
          autoComplete="current-password"
          className="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-700">New password</label>
        <input
          type="password"
          autoComplete="new-password"
          className="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          minLength={12}
          required
        />
        <p className="mt-1 text-xs text-stone-500">At least 12 characters.</p>
      </div>
      <div>
        <label className="block text-sm font-medium text-stone-700">Confirm new password</label>
        <input
          type="password"
          autoComplete="new-password"
          className="mt-1 w-full rounded border border-stone-300 px-3 py-2 text-sm"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          minLength={12}
          required
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {ok && <p className="text-sm text-green-700">{ok}</p>}
      <button
        type="submit"
        disabled={busy}
        className="rounded bg-stone-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Saving…" : "Update password"}
      </button>
    </form>
  );
}