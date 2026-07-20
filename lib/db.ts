import Database from "better-sqlite3";
import { randomBytes } from "crypto";
import { mkdirSync } from "fs";
import { dirname, join } from "path";

const globalForDb = globalThis as unknown as { db?: Database.Database };

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
        name        TEXT    NOT NULL,
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
    globalForDb.db = db;
  }
  return globalForDb.db;
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
