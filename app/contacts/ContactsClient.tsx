"use client";

import { useDeferredValue, useState } from "react";
import { fullName as fullNameOf } from "@/lib/contact-format";
import { Badge, Button, EmptyState, Field, Input, PageHeader, Select, Textarea } from "@/app/components/ui";

export interface ContactView {
  id: number;
  first_name: string;
  last_name: string;
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
  first_name: string;
  last_name: string;
  month: string;
  day: string;
  year: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  first_name: "",
  last_name: "",
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

type SortOption = "upcoming" | "name" | "birthday";

export default function ContactsClient({
  initialContacts,
}: {
  initialContacts: ContactView[];
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortOption>("upcoming");
  const deferredSearch = useDeferredValue(search);

  async function refresh() {
    const res = await fetch("/api/contacts", { cache: "no-store" });
    setContacts(await res.json());
  }

  function openAddForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      const payload = {
        first_name: form.first_name,
        last_name: form.last_name,
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
      setFormOpen(false);
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  function startEdit(c: ContactView) {
    setEditingId(c.id);
    setForm({
      first_name: c.first_name,
      last_name: c.last_name,
      month: String(c.birth_month),
      day: String(c.birth_day),
      year: c.birth_year === null ? "" : String(c.birth_year),
      notes: c.notes,
    });
    setError(null);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setFormOpen(false);
  }

  async function handleDelete(c: ContactView) {
    if (!window.confirm(`Delete ${fullNameOf(c)}?`)) return;
    const res = await fetch(`/api/contacts/${c.id}`, { method: "DELETE" });
    if (res.ok) {
      if (editingId === c.id) cancelEdit();
      await refresh();
    }
  }

  const normalizedSearch = deferredSearch.trim().toLocaleLowerCase();
  const visibleContacts = contacts
    .filter((contact) => {
      if (!normalizedSearch) return true;
      return `${fullNameOf(contact)} ${contact.notes} ${birthdayLabel(contact)}`
        .toLocaleLowerCase()
        .includes(normalizedSearch);
    })
    .sort((a, b) => {
      if (sort === "name") return fullNameOf(a).localeCompare(fullNameOf(b));
      if (sort === "birthday")
        return (
          a.birth_month - b.birth_month ||
          a.birth_day - b.birth_day ||
          fullNameOf(a).localeCompare(fullNameOf(b))
        );
      return a.days_until - b.days_until || fullNameOf(a).localeCompare(fullNameOf(b));
    });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Your circle"
        title="Contacts"
        description={`${contacts.length} ${contacts.length === 1 ? "person" : "people"}`}
        actions={
          formOpen ? undefined : (
            <Button type="button" onClick={openAddForm}>
              Add contact
            </Button>
          )
        }
      />

      {formOpen && (
        <div className="rounded-2xl border border-night/10 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-bold text-night">
            {editingId === null ? "Add a contact" : "Edit contact"}
          </h2>
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="First name" htmlFor="first_name">
                <Input
                  id="first_name"
                  required
                  value={form.first_name}
                  onChange={(e) => setForm({ ...form, first_name: e.target.value })}
                  placeholder="Ada"
                />
              </Field>
              <Field label="Last name" htmlFor="last_name">
                <Input
                  id="last_name"
                  value={form.last_name}
                  onChange={(e) => setForm({ ...form, last_name: e.target.value })}
                  placeholder="Lovelace"
                />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Month" htmlFor="month" className="col-span-1">
                <Select
                  id="month"
                  required
                  value={form.month}
                  onChange={(e) => setForm({ ...form, month: e.target.value })}
                >
                  <option value="" disabled>
                    —
                  </option>
                  {MONTH_NAMES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Day" htmlFor="day">
                <Input
                  id="day"
                  required
                  type="number"
                  min={1}
                  max={31}
                  value={form.day}
                  onChange={(e) => setForm({ ...form, day: e.target.value })}
                  placeholder="14"
                />
              </Field>
              <Field label="Year" htmlFor="year" hint="Optional" className="col-span-2 sm:col-span-1">
                <Input
                  id="year"
                  type="number"
                  min={1800}
                  max={new Date().getFullYear()}
                  value={form.year}
                  onChange={(e) => setForm({ ...form, year: e.target.value })}
                  placeholder="1990"
                />
              </Field>
            </div>
            <Field label="Notes" htmlFor="notes">
              <Textarea
                id="notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="How you met, gift ideas, anything…"
              />
            </Field>
            {error && <p className="text-sm font-medium text-red-700">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving}>
                {saving ? "Saving…" : editingId === null ? "Add contact" : "Save changes"}
              </Button>
              <Button type="button" variant="secondary" onClick={cancelEdit}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}

      <div className="rounded-2xl border border-night/10 bg-white p-5 shadow-sm sm:p-6">
        <div className="grid gap-3 sm:grid-cols-[1fr_11rem]">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search names, notes, or birthdays"
            aria-label="Search contacts"
          />
          <Select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortOption)}
            aria-label="Sort contacts"
          >
            <option value="upcoming">Soonest birthday</option>
            <option value="name">Name A-Z</option>
            <option value="birthday">Calendar date</option>
          </Select>
        </div>
        {normalizedSearch && (
          <p className="mt-3 text-xs text-night/50">
            {visibleContacts.length} of {contacts.length} match
          </p>
        )}
        {visibleContacts.length === 0 ? (
          <div className="mt-5">
            <EmptyState>
              {contacts.length === 0 ? "No contacts yet. Add someone above." : "No contacts match that search."}
            </EmptyState>
          </div>
        ) : (
          <ul className="mt-5 divide-y divide-night/10 overflow-hidden rounded-xl border border-night/10">
            {visibleContacts.map((c) => (
              <li
                key={c.id}
                className="flex flex-col gap-3 p-4 transition hover:bg-sand/10 sm:flex-row sm:items-start"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-bold text-night">{fullNameOf(c)}</span>
                    <span className="text-sm text-night/60">{birthdayLabel(c)}</span>
                  </div>
                  {c.notes && (
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-5 text-night/70">{c.notes}</p>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2 sm:contents">
                  <Badge tone={c.days_until === 0 ? "accent" : c.days_until <= 30 ? "neutral" : "neutral"}>
                    {untilLabel(c.days_until)}
                  </Badge>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="ghost" size="sm" onClick={() => startEdit(c)}>
                      Edit
                    </Button>
                    <Button type="button" variant="danger" size="sm" onClick={() => handleDelete(c)}>
                      Delete
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
