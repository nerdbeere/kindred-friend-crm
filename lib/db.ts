import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

const globalForDb = globalThis as unknown as { db?: Database.Database };

/**
 * One-time migration from the old single `name` column to separate
 * `first_name` / `last_name` columns. No-op on fresh installs (which are
 * created with the new columns directly) and on databases that have
 * already been migrated.
 */
function migrateNameColumn(db: Database.Database): void {
  const columns = db.prepare("PRAGMA table_info(contacts)").all() as {
    name: string;
  }[];
  const hasOldName = columns.some((c) => c.name === "name");
  if (!hasOldName) return;

  const hasNewNames = columns.some((c) => c.name === "first_name");
  if (!hasNewNames) {
    db.exec("ALTER TABLE contacts ADD COLUMN first_name TEXT NOT NULL DEFAULT ''");
    db.exec("ALTER TABLE contacts ADD COLUMN last_name TEXT NOT NULL DEFAULT ''");
  }

  const rows = db
    .prepare("SELECT id, name FROM contacts")
    .all() as { id: number; name: string }[];
  const update = db.prepare(
    "UPDATE contacts SET first_name = ?, last_name = ? WHERE id = ?",
  );
  const migrateRows = db.transaction(() => {
    for (const row of rows) {
      const trimmed = (row.name ?? "").trim();
      const spaceIdx = trimmed.indexOf(" ");
      const first = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
      const last = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
      update.run(first || "Unknown", last, row.id);
    }
  });
  migrateRows();

  db.exec("ALTER TABLE contacts DROP COLUMN name");
}

export function getDb(): Database.Database {
  if (!globalForDb.db) {
    const dbPath =
      process.env.DATABASE_PATH ?? join(process.cwd(), "data", "kindred.db");
    mkdirSync(dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS contacts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name  TEXT    NOT NULL,
        last_name   TEXT    NOT NULL DEFAULT '',
        birth_month INTEGER NOT NULL,
        birth_day   INTEGER NOT NULL,
        birth_year  INTEGER,
        notes       TEXT    NOT NULL DEFAULT '',
        created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    migrateNameColumn(db);
    globalForDb.db = db;
  }
  return globalForDb.db;
}

/** Read a settings row by key. Returns null if absent. */
export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/** Upsert a settings row. Runs inside a transaction. */
export function setSetting(key: string, value: string): void {
  getDb()
    .prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) " +
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

/** True once an admin password hash exists in `settings`. Used by the setup wizard gate. */
export function isAdminConfigured(): boolean {
  return getSetting("admin_password_hash") !== null;
}

/**
 * Returns the secret ICS feed token. Uses the ICS_FEED_TOKEN env var when set,
 * otherwise generates one on first use and persists it in the settings table.
 */
export function getFeedToken(): string {
  if (process.env.ICS_FEED_TOKEN) return process.env.ICS_FEED_TOKEN;

  const db = getDb();
  const row = db
    .prepare("SELECT value FROM settings WHERE key = 'feed_token'")
    .get() as { value: string } | undefined;
  if (row) return row.value;

  const token = randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO settings (key, value) VALUES ('feed_token', ?)").run(
    token,
  );
  return token;
}
