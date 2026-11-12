import fs from 'node:fs';
import path from 'node:path';
import { getStorageDir, getDbPath } from '../core/storage-paths.js';

export { getDbPath };

let DatabaseSync = null;
let isSqliteSupported = false;

try {
  const sqliteModule = await import('node:sqlite');
  if (sqliteModule && sqliteModule.DatabaseSync) {
    DatabaseSync = sqliteModule.DatabaseSync;
    isSqliteSupported = true;
  }
} catch {
  isSqliteSupported = false;
}

export function isSqliteAvailable() {
  return isSqliteSupported;
}

let dbInstance = null;

export function resetDatabaseInstance() {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {}
    dbInstance = null;
  }
}

/**
 * Initializes and returns the SQLite database instance with WAL mode, busy timeout, and schema migrations.
 */
export function getDatabase() {
  if (!isSqliteSupported) return null;
  if (dbInstance) return dbInstance;

  try {
    const dbPath = getDbPath();
    const dbDir = path.dirname(dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const db = new DatabaseSync(dbPath);

    // Concurrency and WAL mode optimization
    try {
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA synchronous = NORMAL;
      `);
    } catch {}

    // Migration check for workspace_id partitioning
    try {
      const tableInfo = db.prepare('PRAGMA table_info(memories)').all();
      const hasWorkspaceId = tableInfo.some(col => col.name === 'workspace_id');
      if (tableInfo.length > 0 && !hasWorkspaceId) {
        db.exec(`
          DROP TABLE IF EXISTS memories;
          DROP TABLE IF EXISTS memories_fts;
          DROP TABLE IF EXISTS memories_graph;
        `);
      }
    } catch {}

    // Initialize core schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        val TEXT
      );

      CREATE TABLE IF NOT EXISTS memories (
        workspace_id TEXT,
        layer TEXT,
        slug TEXT,
        domain TEXT,
        type TEXT,
        verified TEXT,
        trigger TEXT,
        path TEXT,
        mtime INTEGER,
        trigger_vector TEXT,
        content_vector TEXT,
        entity_vector TEXT,
        team_slug TEXT,
        PRIMARY KEY (workspace_id, layer, slug)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        slug,
        domain,
        type,
        trigger,
        content,
        layer UNINDEXED,
        workspace_id UNINDEXED,
        tokenize='porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS memories_graph (
        workspace_id TEXT,
        source_slug TEXT,
        target_slug TEXT,
        rel_type TEXT,
        PRIMARY KEY (workspace_id, source_slug, target_slug, rel_type)
      );

      CREATE TABLE IF NOT EXISTS telemetry (
        slug TEXT PRIMARY KEY,
        recalled_count INTEGER DEFAULT 0,
        applied_count INTEGER DEFAULT 0,
        test_pass_count INTEGER DEFAULT 0,
        test_fail_count INTEGER DEFAULT 0,
        efficacy_score REAL DEFAULT 1.0,
        last_recalled TEXT,
        last_applied TEXT,
        last_feedback TEXT
      );
    `);

    // Ensure migration columns exist for existing databases
    try {
      const cols = db.prepare('PRAGMA table_info(memories)').all();
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('trigger_vector')) {
        db.exec(`
          ALTER TABLE memories ADD COLUMN trigger_vector TEXT;
          ALTER TABLE memories ADD COLUMN content_vector TEXT;
          ALTER TABLE memories ADD COLUMN entity_vector TEXT;
        `);
      }
      if (!colNames.has('team_slug')) {
        db.exec(`
          ALTER TABLE memories ADD COLUMN team_slug TEXT;
        `);
      }
    } catch {}

    try {
      const teleCols = db.prepare('PRAGMA table_info(telemetry)').all();
      const teleColNames = new Set(teleCols.map(c => c.name));
      if (!teleColNames.has('test_pass_count')) {
        db.exec(`
          ALTER TABLE telemetry ADD COLUMN test_pass_count INTEGER DEFAULT 0;
          ALTER TABLE telemetry ADD COLUMN test_fail_count INTEGER DEFAULT 0;
          ALTER TABLE telemetry ADD COLUMN efficacy_score REAL DEFAULT 1.0;
          ALTER TABLE telemetry ADD COLUMN last_feedback TEXT;
        `);
      }
    } catch {}

    dbInstance = db;
    return dbInstance;
  } catch (err) {
    dbInstance = null;
    return null;
  }
}
