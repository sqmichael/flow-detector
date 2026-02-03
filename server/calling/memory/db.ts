/**
 * Memory Layer Database
 *
 * SQLite storage for themes and preferences.
 * Local-first, no cloud sync.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(__dirname, "..", "data", "memory.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL"); // Better concurrent access
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const database = db!;

  // Themes table - cross-session memories with decay
  database.exec(`
    CREATE TABLE IF NOT EXISTS themes (
      id TEXT PRIMARY KEY,
      theme TEXT NOT NULL,
      context TEXT NOT NULL,
      last_mentioned INTEGER NOT NULL,
      expires INTEGER NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('call', 'explicit'))
    )
  `);

  // Preferences table - permanent user preferences
  database.exec(`
    CREATE TABLE IF NOT EXISTS preferences (
      id TEXT PRIMARY KEY,
      preference TEXT NOT NULL,
      created INTEGER NOT NULL
    )
  `);

  // Index for expiry cleanup
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_themes_expires ON themes(expires)
  `);
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
