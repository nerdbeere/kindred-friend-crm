"use client";

import { useEffect, useState } from "react";

/**
 * Copy text with a fallback for non-secure contexts. `navigator.clipboard`
 * only exists on HTTPS / localhost — on plain-HTTP LAN installs
 * (http://192.168.x.x) it is undefined, so fall back to the legacy
 * hidden-textarea + execCommand path. Returns false if both fail.
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fall through to the legacy path
    }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-9999px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, ta.value.length); // iOS Safari
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

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
    <div className="relative">
      <pre className="overflow-x-auto rounded-md bg-stone-900 p-3 pr-16 text-xs leading-relaxed text-stone-100">
        <code>{code}</code>
      </pre>
      <CopyButton
        text={code}
        className="absolute right-2 top-2 rounded bg-stone-700 px-2 py-0.5 text-[10px] font-medium text-stone-100 hover:bg-stone-600"
      />
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

const METHOD_STYLES: Record<string, string> = {
  GET: "bg-stone-100 text-stone-700",
  POST: "bg-amber-100 text-amber-800",
  PUT: "bg-amber-100 text-amber-800",
  DELETE: "bg-red-100 text-red-700",
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
    create: `curl -X POST -H "${auth}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Grace Hopper","birth_month":12,"birth_day":9,"birth_year":1906,"notes":"COBOL pioneer"}' \\\n  "${origin}/api/agent/contacts"`,
    update: `curl -X PUT -H "${auth}" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Grace Hopper","birth_month":12,"birth_day":9,"birth_year":1906,"notes":"COBOL pioneer"}' \\\n  "${origin}/api/agent/contacts/1"`,
    delete: `curl -X DELETE -H "${auth}" \\\n  "${origin}/api/agent/contacts/1"`,
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <div className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight">Agent API</h1>
        <a href="/" className="text-sm text-stone-500 hover:text-stone-800">
          &larr; Back to contacts
        </a>
      </div>
      <p className="mt-1 text-sm text-stone-500">
        Everything a script or AI agent needs to manage your contacts.
      </p>

      <div className="mt-8 space-y-8">
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">
            Authentication
          </h2>
          <p className="mt-1 text-xs text-amber-800">
            Every request must send the API token as a Bearer header. It is the
            same secret as the ICS feed token — anyone with it can read and
            modify your contacts, so keep it secret. Rotating it (delete the
            feed_token row from the settings table and restart) rotates both
            the feed and this API.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs text-stone-700 ring-1 ring-amber-200">
              {token}
            </code>
            <CopyButton
              text={token}
              className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
            />
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Header format: <code className="rounded bg-white px-1 py-0.5 ring-1 ring-amber-200">{auth}</code>
          </p>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Endpoints</h2>
          <table className="mt-3 w-full text-left text-xs">
            <thead>
              <tr className="border-b border-stone-200 text-stone-500">
                <th className="py-1.5 pr-3 font-medium">Method</th>
                <th className="py-1.5 pr-3 font-medium">Path</th>
                <th className="py-1.5 font-medium">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {ENDPOINTS.map((e) => (
                <tr key={e.method + e.path}>
                  <td className="py-1.5 pr-3">
                    <span
                      className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${METHOD_STYLES[e.method]}`}
                    >
                      {e.method}
                    </span>
                  </td>
                  <td className="py-1.5 pr-3 font-mono text-stone-700">
                    {e.path}
                  </td>
                  <td className="py-1.5 text-stone-600">{e.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs text-stone-500">
            <code>q</code> and <code>within_days</code> can be combined on the
            list endpoint.
          </p>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">The contact object</h2>
          <div className="mt-3">
            <CodeBlock
              code={`{\n  "id": 1,\n  "name": "Ada Lovelace",\n  "birth_month": 12,\n  "birth_day": 10,\n  "birth_year": 1815,\n  "notes": "Met at the maths society",\n  "days_until": 143\n}`}
            />
          </div>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-stone-600">
            <li>
              <code>birth_year</code> may be <code>null</code> when the year is
              unknown or irrelevant — never guess one.
            </li>
            <li>
              <code>days_until</code> is computed by the server on reads. Never
              send it on writes.
            </li>
            <li>
              Required on create: <code>name</code>,{" "}
              <code>birth_month</code> (1–12), <code>birth_day</code> (valid
              for the month). Optional: <code>birth_year</code> (1800–current
              year or null), <code>notes</code> (max 10000 chars).
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Examples</h2>

          <h3 className="mt-4 text-xs font-semibold text-stone-600">
            List all contacts
          </h3>
          <div className="mt-2">
            <CodeBlock code={examples.list} />
          </div>

          <h3 className="mt-4 text-xs font-semibold text-stone-600">
            Birthdays in the next 30 days
          </h3>
          <div className="mt-2">
            <CodeBlock code={examples.upcoming} />
          </div>

          <h3 className="mt-4 text-xs font-semibold text-stone-600">
            Search by name or notes
          </h3>
          <div className="mt-2">
            <CodeBlock code={examples.search} />
          </div>

          <h3 className="mt-4 text-xs font-semibold text-stone-600">
            Create a contact
          </h3>
          <div className="mt-2">
            <CodeBlock code={examples.create} />
          </div>

          <h3 className="mt-4 text-xs font-semibold text-stone-600">
            Update a contact
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            PUT replaces the whole record — GET it first, merge your change,
            and send the merged object (without <code>id</code> or{" "}
            <code>days_until</code>) so unchanged fields are preserved.
          </p>
          <div className="mt-2">
            <CodeBlock code={examples.update} />
          </div>

          <h3 className="mt-4 text-xs font-semibold text-stone-600">
            Delete a contact
          </h3>
          <p className="mt-1 text-xs text-stone-500">
            Permanent and irreversible. Responds 204 with an empty body.
          </p>
          <div className="mt-2">
            <CodeBlock code={examples.delete} />
          </div>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">Errors</h2>
          <p className="mt-2 text-xs text-stone-600">
            Errors are JSON, <code>{'{"error": "<message>"}'}</code>, with a
            matching status code:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-stone-600">
            <li>
              <code>401</code> — missing or wrong Bearer token
            </li>
            <li>
              <code>400</code> — invalid JSON body, invalid contact fields, or
              invalid id / query parameter
            </li>
            <li>
              <code>404</code> — contact not found
            </li>
          </ul>
        </section>

        <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-semibold">For AI agents</h2>
          <p className="mt-2 text-xs text-stone-600">
            The repository ships a ready-made agent skill at{" "}
            <code>skills/kindred/SKILL.md</code>. Copy or symlink it into your
            agent&apos;s skills directory (e.g.{" "}
            <code>~/.config/opencode/skills/</code> or{" "}
            <code>~/.agents/skills/</code>) and set{" "}
            <code>KINDRED_URL</code> + <code>KINDRED_TOKEN</code> in its
            environment.
          </p>
        </section>
      </div>
    </main>
  );
}
