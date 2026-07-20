"use client";

import { useState } from "react";

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

function birthdayLabel(c: ContactView): string {
  const base = `${MONTH_NAMES[c.birth_month - 1]} ${c.birth_day}`;
  return c.birth_year ? `${base}, ${c.birth_year}` : base;
}

function untilLabel(days: number): string {
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return `in ${days} days`;
}

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
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const inputClass =
    "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500";

  return (
    <div className="mt-8 space-y-8">
      <section className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <h2 className="text-sm font-semibold text-amber-900">
          Birthday calendar feed
        </h2>
        <p className="mt-1 text-xs text-amber-800">
          Subscribe from Home Assistant, Google Calendar, or any calendar app.
          Anyone with this URL can read the feed — keep it secret.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 truncate rounded bg-white px-2 py-1 text-xs text-stone-700 ring-1 ring-amber-200">
            {feedPath}
          </code>
          <button
            type="button"
            onClick={copyFeedUrl}
            className="shrink-0 rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
          >
            {copied ? "Copied" : "Copy URL"}
          </button>
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold">
          {editingId === null ? "Add a contact" : "Edit contact"}
        </h2>
        <form onSubmit={handleSubmit} className="mt-3 space-y-3">
          <div>
            <label htmlFor="name" className="mb-1 block text-xs font-medium text-stone-600">
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
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label htmlFor="month" className="mb-1 block text-xs font-medium text-stone-600">
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
              <label htmlFor="day" className="mb-1 block text-xs font-medium text-stone-600">
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
            <div>
              <label htmlFor="year" className="mb-1 block text-xs font-medium text-stone-600">
                Year <span className="text-stone-400">(optional)</span>
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
            <label htmlFor="notes" className="mb-1 block text-xs font-medium text-stone-600">
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
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 disabled:opacity-50"
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
                className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-600 hover:bg-stone-100"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>

      <section>
        <h2 className="text-sm font-semibold text-stone-700">
          Upcoming birthdays
        </h2>
        {contacts.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">
            No contacts yet — add someone above.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-stone-200 rounded-lg border border-stone-200 bg-white shadow-sm">
            {contacts.map((c) => (
              <li key={c.id} className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-sm text-stone-500">
                      {birthdayLabel(c)}
                    </span>
                  </div>
                  {c.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-stone-600">
                      {c.notes}
                    </p>
                  )}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
                    c.days_until === 0
                      ? "bg-amber-100 text-amber-800"
                      : c.days_until <= 30
                        ? "bg-stone-100 text-stone-700"
                        : "bg-stone-50 text-stone-500"
                  }`}
                >
                  {untilLabel(c.days_until)}
                </span>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(c)}
                    className="rounded px-2 py-1 text-xs font-medium text-stone-500 hover:bg-stone-100 hover:text-stone-800"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c)}
                    className="rounded px-2 py-1 text-xs font-medium text-red-500 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
