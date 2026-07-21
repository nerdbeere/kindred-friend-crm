"use client";

import { useState } from "react";
import { Alert, Button, Card } from "@/app/components/ui";
import { copyTextToClipboard } from "@/lib/clipboard";
import SettingsClient from "../settings/SettingsClient";

export default function AccessClient({ token }: { token: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  async function copyToken() {
    const copied = await copyTextToClipboard(token);
    setCopyState(copied ? "copied" : "failed");
    setTimeout(() => setCopyState("idle"), copied ? 2000 : 4000);
  }
  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-2">
      <Card>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">Shared integration token</p>
        <h2 className="mt-2 text-lg font-bold text-night">Calendar and AI access</h2>
        <p className="mt-2 text-sm leading-6 text-night/60">This token authenticates the birthday calendar feed and lets an AI assistant or script read and change contacts. Treat it like a password.</p>
        <Alert className="mt-4">There is no in-app rotation yet. Replacing this token would require updating every calendar subscription and AI client.</Alert>
        <div className="mt-4 flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-md bg-paper px-3 py-2 text-xs text-night ring-1 ring-night/10">{revealed ? token : "••••••••••••••••••••••••"}</code>
          <Button type="button" variant="secondary" size="sm" onClick={() => setRevealed((value) => !value)}>{revealed ? "Hide" : "Reveal"}</Button>
          <Button type="button" size="sm" onClick={() => void copyToken()}>{copyState === "copied" ? "Copied" : copyState === "failed" ? "Copy failed" : "Copy"}</Button>
        </div>
        <p className="mt-3 text-xs leading-5 text-night/50">Only reveal or copy it into a trusted password manager or integration configuration. Avoid screen sharing while it is visible.</p>
      </Card>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">Administrator password</p>
        <h2 className="mt-2 text-lg font-bold text-night">Change password</h2>
        <p className="mt-2 text-sm leading-6 text-night/60">Use a unique password with at least 12 characters to protect this administration area.</p>
        <SettingsClient className="mt-4 max-w-none" />
      </div>
    </div>
  );
}
