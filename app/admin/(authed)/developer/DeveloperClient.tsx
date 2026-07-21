"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, PageHeader } from "@/app/components/ui";
import { copyTextToClipboard } from "@/lib/clipboard";

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    const copied = await copyTextToClipboard(text);
    setState(copied ? "copied" : "failed");
    setTimeout(() => setState("idle"), copied ? 2000 : 4000);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="shrink-0 rounded-md bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-shadow"
    >
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="overflow-hidden rounded-lg bg-night-shadow">
      <div className="flex items-center justify-end border-b border-white/10 px-2 py-1">
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-paper">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function DeveloperClient() {
  const [origin, setOrigin] = useState("http://<your-host>:3000");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const config = `{
  "mcpServers": {
    "kindred": {
      "command": "node",
      "args": ["/absolute/path/to/kindred-mcp/dist/index.js"],
      "env": {
        "KINDRED_URL": "${origin}",
        "KINDRED_TOKEN": "<copy from Administration > Access>"
      }
    }
  }
}`;

  return (
    <div>
      <PageHeader
        eyebrow="Admin & developer"
        title="Connect an AI assistant"
        description="Set up the Kindred MCP server so an MCP-compatible AI client can manage contacts safely."
      />

      <div className="mt-6 space-y-6">
        <Card>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">Step 1</p>
          <h2 className="mt-1 text-lg font-bold text-night">Build the MCP server</h2>
          <p className="mt-2 text-sm text-night/60">
            On the machine where you installed the Kindred source code, install its separate MCP package and build it once.
          </p>
          <div className="mt-3">
            <CodeBlock code={`cd /path/to/kindred-friend-crm/kindred-mcp\nnpm install\nnpm run build`} />
          </div>
          <p className="mt-3 text-xs text-night/50">
            This creates <code>kindred-mcp/dist/index.js</code>. Re-run <code>npm run build</code> after updating the MCP server.
          </p>
        </Card>

        <Card>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">Step 2</p>
          <h2 className="mt-1 text-lg font-bold text-night">Copy the Kindred token</h2>
          <p className="mt-2 text-sm text-night/60">
            Add this value as <code>KINDRED_TOKEN</code> in your MCP client configuration. Use the URL shown in the next step as <code>KINDRED_URL</code>.
          </p>
          <Link href="/admin/access" className="mt-3 inline-flex rounded-lg bg-night px-3 py-2 text-sm font-semibold text-white hover:bg-night-shadow">Open Access</Link>
          <p className="mt-3 text-xs text-night/50">
            If your AI client runs on another machine, use a LAN address or HTTPS URL, not <code>localhost</code>.
          </p>
        </Card>

        <Card>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">Step 3</p>
          <h2 className="mt-1 text-lg font-bold text-night">Add Kindred to your MCP client</h2>
          <p className="mt-2 text-sm text-night/60">
            Add this entry to the client&apos;s MCP configuration. Claude Desktop, Cursor, and similar clients use this shape. Replace the server path and the token placeholder with the value you copied in the previous step.
          </p>
          <div className="mt-3">
            <CodeBlock code={config} />
          </div>
          <p className="mt-3 text-xs text-night/50">
            For Claude Desktop on macOS, edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code>, then fully quit and reopen Claude Desktop.
          </p>
        </Card>

        <Card>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-sand-shadow">Step 4</p>
          <h2 className="mt-1 text-lg font-bold text-night">Verify the connection</h2>
          <p className="mt-2 text-sm text-night/60">After restarting your MCP client, try one of these prompts:</p>
          <ul className="mt-3 space-y-2 text-sm text-night/70">
            <li className="rounded-lg bg-paper px-3 py-2">&ldquo;List my Kindred contacts.&rdquo;</li>
            <li className="rounded-lg bg-paper px-3 py-2">&ldquo;Show birthdays coming up in the next 30 days.&rdquo;</li>
            <li className="rounded-lg bg-paper px-3 py-2">&ldquo;Add Grace Hopper, birthday December 9, 1906, notes: COBOL pioneer.&rdquo;</li>
          </ul>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-night">What the MCP server can do</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-night/60">
            <li>List and search contacts, including upcoming birthdays.</li>
            <li>Create contacts and return their ID and next birthday.</li>
            <li>Update only the fields that changed, while preserving the rest of the contact.</li>
            <li>Delete contacts using an enforced two-step confirmation flow.</li>
          </ul>
          <p className="mt-3 text-xs text-night/50">
            The server uses Kindred&apos;s authenticated agent API over HTTP. It never opens the Kindred database directly.
          </p>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-night">Agent API reference</h2>
          <p className="mt-2 text-sm text-night/60">The MCP server uses Kindred&apos;s Bearer-token authenticated API. Use the token from Access as the <code>Authorization: Bearer &lt;token&gt;</code> header.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead><tr className="border-b border-night/10 text-night/50"><th className="pb-2 font-semibold">Method</th><th className="pb-2 font-semibold">Endpoint</th><th className="pb-2 font-semibold">Purpose</th></tr></thead>
              <tbody className="divide-y divide-night/10 text-night/70">
                <tr><td className="py-2 font-mono">GET</td><td className="py-2 font-mono">/api/agent/contacts</td><td className="py-2">List, search, or filter upcoming birthdays.</td></tr>
                <tr><td className="py-2 font-mono">GET</td><td className="py-2 font-mono">/api/agent/contacts/:id</td><td className="py-2">Fetch one contact.</td></tr>
                <tr><td className="py-2 font-mono">POST</td><td className="py-2 font-mono">/api/agent/contacts</td><td className="py-2">Create a contact.</td></tr>
                <tr><td className="py-2 font-mono">PUT / DELETE</td><td className="py-2 font-mono">/api/agent/contacts/:id</td><td className="py-2">Update or permanently delete a contact.</td></tr>
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-night/50">List requests accept optional <code>q</code> and <code>within_days</code> query parameters. Create and update requests use JSON contact fields.</p>
        </Card>

        <Card>
          <h2 className="text-lg font-bold text-night">Troubleshooting</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-night/60">
            <li><strong>Unauthorized:</strong> copy the token from this page again and update <code>KINDRED_TOKEN</code>.</li>
            <li><strong>Could not reach Kindred:</strong> make sure the URL is reachable from the MCP client machine. Remote clients cannot use this machine&apos;s <code>localhost</code>.</li>
            <li><strong>Server changes are missing:</strong> run <code>npm run build</code> in <code>kindred-mcp</code>, then fully restart the MCP client.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
