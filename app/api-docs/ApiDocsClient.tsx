"use client";

import { useEffect, useState } from "react";
import { copyTextToClipboard } from "@/lib/clipboard";
import { Badge, Card, PageHeader } from "@/app/components/ui";

function CopyButton({ text, className }: { text: string; className: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleCopy() {
    const ok = await copyTextToClipboard(text);
    setState(ok ? "copied" : "failed");
    setTimeout(() => setState("idle"), ok ? 2000 : 4000);
  }

  return (
    <button type="button" onClick={handleCopy} className={className}>
      {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
    </button>
  );
}

function CodeBlock({ code }: { code: string }) {
  return (
    <div className="overflow-hidden rounded-lg bg-night-shadow">
      <div className="flex items-center justify-end border-b border-white/10 px-2 py-1">
        <CopyButton
          text={code}
          className="rounded-md px-2 py-0.5 text-[10px] font-semibold text-paper/70 hover:bg-white/10 hover:text-paper"
        />
      </div>
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed text-paper">
        <code>{code}</code>
      </pre>
    </div>
  );
}

const ENDPOINTS: { method: string; path: string; description: string }[] = [
  { method: "GET", path: "/api/agent/contacts", description: "List all contacts, sorted by upcoming birthday" },
  { method: "GET", path: "/api/agent/contacts?q=<text>", description: "Case-insensitive substring search on name + notes" },
  { method: "GET", path: "/api/agent/contacts?within_days=<n>", description: "Only birthdays within the next n days (0–3660)" },
  { method: "GET", path: "/api/agent/contacts/<id>", description: "Get one contact" },
  { method: "POST", path: "/api/agent/contacts", description: "Create a contact" },
  { method: "PUT", path: "/api/agent/contacts/<id>", description: "Full-replacement update" },
  { method: "DELETE", path: "/api/agent/contacts/<id>", description: "Delete permanently (responds 204)" },
];

const METHOD_TONE: Record<string, "neutral" | "warning" | "danger"> = {
  GET: "neutral",
  POST: "warning",
  PUT: "warning",
  DELETE: "danger",
};

export default function ApiDocsClient({ token }: { token: string }) {
  // window.location.origin is only known after mount — until then show a
  // placeholder so server-rendered HTML and the first client render match.
  const [origin, setOrigin] = useState("http://<your-host>:3000");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const auth = `Authorization: Bearer ${token}`;

  const examples = {
    list: `curl -H "${auth}" \\\n  "${origin}/api/agent/contacts"`,
    upcoming: `curl -H "${auth}" \\\n  "${origin}/api/agent/contacts?within_days=30"`,
    search: `curl -H "${auth}" \\\n  "${origin}/api/agent/contacts?q=ada"`,
    create: `curl -X POST -H "${auth}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"first_name":"Grace","last_name":"Hopper","birth_month":12,"birth_day":9,"birth_year":1906,"notes":"COBOL pioneer"}' \\\n  "${origin}/api/agent/contacts"`,
    update: `curl -X PUT -H "${auth}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"first_name":"Grace","last_name":"Hopper","birth_month":12,"birth_day":9,"birth_year":1906,"notes":"COBOL pioneer"}' \\\n  "${origin}/api/agent/contacts/1"`,
    delete: `curl -X DELETE -H "${auth}" \\\n  "${origin}/api/agent/contacts/1"`,
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <PageHeader
        eyebrow="For scripts &amp; AI agents"
        title="Agent API"
        description="Everything a script or AI agent needs to manage your contacts."
      />

      <div className="mt-6 space-y-6">
        <Card>
          <h2 className="text-sm font-bold text-night">Authentication</h2>
          <p className="mt-1 text-xs text-night/60">
            Every request must send the API token as a Bearer header. It is the same secret as the
            ICS feed token — anyone with it can read and modify your contacts, so keep it secret.
            Rotating it (delete the feed_token row from the settings table and restart) rotates both
            the feed and this API.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <code className="flex-1 truncate rounded-md bg-paper px-2 py-1.5 text-xs text-night ring-1 ring-night/10">
              {token}
            </code>
            <CopyButton
              text={token}
              className="shrink-0 rounded-md bg-night px-3 py-1.5 text-xs font-semibold text-white hover:bg-night-shadow"
            />
          </div>
          <p className="mt-2 text-xs text-night/50">
            Header format: <code className="rounded bg-paper px-1 py-0.5 ring-1 ring-night/10">{auth}</code>
          </p>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-night">Endpoints</h2>
          <table className="mt-3 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-night/10 text-night/45">
                <th className="py-1.5 pr-3 font-semibold">Method</th>
                <th className="py-1.5 pr-3 font-semibold">Path</th>
                <th className="py-1.5 font-semibold">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-night/5">
              {ENDPOINTS.map((e) => (
                <tr key={e.method + e.path}>
                  <td className="py-1.5 pr-3">
                    <Badge tone={METHOD_TONE[e.method]} className="font-mono text-[10px]">
                      {e.method}
                    </Badge>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-night/80">{e.path}</td>
                  <td className="py-1.5 text-night/60">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-night/50">
            <code>q</code> and <code>within_days</code> can be combined on the list endpoint.
          </p>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-night">The contact object</h2>
          <div className="mt-3">
            <CodeBlock
              code={`{\n  "id": 1,\n  "first_name": "Ada",\n  "last_name": "Lovelace",\n  "birth_month": 12,\n  "birth_day": 10,\n  "birth_year": 1815,\n  "notes": "Met at the maths society",\n  "days_until": 143\n}`}
            />
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-night/60">
            <li>
              <code>birth_year</code> may be <code>null</code> when the year is unknown or irrelevant —
              never guess one.
            </li>
            <li>
              <code>days_until</code> is computed by the server on reads. Never send it on writes.
            </li>
            <li>
              Required on create: <code>first_name</code>, <code>birth_month</code> (1–12),{" "}
              <code>birth_day</code> (valid for the month). Optional: <code>last_name</code>,{" "}
              <code>birth_year</code> (1800–current year or null), <code>notes</code> (max 10000
              chars).
            </li>
          </ul>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-night">Examples</h2>

          <h3 className="mt-4 text-xs font-bold text-night/60">List all contacts</h3>
          <div className="mt-2">
            <CodeBlock code={examples.list} />
          </div>

          <h3 className="mt-4 text-xs font-bold text-night/60">Birthdays in the next 30 days</h3>
          <div className="mt-2">
            <CodeBlock code={examples.upcoming} />
          </div>

          <h3 className="mt-4 text-xs font-bold text-night/60">Search by name or notes</h3>
          <div className="mt-2">
            <CodeBlock code={examples.search} />
          </div>

          <h3 className="mt-4 text-xs font-bold text-night/60">Create a contact</h3>
          <div className="mt-2">
            <CodeBlock code={examples.create} />
          </div>

          <h3 className="mt-4 text-xs font-bold text-night/60">Update a contact</h3>
          <p className="mt-1 text-xs text-night/50">
            PUT replaces the whole record — GET it first, merge your change, and send the merged
            object (without <code>id</code> or <code>days_until</code>) so unchanged fields are
            preserved.
          </p>
          <div className="mt-2">
            <CodeBlock code={examples.update} />
          </div>

          <h3 className="mt-4 text-xs font-bold text-night/60">Delete a contact</h3>
          <p className="mt-1 text-xs text-night/50">
            Permanent and irreversible. Responds 204 with an empty body.
          </p>
          <div className="mt-2">
            <CodeBlock code={examples.delete} />
          </div>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-night">Errors</h2>
          <p className="mt-2 text-xs text-night/60">
            Errors are JSON, <code>{'{"error": "<message>"}'}</code>, with a matching status code:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-night/60">
            <li>
              <code>401</code> — missing or wrong Bearer token
            </li>
            <li>
              <code>400</code> — invalid JSON body, invalid contact fields, or invalid id / query
              parameter
            </li>
            <li>
              <code>404</code> — contact not found
            </li>
          </ul>
        </Card>

        <Card>
          <h2 className="text-sm font-bold text-night">For AI agents</h2>
          <p className="mt-2 text-xs text-night/60">
            The repository ships a ready-made agent skill at <code>skills/kindred/SKILL.md</code>.
            Copy or symlink it into your agent&apos;s skills directory (e.g.{" "}
            <code>~/.config/opencode/skills/</code> or <code>~/.agents/skills/</code>) and set{" "}
            <code>KINDRED_URL</code> + <code>KINDRED_TOKEN</code> in its environment.
          </p>
        </Card>
      </div>
    </main>
  );
}
