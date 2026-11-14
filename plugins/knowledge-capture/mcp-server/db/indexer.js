import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from './connection.js';
import { resolveStoragePaths, normalizeWorkspaceId } from '../core/storage-paths.js';
import { parseYamlFrontmatter, parseInlineArrayOrList } from '../core/yaml-parser.js';
import { findMarkdownFiles } from '../retrieval/shadow-resolver.js';
import { getActiveEmbeddingConfig } from '../embeddings/onnx-provider.js';
import { generateMultiVector, generateMultiVectorAsync } from '../embeddings/multi-vector.js';

/**
 * Serializes a numeric embedding array into a compact IEEE-754 Float32 binary Buffer.
 */
export function arrayToFloat32Buffer(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const f32 = new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

/**
 * Deserializes a Float32 binary BLOB (or legacy JSON string) back into a JS number array.
 */
export function bufferOrJsonToArray(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  if (val instanceof Uint8Array || Buffer.isBuffer(val)) {
    if (val.byteLength === 0) return null;
    if (val.byteLength % 4 === 0) {
      if (val[0] === 91) {
        try {
          const parsed = JSON.parse(Buffer.from(val).toString('utf8'));
          if (Array.isArray(parsed)) return parsed;
        } catch {}
      }
      const ab = new ArrayBuffer(val.byteLength);
      new Uint8Array(ab).set(val);
      return Array.from(new Float32Array(ab));
    }
    try {
      const parsed = JSON.parse(Buffer.from(val).toString('utf8'));
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Resolves the canonical list of active layer directories to index for a workspace.
 * Shared by syncSqliteCore, syncSqliteMetadataSync, and isIndexDirty so partition sets never diverge.
 */
export function getIndexLayerDirs(workspaceRoot = process.cwd()) {
  const paths = resolveStoragePaths(workspaceRoot);
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  const layerDirs = [
    { layer: 'workspace', wsId: currentWsId, dir: paths.workspaceDir, teamSlug: '' },
    { layer: 'private', wsId: 'global', dir: paths.privateDir, teamSlug: '' }
  ];

  if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
    for (const tRepo of paths.activeTeamDirs) {
      layerDirs.push({
        layer: 'team',
        wsId: 'global',
        dir: tRepo.dir,
        teamSlug: tRepo.slug || 'default'
      });
    }
  } else if (!paths.settings?.teamRepos || paths.settings.teamRepos.length === 0) {
    layerDirs.push({ layer: 'team', wsId: 'global', dir: paths.teamDir, teamSlug: 'default' });
  }

  return { layerDirs, currentWsId, paths };
}

/**
 * Loads cached multi-vectors from SQLite keyed by lowercase slug and layer+path when dimension matches active config.
 */
export function loadCachedVectorsMap(workspaceRoot = process.cwd()) {
  const cached = new Map();
  const db = getDatabase();
  if (!db) return cached;

  try {
    const activeConfig = getActiveEmbeddingConfig();
    const currentWsId = normalizeWorkspaceId(workspaceRoot);
    const rows = db.prepare(`
      SELECT layer, team_slug, slug, path, mtime, trigger_vector, content_vector, entity_vector
      FROM memories
      WHERE workspace_id = ? OR workspace_id = 'global'
    `).all(currentWsId);

    for (const r of rows) {
      let diskMtime = null;
      try {
        diskMtime = Math.floor(fs.statSync(r.path).mtimeMs);
      } catch {
        continue;
      }
      if (diskMtime !== r.mtime) continue;

      const tVec = bufferOrJsonToArray(r.trigger_vector);
      const cVec = bufferOrJsonToArray(r.content_vector);
      const eVec = bufferOrJsonToArray(r.entity_vector);
      if (
        tVec && cVec && eVec &&
        tVec.length === activeConfig.dimensions &&
        cVec.length === activeConfig.dimensions &&
        eVec.length === activeConfig.dimensions
      ) {
        const vecObj = {
          trigger_vector: tVec,
          content_vector: cVec,
          entity_vector: eVec
        };
        cached.set(`${r.layer}:${r.team_slug || ''}:${r.path}`, vecObj);
        cached.set(r.slug.toLowerCase(), vecObj);
      }
    }
  } catch {}
  return cached;
}

function collectPendingDiskState(db, workspaceRoot, activeConfig, checkVectors) {
  const { layerDirs, currentWsId } = getIndexLayerDirs(workspaceRoot);
  const currentFiles = new Map();

  for (const { layer, wsId, dir, teamSlug } of layerDirs) {
    const files = findMarkdownFiles(dir);
    for (const filePath of files) {
      const base = path.basename(filePath, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const stats = fs.statSync(filePath);
        const mtime = Math.floor(stats.mtimeMs);
        const key = `${wsId}:${layer}:${teamSlug}:${filePath}`;
        currentFiles.set(key, { wsId, layer, teamSlug, base, filePath, mtime });
      } catch {}
    }
  }

  const existingRows = db.prepare(`
    SELECT workspace_id, layer, team_slug, path, slug, mtime, trigger_vector, content_vector, entity_vector
    FROM memories
    WHERE workspace_id = ? OR workspace_id = 'global'
  `).all(currentWsId);

  const existingMap = new Map();
  for (const row of existingRows) {
    let hasValidVector = false;
    if (checkVectors && row.trigger_vector && row.content_vector && row.entity_vector) {
      const tv = bufferOrJsonToArray(row.trigger_vector);
      const cv = bufferOrJsonToArray(row.content_vector);
      const ev = bufferOrJsonToArray(row.entity_vector);
      if (
        Array.isArray(tv) && tv.length === activeConfig.dimensions &&
        Array.isArray(cv) && cv.length === activeConfig.dimensions &&
        Array.isArray(ev) && ev.length === activeConfig.dimensions
      ) {
        hasValidVector = true;
      }
    }
    const key = `${row.workspace_id}:${row.layer}:${row.team_slug || ''}:${row.path}`;
    existingMap.set(key, { slug: row.slug, mtime: row.mtime, hasValidVector });
  }

  return { currentFiles, existingRows, existingMap };
}

function parseEntryForSync(item) {
  const rawContent = fs.readFileSync(item.filePath, 'utf8');
  const parsed = parseYamlFrontmatter(rawContent);
  const fm = parsed.frontmatter;
  return {
    item,
    slug: (fm.slug || fm.name || item.base).replace(/\.md$/i, ''),
    domain: fm.domain || 'general',
    type: fm.type || 'general',
    verified: fm.verified || '',
    trigger: fm.description || fm.trigger || '',
    body: parsed.body,
    fm,
    multiVec: null
  };
}

function flushSyncToDatabase(db, currentFiles, existingRows, pendingUpdates, writeVectors) {
  const insertMetaWithVec = db.prepare(`
    INSERT INTO memories (
      workspace_id, layer, team_slug, path, slug, domain, type, verified, trigger, mtime,
      trigger_vector, content_vector, entity_vector
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, layer, team_slug, path) DO UPDATE SET
      slug=excluded.slug,
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      mtime=excluded.mtime,
      trigger_vector=excluded.trigger_vector,
      content_vector=excluded.content_vector,
      entity_vector=excluded.entity_vector
  `);

  const insertMetaNoVec = db.prepare(`
    INSERT INTO memories (
      workspace_id, layer, team_slug, path, slug, domain, type, verified, trigger, mtime
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, layer, team_slug, path) DO UPDATE SET
      slug=excluded.slug,
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      mtime=excluded.mtime,
      trigger_vector=NULL,
      content_vector=NULL,
      entity_vector=NULL
  `);

  const deleteFts = db.prepare('DELETE FROM memories_fts WHERE workspace_id = ? AND layer = ? AND team_slug = ? AND slug = ?');
  const insertFts = db.prepare(`
    INSERT INTO memories_fts (slug, domain, type, trigger, content, layer, workspace_id, team_slug)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteGraph = db.prepare('DELETE FROM memories_graph WHERE workspace_id = ? AND source_layer = ? AND source_team_slug = ? AND source_slug = ?');
  const insertGraph = db.prepare(`
    INSERT OR IGNORE INTO memories_graph (workspace_id, source_layer, source_team_slug, source_slug, target_slug, rel_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const u of pendingUpdates) {
      if (writeVectors && u.multiVec) {
        insertMetaWithVec.run(
          u.item.wsId,
          u.item.layer,
          u.item.teamSlug,
          u.item.filePath,
          u.slug,
          u.domain,
          u.type,
          u.verified,
          u.trigger,
          u.item.mtime,
          arrayToFloat32Buffer(u.multiVec.trigger_vector),
          arrayToFloat32Buffer(u.multiVec.content_vector),
          arrayToFloat32Buffer(u.multiVec.entity_vector)
        );
      } else {
        insertMetaNoVec.run(
          u.item.wsId,
          u.item.layer,
          u.item.teamSlug,
          u.item.filePath,
          u.slug,
          u.domain,
          u.type,
          u.verified,
          u.trigger,
          u.item.mtime
        );
      }

      if (u.prevSlug && u.prevSlug !== u.slug) {
        deleteFts.run(u.item.wsId, u.item.layer, u.item.teamSlug, u.prevSlug);
        deleteGraph.run(u.item.wsId, u.item.layer, u.item.teamSlug, u.prevSlug);
      }
      deleteFts.run(u.item.wsId, u.item.layer, u.item.teamSlug, u.slug);
      insertFts.run(u.slug, u.domain, u.type, u.trigger, u.body, u.item.layer, u.item.wsId, u.item.teamSlug);

      deleteGraph.run(u.item.wsId, u.item.layer, u.item.teamSlug, u.slug);
      if (Array.isArray(u.fm.related)) {
        for (const rel of u.fm.related) {
          if (rel) insertGraph.run(u.item.wsId, u.item.layer, u.item.teamSlug, u.slug, rel, 'related');
        }
      }
      if (u.fm.overrides) {
        const overridesList = parseInlineArrayOrList(u.fm.overrides);
        for (const ov of overridesList) {
          if (ov) insertGraph.run(u.item.wsId, u.item.layer, u.item.teamSlug, u.slug, ov, 'overrides');
        }
      }
    }

    const deleteMeta = db.prepare('DELETE FROM memories WHERE workspace_id = ? AND layer = ? AND team_slug = ? AND path = ?');
    for (const row of existingRows) {
      const teamSlug = row.team_slug || '';
      const key = `${row.workspace_id}:${row.layer}:${teamSlug}:${row.path}`;
      if (!currentFiles.has(key)) {
        deleteMeta.run(row.workspace_id, row.layer, teamSlug, row.path);
        deleteFts.run(row.workspace_id, row.layer, teamSlug, row.slug);
        deleteGraph.run(row.workspace_id, row.layer, teamSlug, row.slug);
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { totalIndexed: currentFiles.size };
}

/**
 * Synchronous metadata, FTS5, and graph sync sharing exact Schema v2 logic.
 */
export function syncSqliteMetadataSync(workspaceRoot = process.cwd()) {
  const db = getDatabase();
  if (!db) {
    return { totalIndexed: 0 };
  }
  const { currentFiles, existingRows, existingMap } = collectPendingDiskState(db, workspaceRoot, null, false);
  const pendingUpdates = [];
  for (const [key, item] of currentFiles.entries()) {
    const prev = existingMap.get(key);
    if (prev && prev.mtime === item.mtime) continue;
    try {
      const entryData = parseEntryForSync(item);
      entryData.prevSlug = prev ? prev.slug : null;
      pendingUpdates.push(entryData);
    } catch {}
  }
  return flushSyncToDatabase(db, currentFiles, existingRows, pendingUpdates, false);
}

/**
 * Asynchronous full SQLite synchronization engine (metadata, FTS5, graph edges, and binary BLOB vectors).
 */
export async function syncSqliteCore(workspaceRoot = process.cwd(), { computeVectors = true } = {}) {
  if (!computeVectors) {
    return syncSqliteMetadataSync(workspaceRoot);
  }

  const db = getDatabase();
  if (!db) {
    return { totalIndexed: 0, fileBasedFallback: true };
  }

  const activeConfig = getActiveEmbeddingConfig();

  let storedDim = null;
  try {
    const row = db.prepare('SELECT val FROM meta WHERE key = ?').get('embedding_dim');
    if (row && row.val) storedDim = parseInt(row.val, 10);
  } catch {}

  if (storedDim && storedDim !== activeConfig.dimensions) {
    db.exec(`UPDATE memories SET trigger_vector = NULL, content_vector = NULL, entity_vector = NULL;`);
  }
  try {
    db.prepare('INSERT OR REPLACE INTO meta (key, val) VALUES (?, ?)').run('embedding_engine', activeConfig.engine);
    db.prepare('INSERT OR REPLACE INTO meta (key, val) VALUES (?, ?)').run('embedding_dim', String(activeConfig.dimensions));
  } catch {}

  const { currentFiles, existingRows, existingMap } = collectPendingDiskState(db, workspaceRoot, activeConfig, true);
  const pendingUpdates = [];

  for (const [key, item] of currentFiles.entries()) {
    const prev = existingMap.get(key);
    if (prev && prev.mtime === item.mtime && prev.hasValidVector) {
      continue;
    }
    try {
      const entryData = parseEntryForSync(item);
      entryData.prevSlug = prev ? prev.slug : null;
      if (activeConfig.engine === 'onnx') {
        entryData.multiVec = await generateMultiVectorAsync({
          trigger: entryData.trigger,
          body: entryData.body,
          slug: entryData.slug,
          domain: entryData.domain,
          type: entryData.type,
          related: entryData.fm.related
        });
      } else {
        entryData.multiVec = generateMultiVector({
          trigger: entryData.trigger,
          body: entryData.body,
          slug: entryData.slug,
          domain: entryData.domain,
          type: entryData.type,
          related: entryData.fm.related
        });
      }
      pendingUpdates.push(entryData);
    } catch {}
  }

  return flushSyncToDatabase(db, currentFiles, existingRows, pendingUpdates, true);
}
