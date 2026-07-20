/**
 * Pure, client-safe contact formatting helpers. Kept separate from
 * lib/contacts.ts because that file imports lib/db.ts (better-sqlite3),
 * which cannot be bundled into client components.
 */
export function fullName(c: { first_name: string; last_name: string }): string {
  return [c.first_name, c.last_name].filter(Boolean).join(" ");
}
