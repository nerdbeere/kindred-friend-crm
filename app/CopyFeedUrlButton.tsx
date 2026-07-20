"use client";

import { useState } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";

export default function CopyFeedUrlButton({ feedPath }: { feedPath: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    const url = `${window.location.origin}${feedPath}`;
    const ok = await copyTextToClipboard(url);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), ok ? 2000 : 4000);
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="rounded-md px-2 py-1 text-xs font-semibold text-night/55 underline-offset-2 hover:text-night hover:underline"
    >
      {state === "copied"
        ? "Copied!"
        : state === "failed"
          ? "Copy failed — long-press to copy"
          : "Copy calendar feed URL"}
    </button>
  );
}
