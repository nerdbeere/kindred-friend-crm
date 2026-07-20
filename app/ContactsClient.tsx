"use client";

import { useDeferredValue, useState } from "react";

export interface ContactView {
  id: number;
  name: string;
  birth_month: number;
  birth_day: number;
  birth_year: number | null;
  notes: string;
  days_until: number;
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

interface FormState {
  name: string;
  month: string;
  day: string;
  year: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  month: "",
  day: "",
  year: "",
  notes: "",
};

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

function birthdayLabel(c: ContactView): string {
  const base = `${MONTH_NAMES[c.birth_month - 1]} ${c.birth_day}`;
  return c.birth_year ? `${base}, ${c.birth_year}` : base;
}

function untilLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

type SortOption = "upcoming" | "name" | "birthday";

export default function ContactsClient({
  initialContacts,
  feedPath,
}: {
  initialContacts: ContactView[];
  feedPath: string;
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("upcoming");
  const deferredSearch = useDeferredValue(search);

  async function refresh() {
    const res = await fetch("/api/contacts", { cache: "no-store" });
    setContacts(await res.json());
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        birth_month: Number(form.month),
        birth_day: Number(form.day),
        birth_year: form.year === "" ? null : Number(form.year),
        notes: form.notes,
      };
      const res = await fetch(
        editingId === null ? "/api/contacts" : `/api/contacts/${editingId}`,
        {
          method: editingId === null ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Something went wrong");
        return;
      }
      setForm(EMPTY_FORM);
      setEditingId(null);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(c: ContactView) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      month: String(c.birth_month),
      day: String(c.birth_day),
      year: c.birth_year === null ? "" : String(c.birth_year),
      notes: c.notes,
    });
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  async function handleDelete(c: ContactView) {
    if (!window.confirm(`Delete ${c.name}?`)) return;
    const res = await fetch(`/api/contacts/${c.id}`, { method: "DELETE" });
    if (res.ok) {
      if (editingId === c.id) cancelEdit();
      await refresh();
    }
  }

  async function copyFeedUrl() {
    const url = `${window.location.origin}${feedPath}`;
    const ok = await copyTextToClipboard(url);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setCopyFailed(true);
      setTimeout(() => setCopyFailed(false), 4000);
    }
  }

