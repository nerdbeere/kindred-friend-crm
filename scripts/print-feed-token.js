#!/usr/bin/env node
/**
 * Prints the ICS feed token, creating one if it does not exist yet.
 * Used by the Proxmox setup script after the app is deployed.
 *
 * Usage: node scripts/print-feed-token.js
 * (DATABASE_PATH env var overrides the default ./data/kindred.db location)
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const dbPath =
  process.env.DATABASE_PATH || path.join(__dirname, "..", "data", "kindred.db");

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.exec(
  "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
);

let row = db
  .prepare("SELECT value FROM settings WHERE key = 'feed_token'")
  .get();
if (!row) {
  const token = crypto.randomBytes(24).toString("base64url");
  db.prepare("INSERT INTO settings (key, value) VALUES ('feed_token', ?)").run(
    token,
  );
  row = { value: token };
}

console.log(row.value);
