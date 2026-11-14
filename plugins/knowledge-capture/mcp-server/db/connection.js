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

    // Migration check for schema_version >= 2 (multi-team/subdir path keys, graph source_layer, binary BLOB vectors)
    let needsV2Migration = false;
    try {
      const tableInfo = db.prepare('PRAGMA table_info(memories)').all();
      const hasWorkspaceId = tableInfo.some(col => col.name === 'workspace_id');
      const hasMetaTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='meta'").get();
      let schemaVersion = null;
      if (hasMetaTable) {
        const verRow = db.prepare("SELECT val FROM meta WHERE key = 'schema_version'").get();
        schemaVersion = verRow ? verRow.val : null;
      }
      if (tableInfo.length > 0 && (!hasWorkspaceId || (schemaVersion !== '2' && schemaVersion !== '3'))) {
        needsV2Migration = true;
      }
    } catch {}

    if (needsV2Migration) {
      db.exec(`
        DROP TABLE IF EXISTS memories;
        DROP TABLE IF EXISTS memories_fts;
        DROP TABLE IF EXISTS memories_graph;
      `);
    }

    // Initialize core schema
    db.exec(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        val TEXT
      );

      CREATE TABLE IF NOT EXISTS memories (
        workspace_id TEXT NOT NULL,
        layer TEXT NOT NULL,
        team_slug TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL,
        slug TEXT NOT NULL,
        domain TEXT,
        type TEXT,
        verified TEXT,
        trigger TEXT,
        mtime INTEGER,
        trigger_vector BLOB,
        content_vector BLOB,
        entity_vector BLOB,
        PRIMARY KEY (workspace_id, layer, team_slug, path)
      );

      CREATE INDEX IF NOT EXISTS idx_memories_ws_slug ON memories(workspace_id, slug);

      CREATE TABLE IF NOT EXISTS memory_vectors (
        workspace_id TEXT NOT NULL,
        layer TEXT NOT NULL,
        team_slug TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        mtime INTEGER,
        trigger_vector BLOB,
        content_vector BLOB,
        entity_vector BLOB,
        PRIMARY KEY (workspace_id, layer, team_slug, path, dimensions)
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        slug,
        domain,
        type,
        trigger,
        content,
        layer UNINDEXED,
        workspace_id UNINDEXED,
        team_slug UNINDEXED,
        tokenize='porter unicode61'
      );

      CREATE TABLE IF NOT EXISTS memories_graph (
        workspace_id TEXT NOT NULL,
        source_layer TEXT NOT NULL DEFAULT 'workspace',
        source_team_slug TEXT NOT NULL DEFAULT '',
        source_slug TEXT NOT NULL,
        target_slug TEXT NOT NULL,
        rel_type TEXT NOT NULL,
        PRIMARY KEY (workspace_id, source_layer, source_team_slug, source_slug, target_slug, rel_type)
      );

      CREATE TABLE IF NOT EXISTS telemetry (
        workspace_id TEXT NOT NULL DEFAULT 'global',
        layer TEXT NOT NULL DEFAULT '',
        team_slug TEXT NOT NULL DEFAULT '',
        slug TEXT NOT NULL,
        recalled_count INTEGER DEFAULT 0,
        applied_count INTEGER DEFAULT 0,
        test_pass_count INTEGER DEFAULT 0,
        test_fail_count INTEGER DEFAULT 0,
        efficacy_score REAL DEFAULT 1.0,
        last_recalled TEXT,
        last_applied TEXT,
        last_feedback TEXT,
        PRIMARY KEY (workspace_id, layer, team_slug, slug)
      );
    `);

    try {
      const teleCols = db.prepare('PRAGMA table_info(telemetry)').all();
      const teleColNames = new Set(teleCols.map(c => c.name));
      if (teleCols.length > 0 && !teleColNames.has('workspace_id')) {
        const selectPass = teleColNames.has('test_pass_count') ? 'COALESCE(test_pass_count, 0)' : '0';
        const selectFail = teleColNames.has('test_fail_count') ? 'COALESCE(test_fail_count, 0)' : '0';
        const selectEff = teleColNames.has('efficacy_score') ? 'COALESCE(efficacy_score, 1.0)' : '1.0';
        const selectFeedback = teleColNames.has('last_feedback') ? 'last_feedback' : 'NULL';
        db.exec(`
          BEGIN IMMEDIATE;
          ALTER TABLE telemetry RENAME TO telemetry_legacy;
          CREATE TABLE telemetry (
            workspace_id TEXT NOT NULL DEFAULT 'global',
            layer TEXT NOT NULL DEFAULT '',
            team_slug TEXT NOT NULL DEFAULT '',
            slug TEXT NOT NULL,
            recalled_count INTEGER DEFAULT 0,
            applied_count INTEGER DEFAULT 0,
            test_pass_count INTEGER DEFAULT 0,
            test_fail_count INTEGER DEFAULT 0,
            efficacy_score REAL DEFAULT 1.0,
            last_recalled TEXT,
            last_applied TEXT,
            last_feedback TEXT,
            PRIMARY KEY (workspace_id, layer, team_slug, slug)
          );
          INSERT OR IGNORE INTO telemetry (
            workspace_id, layer, team_slug, slug,
            recalled_count, applied_count, test_pass_count, test_fail_count,
            efficacy_score, last_recalled, last_applied, last_feedback
          )
          SELECT
            'global', '', '', LOWER(TRIM(slug)),
            COALESCE(recalled_count, 0),
            COALESCE(applied_count, 0),
            ${selectPass},
            ${selectFail},
            ${selectEff},
            last_recalled,
            last_applied,
            ${selectFeedback}
          FROM telemetry_legacy;
          DROP TABLE telemetry_legacy;
          COMMIT;
        `);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_telemetry_ws_slug ON telemetry(workspace_id, slug);`);
    } catch {
      try { db.exec('ROLLBACK'); } catch {}
    }

    try {
      db.prepare("INSERT OR REPLACE INTO meta (key, val) VALUES ('schema_version', '3')").run();
    } catch {}

    dbInstance = db;
    return dbInstance;
  } catch (err) {
    dbInstance = null;
    return null;
  }
}