  const inputClass =
    "w-full rounded-xl border border-night/20 bg-white px-3 py-2.5 text-sm text-night shadow-sm outline-none transition placeholder:text-night/40 focus:border-sand-shadow focus:ring-2 focus:ring-sand/45";
  const normalizedSearch = deferredSearch.trim().toLocaleLowerCase();
  const visibleContacts = contacts
    .filter((contact) => {
      if (!normalizedSearch) return true;
      return `${contact.name} ${contact.notes} ${birthdayLabel(contact)}`.toLocaleLowerCase().includes(normalizedSearch);
    })
    .sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "birthday") return a.birth_month - b.birth_month || a.birth_day - b.birth_day || a.name.localeCompare(b.name);
      return a.days_until - b.days_until || a.name.localeCompare(b.name);
    });
  const upcomingContacts = [...contacts].sort((a, b) => a.days_until - b.days_until).slice(0, 4);

  return (
    <div className="mt-8 space-y-8 sm:mt-10">
      <section className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        <div className="rounded-2xl bg-night p-5 text-[#f8f2e9] shadow-lg shadow-night/15 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-sand">Birthday radar</p>
              <h2 className="mt-1 text-2xl font-bold">Coming up soon</h2>
            </div>
            <span className="rounded-full bg-sand px-3 py-1 text-xs font-bold text-night">{contacts.length} people</span>
          </div>
          {upcomingContacts.length === 0 ? (
            <p className="mt-8 text-sm text-[#f8f2e9]/70">Add your first person to start building your circle.</p>
          ) : (
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              {upcomingContacts.map((contact) => (
                <div key={contact.id} className="rounded-xl bg-white/10 px-3 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-semibold">{contact.name}</span>
                    <span className="shrink-0 text-xs font-bold text-sand">{untilLabel(contact.days_until)}</span>
                  </div>
                  <p className="mt-1 text-xs text-[#f8f2e9]/70">{birthdayLabel(contact)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-sand-shadow/35 bg-sand/25 p-5 sm:p-6">
          <h2 className="font-bold text-night">Birthday calendar</h2>
          <p className="mt-1 text-sm leading-5 text-night/70">Use this private feed in your favorite calendar app.</p>
          <div className="mt-4 flex gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-white/80 px-2.5 py-2 text-xs text-night ring-1 ring-sand-shadow/20">{feedPath}</code>
            <button type="button" onClick={copyFeedUrl} className="shrink-0 rounded-lg bg-night px-3 py-2 text-xs font-bold text-white transition hover:bg-night-shadow">
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          {copyFailed && <p className="mt-2 text-xs font-medium text-night">Copy failed. Long-press or right-click the URL to copy it.</p>}
        </div>
      </section>

      <section className="rounded-2xl border border-night/10 bg-white p-5 shadow-sm sm:p-6">
        <h2 className="text-lg font-bold text-night">
          {editingId === null ? "Add a contact" : "Edit contact"}
        </h2>
        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="name" className="mb-1 block text-xs font-bold uppercase tracking-wide text-night/60">
              Name
            </label>
            <input
              id="name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
              placeholder="Ada Lovelace"
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-1">
              <label htmlFor="month" className="mb-1 block text-xs font-bold uppercase tracking-wide text-night/60">
                Month
              </label>
              <select
                id="month"
                required
                value={form.month}
                onChange={(e) => setForm({ ...form, month: e.target.value })}
                className={inputClass}
              >
                <option value="" disabled>
                  —
                </option>
                {MONTH_NAMES.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="day" className="mb-1 block text-xs font-bold uppercase tracking-wide text-night/60">
                Day
              </label>
              <input
                id="day"
                required
                type="number"
                min={1}
                max={31}
                value={form.day}
                onChange={(e) => setForm({ ...form, day: e.target.value })}
                className={inputClass}
                placeholder="14"
              />
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="year" className="mb-1 block text-xs font-bold uppercase tracking-wide text-night/60">
                Year <span className="text-night/40">(optional)</span>
              </label>
              <input
                id="year"
                type="number"
                min={1800}
                max={new Date().getFullYear()}
                value={form.year}
                onChange={(e) => setForm({ ...form, year: e.target.value })}
                className={inputClass}
                placeholder="1990"
              />
            </div>
          </div>
          <div>
            <label htmlFor="notes" className="mb-1 block text-xs font-bold uppercase tracking-wide text-night/60">
              Notes
            </label>
            <textarea
              id="notes"
              rows={2}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className={inputClass}
              placeholder="How you met, gift ideas, anything…"
            />
          </div>
          {error && <p className="text-sm font-medium text-red-700">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-night px-4 py-2.5 text-sm font-bold text-white transition hover:bg-night-shadow disabled:opacity-50"
            >
              {saving
                ? "Saving…"
                : editingId === null
                  ? "Add contact"
                  : "Save changes"}
            </button>
            {editingId !== null && (
              <button
                type="button"
                onClick={cancelEdit}
                className="rounded-xl border border-night/20 px-4 py-2.5 text-sm font-bold text-night/70 hover:bg-sand/20"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-2xl border border-night/10 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-sand-shadow">Your circle</p>
            <h2 className="mt-1 text-xl font-bold text-night">All contacts</h2>
          </div>
          <p className="text-sm text-night/60">{visibleContacts.length} of {contacts.length} people</p>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_11rem]">
          <input value={search} onChange={(event) => setSearch(event.target.value)} className={inputClass} placeholder="Search names, notes, or birthdays" aria-label="Search contacts" />
          <select value={sort} onChange={(event) => setSort(event.target.value as SortOption)} className={inputClass} aria-label="Sort contacts">
            <option value="upcoming">Soonest birthday</option>
            <option value="name">Name A-Z</option>
            <option value="birthday">Calendar date</option>
          </select>
        </div>
        {visibleContacts.length === 0 ? (
          <p className="mt-8 rounded-xl bg-[#f8f2e9] p-5 text-center text-sm text-night/65">
            {contacts.length === 0 ? "No contacts yet. Add someone above." : "No contacts match that search."}
          </p>
        ) : (
          <ul className="mt-5 divide-y divide-night/10 overflow-hidden rounded-xl border border-night/10">
            {visibleContacts.map((c) => (
              <li key={c.id} className="flex flex-col gap-3 p-4 transition hover:bg-sand/10 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold text-night">{c.name}</span>
                    <span className="text-sm text-night/60">
                      {birthdayLabel(c)}
                    </span>
                  </div>
                  {c.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-night/70">
                      {c.notes}
                    </p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 sm:contents">
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold ${
                    c.days_until === 0
                      ? "bg-sand text-night"
                      : c.days_until <= 30
                        ? "bg-night/10 text-night"
                        : "bg-[#f8f2e9] text-night/65"}`}>
                    {untilLabel(c.days_until)}
                  </span>
                  <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-night/65 hover:bg-sand/30 hover:text-night"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c)}
                    className="rounded-lg px-2.5 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
                  >
                    Delete
                  </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
