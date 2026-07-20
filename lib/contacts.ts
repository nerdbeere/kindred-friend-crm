import { getDb } from "./db";
export { fullName } from "./contact-format";

export interface Contact {
  id: number;
  first_name: string;
  last_name: string;
  birth_month: number;
  birth_day: number;
  birth_year: number | null;
  notes: string;
}

export interface ContactInput {
  first_name: string;
  last_name?: string;
  birth_month: number;
  birth_day: number;
  birth_year?: number | null;
  notes?: string;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Validates contact input, returning an error message or null when valid. */
export function validateContact(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return "Invalid body";
  const c = input as Record<string, unknown>;

  if (typeof c.first_name !== "string" || c.first_name.trim().length === 0)
    return "First name is required";
  if (c.first_name.length > 200) return "First name is too long";

  if (
    c.last_name !== undefined &&
    c.last_name !== null &&
    (typeof c.last_name !== "string" || c.last_name.length > 200)
  )
    return "Last name is too long";

  if (
    typeof c.birth_month !== "number" ||
    !Number.isInteger(c.birth_month) ||
    c.birth_month < 1 ||
    c.birth_month > 12
  )
    return "Birth month must be an integer between 1 and 12";

  if (
    typeof c.birth_day !== "number" ||
    !Number.isInteger(c.birth_day) ||
    c.birth_day < 1 ||
    c.birth_day > DAYS_IN_MONTH[c.birth_month - 1]
  )
    return "Birth day is not valid for the given month";

  if (
    c.birth_year !== null &&
    c.birth_year !== undefined &&
    (typeof c.birth_year !== "number" ||
      !Number.isInteger(c.birth_year) ||
      c.birth_year < 1800 ||
      c.birth_year > new Date().getFullYear())
  )
    return "Birth year must be an integer between 1800 and the current year";

  if (
    c.notes !== undefined &&
    c.notes !== null &&
    (typeof c.notes !== "string" || c.notes.length > 10000)
  )
    return "Notes must be text under 10000 characters";

  return null;
}

/**
 * Days from today until the next occurrence of a month/day birthday.
 * Feb 29 falls on Mar 1 in non-leap years (JS date rollover), which is fine.
 */
export function daysUntilBirthday(month: number, day: number): number {
  const now = new Date();
  const todayUtc = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  let nextUtc = Date.UTC(now.getFullYear(), month - 1, day);
  if (nextUtc < todayUtc) {
    nextUtc = Date.UTC(now.getFullYear() + 1, month - 1, day);
  }
  return Math.round((nextUtc - todayUtc) / 86_400_000);
}

/** All contacts, sorted by upcoming birthday (soonest first). */
export function listContacts(): Contact[] {
  const rows = getDb()
    .prepare(
      "SELECT id, first_name, last_name, birth_month, birth_day, birth_year, notes FROM contacts",
    )
    .all() as Contact[];
  return rows.sort(
    (a, b) =>
      daysUntilBirthday(a.birth_month, a.birth_day) -
      daysUntilBirthday(b.birth_month, b.birth_day),
  );
}

export function getContact(id: number): Contact | undefined {
  return getDb()
    .prepare(
      "SELECT id, first_name, last_name, birth_month, birth_day, birth_year, notes FROM contacts WHERE id = ?",
    )
    .get(id) as Contact | undefined;
}

export function createContact(input: ContactInput): Contact {
  const result = getDb()
    .prepare(
      `INSERT INTO contacts (first_name, last_name, birth_month, birth_day, birth_year, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.first_name.trim(),
      (input.last_name ?? "").trim(),
      input.birth_month,
      input.birth_day,
      input.birth_year ?? null,
      (input.notes ?? "").trim(),
    );
  return getContact(Number(result.lastInsertRowid))!;
}

export function updateContact(id: number, input: ContactInput): Contact | null {
  const result = getDb()
    .prepare(
      `UPDATE contacts
       SET first_name = ?, last_name = ?, birth_month = ?, birth_day = ?, birth_year = ?, notes = ?
       WHERE id = ?`,
    )
    .run(
      input.first_name.trim(),
      (input.last_name ?? "").trim(),
      input.birth_month,
      input.birth_day,
      input.birth_year ?? null,
      (input.notes ?? "").trim(),
      id,
    );
  if (result.changes === 0) return null;
  return getContact(id)!;
}

export function deleteContact(id: number): boolean {
  return getDb().prepare("DELETE FROM contacts WHERE id = ?").run(id).changes > 0;
}
