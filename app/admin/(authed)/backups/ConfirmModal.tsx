"use client";

import { useEffect, useId, useRef, useState } from "react";
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
  const titleId = useId();
  const inputId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const busyRef = useRef(busy);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busyRef.current) onCancel();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])");
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); returnFocusRef.current?.focus(); };
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-night-shadow/50 p-4"
      onClick={() => !busy && onCancel()}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl"
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={titleId} className="text-base font-bold text-night">{title}</h3>
        <div className="mt-2 text-sm text-night/65">{children}</div>
        <label htmlFor={inputId} className="mt-4 block text-xs font-bold uppercase tracking-wide text-night/50">
          Type <span className="font-mono font-bold text-night">{phrase}</span> to confirm
        </label>
        <input
          type="text"
          id={inputId}
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
