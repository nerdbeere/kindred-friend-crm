"use client";

import { useEffect, useState } from "react";
import { Button } from "@/app/components/ui";

/**
 * Modal that requires typing a phrase (e.g. "RESTORE" / "DELETE") before
 * the destructive action button unlocks.
 */
export default function ConfirmModal({
  title,
  phrase,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  phrase: string;
  children: React.ReactNode;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-shadow/50 p-4"
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-bold text-night">{title}</h3>
        <div className="mt-2 text-sm text-night/65">{children}</div>
        <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-night/50">
          Type <span className="font-mono font-bold text-night">{phrase}</span> to confirm
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
          autoFocus
          className="mt-1 w-full rounded-lg border border-night/20 px-3 py-2 font-mono text-sm outline-none focus:border-sand-shadow focus:ring-2 focus:ring-sand/45 disabled:opacity-50"
          placeholder={phrase}
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={typed !== phrase || busy}
            className="bg-red-700 hover:bg-red-800 disabled:opacity-40"
          >
            {busy ? "Working…" : confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
