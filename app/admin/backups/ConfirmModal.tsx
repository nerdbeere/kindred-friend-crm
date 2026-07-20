"use client";

import { useEffect, useState } from "react";

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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-stone-900">{title}</h3>
        <div className="mt-2 text-sm text-stone-600">{children}</div>
        <label className="mt-4 block text-xs font-medium text-stone-500">
          Type <span className="font-mono font-bold text-stone-800">{phrase}</span> to confirm
        </label>
        <input
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          disabled={busy}
          autoFocus
          className="mt-1 w-full rounded border border-stone-300 px-3 py-2 font-mono text-sm focus:border-stone-500 focus:outline-none disabled:opacity-50"
          placeholder={phrase}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded px-4 py-2 text-sm text-stone-600 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={typed !== phrase || busy}
            className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
