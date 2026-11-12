import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveStoragePaths,
  findMarkdownFiles,
  parseYamlFrontmatter,
  scanLayerEntries,
  atomicWriteFileSync
} from './memory-service.js';

/**
 * sqlite-index.js
 * 
 * High-performance, workspace-partitioned SQLite FTS5 & Graph index cache for Knowledge Capture
 * with zero-dependency file-based fallback when SQLite is unavailable.
 * Stored at ~/.gemini/knowledge-capture/cache.sqlite.
 * Flat Markdown files remain the canonical version-controlled source of truth.
 */

// Dynamically import node:sqlite to ensure resilience across Node runtimes
let DatabaseSync = null;
let isSqliteSupported = false;

try {
  const mod = await import('node:sqlite').catch(() => null);
  if (mod && typeof mod.DatabaseSync === 'function') {
    DatabaseSync = mod.DatabaseSync;
    isSqliteSupported = true;
  }
} catch {
  isSqliteSupported = false;
}

export function isSqliteAvailable() {
  return isSqliteSupported;
}

export function getStorageDir() {
  const dir = process.env.KC_STORAGE_DIR || (
    process.env.GEMINI_HOME
      ? path.join(process.env.GEMINI_HOME, 'knowledge-capture')
      : path.join(os.homedir(), '.gemini', 'knowledge-capture')
  );
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function getDbPath() {
  return path.join(getStorageDir(), 'cache.sqlite');
}

export function getTelemetryJsonPath() {
  return path.join(getStorageDir(), 'telemetry.json');
}

export function normalizeWorkspaceId(workspaceRoot) {
  if (!workspaceRoot || typeof workspaceRoot !== 'string') {
    return 'default';
  }
  return path.resolve(workspaceRoot).replace(/\\/g, '/').toLowerCase();
}

let dbInstance = null;

export function getDatabase() {
  if (!isSqliteSupported) return null;
  if (dbInstance) return dbInstance;

  try {
    const dbPath = getDbPath();
    const db = new DatabaseSync(dbPath);

    // Concurrency and WAL mode optimization
    try {
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
      `);
    } catch {}

    // Check if migration is needed from unpartitioned schema
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

    // Initialize Schema with workspace partitioning (Option A: guardrails removed)
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

    // Ensure multi-vector columns exist for existing databases
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
    } catch {}

    // Ensure telemetry efficacy columns exist for existing databases
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

/**
 * Tokenizes text into a normalized set of lowercase words.
 */
export function tokenizeText(str) {
  if (!str || typeof str !== 'string') return [];
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(tok => tok.length > 1);
}

/**
 * Computes Cosine Similarity between two token frequency bags.
 */
export function computeCosineSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const freqA = new Map();
  const freqB = new Map();

  for (const t of tokensA) freqA.set(t, (freqA.get(t) || 0) + 1);
  for (const t of tokensB) freqB.set(t, (freqB.get(t) || 0) + 1);

  let dotProduct = 0;
  for (const [t, countA] of freqA.entries()) {
    if (freqB.has(t)) {
      dotProduct += countA * freqB.get(t);
    }
  }

  let magA = 0;
  for (const count of freqA.values()) magA += count * count;
  let magB = 0;
  for (const count of freqB.values()) magB += count * count;

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Generates a deterministic dense 128-dimensional embedding vector from text.
 * Uses subword n-grams and double hashing with sign hashing and L2 normalization.
 * Pure JS, zero external dependencies, deterministic across all platforms.
 */
export function generateDenseEmbedding(text, dimensions = 128) {
  const vec = new Float64Array(dimensions);
  if (!text || typeof text !== 'string') return Array.from(vec);

  const clean = text.toLowerCase().replace(/[^\w\s-]/g, ' ');
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return Array.from(vec);

  const features = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    features.push(`w:${w}`);
    if (w.length >= 3) {
      for (let j = 0; j <= w.length - 3; j++) {
        features.push(`3:${w.slice(j, j + 3)}`);
      }
    }
    if (w.length >= 4) {
      for (let j = 0; j <= w.length - 4; j++) {
        features.push(`4:${w.slice(j, j + 4)}`);
      }
    }
    if (i < words.length - 1) {
      features.push(`b:${w}_${words[i + 1]}`);
    }
  }

  // Double-hash: bucket index + sign hashing to avoid collision bias
  for (const feat of features) {
    let h1 = 5381;
    let h2 = 2166136261;
    for (let i = 0; i < feat.length; i++) {
      const code = feat.charCodeAt(i);
      h1 = ((h1 << 5) + h1) ^ code;
      h2 = (h2 ^ code) * 16777619;
    }
    const idx = Math.abs(h1) % dimensions;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  // L2 normalization: ||v|| = 1.0
  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) vec[i] = Number((vec[i] / norm).toFixed(6));
  }

  return Array.from(vec);
}

/**
 * Computes dot product (cosine similarity between L2-normalized dense vectors).
 */
export function computeDenseCosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1.0, dot));
}

let onnxPipelinePromise = null;
let onnxLoadFailed = false;

export function resetOnnxState() {
  onnxPipelinePromise = null;
  onnxLoadFailed = false;
}

/**
 * Returns active embedding configuration from environment or settings.json.
 * Defaults to 'onnx' (384 dimensions) with automatic graceful fallback to 'heuristic' (128 dimensions).
 */
export function getActiveEmbeddingConfig() {
  const envChoice = process.env.KC_EMBEDDING_ENGINE;
  if (envChoice) {
    if (envChoice === 'onnx') return { engine: 'onnx', dimensions: 384 };
    return { engine: 'heuristic', dimensions: 128 };
  }

  try {
    const settingsPath = path.join(getStorageDir(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.embeddingEngine === 'onnx') {
        return { engine: 'onnx', dimensions: 384 };
      }
      if (settings.embeddingEngine === 'heuristic') {
        return { engine: 'heuristic', dimensions: 128 };
      }
    }
  } catch {}

  return { engine: 'onnx', dimensions: 384 };
}

/**
 * Dynamically loads the ONNX feature extraction pipeline on demand.
 * Caches the pipeline promise and model locally. If loading fails, marks failure and returns null.
 */
export async function getOnnxExtractor() {
  if (onnxLoadFailed) return null;
  if (onnxPipelinePromise) return onnxPipelinePromise;

  onnxPipelinePromise = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = path.join(getStorageDir(), 'models');
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true
      });
      return extractor;
    } catch (err) {
      onnxLoadFailed = true;
      return null;
    }
  })();

  return onnxPipelinePromise;
}

/**
 * Generates an embedding vector using the configured engine.
 * Primary: Local ONNX Transformer (all-MiniLM-L6-v2, 384-d).
 * Fallback: Heuristic Vector Engine (subword & bigram double-hash, 128-d).
 */
export async function generateEmbedding(text, targetDimensions = null) {
  const config = getActiveEmbeddingConfig();
  if (config.engine === 'onnx') {
    try {
      const extractor = await getOnnxExtractor();
      if (extractor && text && typeof text === 'string' && text.trim().length > 0) {
        const out = await extractor(text.slice(0, 2048), { pooling: 'mean', normalize: true });
        return Array.from(out.data);
      }
    } catch {
      // Graceful fallback to heuristic
    }
  }
  const dim = targetDimensions || (config.engine === 'onnx' ? 384 : 128);
  return generateDenseEmbedding(text, dim);
}

/**
 * Generates synchronous multi-vector representation (128-d heuristic fallback).
 */
export function generateMultiVector(entry) {
  const triggerText = `${entry.trigger || entry.description || ''}`;
  const contentText = typeof entry.body === 'string' ? entry.body : (entry.content || '');
  const entityText = `${entry.slug || ''} ${entry.domain || ''} ${entry.type || ''} ${(entry.related || []).join(' ')}`;

  return {
    trigger_vector: generateDenseEmbedding(triggerText, 128),
    content_vector: generateDenseEmbedding(contentText, 128),
    entity_vector: generateDenseEmbedding(entityText, 128)
  };
}

/**
 * Generates asynchronous multi-vector representation across 3 facets: trigger, content, entity.
 * Uses active embedding provider (Local ONNX 384-d or Heuristic 128-d).
 */
export async function generateMultiVectorAsync(entry) {
  const triggerText = `${entry.trigger || entry.description || ''}`;
  const contentText = typeof entry.body === 'string' ? entry.body : (entry.content || '');
  const entityText = `${entry.slug || ''} ${entry.domain || ''} ${entry.type || ''} ${(entry.related || []).join(' ')}`;

  const [tVec, cVec, eVec] = await Promise.all([
    generateEmbedding(triggerText),
    generateEmbedding(contentText),
    generateEmbedding(entityText)
  ]);

  return {
    trigger_vector: tVec,
    content_vector: cVec,
    entity_vector: eVec
  };
}

/**
 * Computes composite Multi-Vector similarity between query vector and memory multi-vector facets.
 * Weights: 50% trigger/intent, 35% content/rule, 15% entity/metadata.
 */
export function computeMultiVectorSimilarity(queryVec, multiVec) {
  if (!queryVec || !multiVec) return 0;
  const sTrigger = computeDenseCosineSimilarity(queryVec, multiVec.trigger_vector);
  const sContent = computeDenseCosineSimilarity(queryVec, multiVec.content_vector);
  const sEntity = computeDenseCosineSimilarity(queryVec, multiVec.entity_vector);

  return (sTrigger * 0.50) + (sContent * 0.35) + (sEntity * 0.15);
}

/**
 * Synchronously synchronizes file metadata, FTS5 text, and graph relationships into SQLite.
 * Used for fast synchronous queries such as knowledge graph rendering without blocking on embeddings.
 */
export function syncSqliteMetadata(workspaceRoot = process.cwd()) {
  const db = getDatabase();
  if (!db) {
    return { totalIndexed: 0 };
  }

  const paths = resolveStoragePaths(workspaceRoot);
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  const layerDirs = [
    { layer: 'workspace', wsId: currentWsId, dir: paths.workspaceDir },
    { layer: 'private', wsId: 'global', dir: paths.privateDir },
    { layer: 'team', wsId: 'global', dir: paths.teamDir }
  ];

  const currentFiles = new Map();

  for (const { layer, wsId, dir } of layerDirs) {
    const files = findMarkdownFiles(dir);
    for (const filePath of files) {
      const base = path.basename(filePath, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const stats = fs.statSync(filePath);
        const mtime = Math.floor(stats.mtimeMs);
        currentFiles.set(`${wsId}:${layer}:${base}`, { wsId, layer, slug: base, filePath, mtime });
      } catch {}
    }
  }

  const existingRows = db.prepare(`
    SELECT workspace_id, layer, slug, mtime 
    FROM memories 
    WHERE workspace_id = ? OR workspace_id = 'global'
  `).all(currentWsId);

  const existingMap = new Map();
  for (const row of existingRows) {
    existingMap.set(`${row.workspace_id}:${row.layer}:${row.slug}`, row.mtime);
  }

  const insertMetaNoVec = db.prepare(`
    INSERT INTO memories (
      workspace_id, layer, slug, domain, type, verified, trigger, path, mtime
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, layer, slug) DO UPDATE SET
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      path=excluded.path,
      mtime=excluded.mtime
  `);

  const deleteFts = db.prepare('DELETE FROM memories_fts WHERE workspace_id = ? AND layer = ? AND slug = ?');
  const insertFts = db.prepare(`
    INSERT INTO memories_fts (slug, domain, type, trigger, content, layer, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteGraph = db.prepare('DELETE FROM memories_graph WHERE workspace_id = ? AND source_slug = ?');
  const insertGraph = db.prepare(`
    INSERT OR IGNORE INTO memories_graph (workspace_id, source_slug, target_slug, rel_type)
    VALUES (?, ?, ?, ?)
  `);

  for (const [key, item] of currentFiles.entries()) {
    const prevMtime = existingMap.get(key);
    if (prevMtime && prevMtime === item.mtime) {
      continue;
    }

    try {
      const rawContent = fs.readFileSync(item.filePath, 'utf8');
      const parsed = parseYamlFrontmatter(rawContent);
      const fm = parsed.frontmatter;

      const domain = fm.domain || 'general';
      const type = fm.type || 'general';
      const verified = fm.verified || '';
      const trigger = fm.description || fm.trigger || '';

      insertMetaNoVec.run(
        item.wsId,
        item.layer,
        item.slug,
        domain,
        type,
        verified,
        trigger,
        item.filePath,
        item.mtime
      );

      deleteFts.run(item.wsId, item.layer, item.slug);
      insertFts.run(item.slug, domain, type, trigger, parsed.body, item.layer, item.wsId);

      deleteGraph.run(item.wsId, item.slug);
      if (Array.isArray(fm.related)) {
        for (const rel of fm.related) {
          if (rel) insertGraph.run(item.wsId, item.slug, rel, 'related');
        }
      }
      if (fm.overrides) {
        const overridesList = Array.isArray(fm.overrides) ? fm.overrides : [fm.overrides];
        for (const ov of overridesList) {
          if (ov) insertGraph.run(item.wsId, item.slug, ov, 'overrides');
        }
      }
    } catch {}
  }

  const deleteMeta = db.prepare('DELETE FROM memories WHERE workspace_id = ? AND layer = ? AND slug = ?');
  for (const row of existingRows) {
    const key = `${row.workspace_id}:${row.layer}:${row.slug}`;
    if (!currentFiles.has(key)) {
      deleteMeta.run(row.workspace_id, row.layer, row.slug);
      deleteFts.run(row.workspace_id, row.layer, row.slug);
      deleteGraph.run(row.workspace_id, row.slug);
    }
  }

  return { totalIndexed: currentFiles.size };
}

/**
 * Incrementally synchronizes SQLite index with filesystem markdown files.
 * Uses workspace_id partitioning and Adaptive Dimension Storage.
 * Generates vectors using active embedding provider (Local ONNX or Heuristic).
 */
export async function syncSqliteIndex(workspaceRoot = process.cwd()) {
  const db = getDatabase();
  if (!db) {
    return { totalIndexed: 0, fileBasedFallback: true };
  }

  const activeConfig = getActiveEmbeddingConfig();

  // Adaptive Dimension Storage Check
  let storedDim = null;
  try {
    const row = db.prepare('SELECT val FROM meta WHERE key = ?').get('embedding_dim');
    if (row && row.val) storedDim = parseInt(row.val, 10);
  } catch {}

  if (storedDim && storedDim !== activeConfig.dimensions) {
    // Dimension changed across engines: invalidate cached vectors so entries re-embed
    db.exec(`UPDATE memories SET trigger_vector = NULL, content_vector = NULL, entity_vector = NULL;`);
  }
  try {
    db.prepare('INSERT OR REPLACE INTO meta (key, val) VALUES (?, ?)').run('embedding_engine', activeConfig.engine);
    db.prepare('INSERT OR REPLACE INTO meta (key, val) VALUES (?, ?)').run('embedding_dim', String(activeConfig.dimensions));
  } catch {}

  const paths = resolveStoragePaths(workspaceRoot);
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  const layerDirs = [
    { layer: 'workspace', wsId: currentWsId, dir: paths.workspaceDir },
    { layer: 'private', wsId: 'global', dir: paths.privateDir },
    { layer: 'team', wsId: 'global', dir: paths.teamDir }
  ];

  const currentFiles = new Map(); // key: "wsId:layer:slug" -> file info

  for (const { layer, wsId, dir } of layerDirs) {
    const files = findMarkdownFiles(dir);
    for (const filePath of files) {
      const base = path.basename(filePath, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const stats = fs.statSync(filePath);
        const mtime = Math.floor(stats.mtimeMs);
        currentFiles.set(`${wsId}:${layer}:${base}`, { wsId, layer, slug: base, filePath, mtime });
      } catch {}
    }
  }

  // Find existing indexed records for current workspace and global layers
  const existingRows = db.prepare(`
    SELECT workspace_id, layer, slug, mtime, trigger_vector 
    FROM memories 
    WHERE workspace_id = ? OR workspace_id = 'global'
  `).all(currentWsId);

  const existingMap = new Map();
  for (const row of existingRows) {
    let hasValidVector = false;
    if (row.trigger_vector) {
      try {
        const v = JSON.parse(row.trigger_vector);
        if (Array.isArray(v) && v.length === activeConfig.dimensions) {
          hasValidVector = true;
        }
      } catch {}
    }
    existingMap.set(`${row.workspace_id}:${row.layer}:${row.slug}`, { mtime: row.mtime, hasValidVector });
  }

  // Prepared Statements
  const insertMeta = db.prepare(`
    INSERT INTO memories (
      workspace_id, layer, slug, domain, type, verified, trigger, path, mtime,
      trigger_vector, content_vector, entity_vector
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, layer, slug) DO UPDATE SET
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      path=excluded.path,
      mtime=excluded.mtime,
      trigger_vector=excluded.trigger_vector,
      content_vector=excluded.content_vector,
      entity_vector=excluded.entity_vector
  `);

  const deleteFts = db.prepare('DELETE FROM memories_fts WHERE workspace_id = ? AND layer = ? AND slug = ?');
  const insertFts = db.prepare(`
    INSERT INTO memories_fts (slug, domain, type, trigger, content, layer, workspace_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const deleteGraph = db.prepare('DELETE FROM memories_graph WHERE workspace_id = ? AND source_slug = ?');
  const insertGraph = db.prepare(`
    INSERT OR IGNORE INTO memories_graph (workspace_id, source_slug, target_slug, rel_type)
    VALUES (?, ?, ?, ?)
  `);

  // Index new, modified, or dimension-invalidated files
  for (const [key, item] of currentFiles.entries()) {
    const prev = existingMap.get(key);
    if (prev && prev.mtime === item.mtime && prev.hasValidVector) {
      continue; // File unchanged and vector dimension matches active engine
    }

    try {
      const rawContent = fs.readFileSync(item.filePath, 'utf8');
      const parsed = parseYamlFrontmatter(rawContent);
      const fm = parsed.frontmatter;

      const domain = fm.domain || 'general';
      const type = fm.type || 'general';
      const verified = fm.verified || '';
      const trigger = fm.description || fm.trigger || '';

      let multiVec;
      if (activeConfig.engine === 'onnx') {
        multiVec = await generateMultiVectorAsync({
          trigger,
          body: parsed.body,
          slug: item.slug,
          domain,
          type,
          related: fm.related
        });
      } else {
        multiVec = generateMultiVector({
          trigger,
          body: parsed.body,
          slug: item.slug,
          domain,
          type,
          related: fm.related
        });
      }

      insertMeta.run(
        item.wsId,
        item.layer,
        item.slug,
        domain,
        type,
        verified,
        trigger,
        item.filePath,
        item.mtime,
        JSON.stringify(multiVec.trigger_vector),
        JSON.stringify(multiVec.content_vector),
        JSON.stringify(multiVec.entity_vector)
      );

      deleteFts.run(item.wsId, item.layer, item.slug);
      insertFts.run(item.slug, domain, type, trigger, parsed.body, item.layer, item.wsId);

      deleteGraph.run(item.wsId, item.slug);
      if (Array.isArray(fm.related)) {
        for (const rel of fm.related) {
          if (rel) insertGraph.run(item.wsId, item.slug, rel, 'related');
        }
      }
      if (fm.overrides) {
        const overridesList = Array.isArray(fm.overrides) ? fm.overrides : [fm.overrides];
        for (const ov of overridesList) {
          if (ov) insertGraph.run(item.wsId, item.slug, ov, 'overrides');
        }
      }
    } catch {}
  }

  // Remove records for deleted files strictly scoped to current workspace or global layers
  const deleteMeta = db.prepare('DELETE FROM memories WHERE workspace_id = ? AND layer = ? AND slug = ?');
  for (const row of existingRows) {
    const key = `${row.workspace_id}:${row.layer}:${row.slug}`;
    if (!currentFiles.has(key)) {
      deleteMeta.run(row.workspace_id, row.layer, row.slug);
      deleteFts.run(row.workspace_id, row.layer, row.slug);
      deleteGraph.run(row.workspace_id, row.slug);
    }
  }

  return { totalIndexed: currentFiles.size, fileBasedFallback: false };
}

/**
 * File-based fallback search when SQLite is unavailable.
 * Evaluates multi-vector dense embedding similarity and keyword matches directly from markdown files.
 */
async function searchMemoriesFileBasedFallback(workspaceRoot, queryText, options = {}) {
  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  if (activeEntries.length === 0) return [];

  const cleanQuery = queryText.trim();
  const queryTokens = tokenizeText(cleanQuery);
  if (queryTokens.length === 0) return [];

  const activeConfig = getActiveEmbeddingConfig();
  const queryVec = await generateEmbedding(cleanQuery, activeConfig.dimensions);
  const precedence = { workspace: 3, private: 2, team: 1 };
  const results = [];

  for (const entry of activeEntries) {
    let body = '';
    try {
      const raw = fs.readFileSync(entry.file, 'utf8');
      const parsed = parseYamlFrontmatter(raw);
      body = parsed.body || '';
    } catch {}

    let multiVec;
    if (activeConfig.engine === 'onnx') {
      multiVec = await generateMultiVectorAsync({
        trigger: entry.trigger,
        body,
        slug: entry.slug,
        domain: entry.domain,
        type: entry.type,
        related: entry.related
      });
    } else {
      multiVec = generateMultiVector({
        trigger: entry.trigger,
        body,
        slug: entry.slug,
        domain: entry.domain,
        type: entry.type,
        related: entry.related
      });
    }

    const multiVecSim = computeMultiVectorSimilarity(queryVec, multiVec);

    const docText = `${entry.slug} ${entry.domain} ${entry.type} ${entry.trigger} ${body}`;
    const docTokens = tokenizeText(docText);
    const cosineSim = computeCosineSimilarity(queryTokens, docTokens);

    let matchCount = 0;
    for (const tok of queryTokens) {
      if (docText.toLowerCase().includes(tok)) matchCount++;
    }
    const tokenOverlap = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;

    // Multi-Vector + lexical fusion
    const combinedConfidence = Math.min(1.0, (multiVecSim * 0.50) + (cosineSim * 0.25) + (tokenOverlap * 0.25));
    if (combinedConfidence <= 0.05 && tokenOverlap === 0 && multiVecSim <= 0.1) continue;

    results.push({
      slug: entry.slug,
      layer: entry.layerKey,
      domain: entry.domain,
      type: entry.type,
      description: entry.trigger,
      confidence: Math.round(combinedConfidence * 100),
      confidenceDecimal: combinedConfidence,
      related: entry.related || [],
      precedenceTier: precedence[entry.layerKey] || 0
    });
  }

  results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.precedenceTier - a.precedenceTier;
  });

  const limit = options.limit || 5;
  return results.slice(0, limit);
}

/**
 * Multi-Vector Hybrid Semantic Retrieval with Reciprocal Rank Fusion (RRF).
 * Combines SQLite FTS5 BM25 with Multi-Facet Dense Embeddings (trigger, content, entity).
 * Uses Local ONNX Transformer (384-d) or Heuristic fallback (128-d).
 * Deterministically enforces Workspace > Private > Team precedence and active override shadowing.
 */
export async function searchMemoriesHybrid(workspaceRoot, queryText, options = {}) {
  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    return [];
  }

  const db = getDatabase();
  if (!db) {
    return searchMemoriesFileBasedFallback(workspaceRoot, queryText, options);
  }

  await syncSqliteIndex(workspaceRoot);

  const cleanQuery = queryText.trim();
  const queryTokens = tokenizeText(cleanQuery);
  if (queryTokens.length === 0) return [];

  const activeConfig = getActiveEmbeddingConfig();
  const queryVec = await generateEmbedding(cleanQuery, activeConfig.dimensions);
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  // 1. Build authoritative precedence and shadow map from scanLayerEntries
  const { activeEntries, shadowedEntries } = scanLayerEntries(workspaceRoot, 'all');
  const activeSlugMap = new Map();
  for (const entry of activeEntries) {
    activeSlugMap.set(entry.slug, entry);
  }

  const shadowedSet = new Set();
  for (const shadowed of shadowedEntries) {
    shadowedSet.add(`${shadowed.layerKey}:${shadowed.slug}`);
    shadowedSet.add(shadowed.slug);
  }

  // 2. Multi-Vector Semantic Retrieval across all active candidates
  const allRows = db.prepare(`
    SELECT m.slug, m.layer, m.workspace_id, m.domain, m.type, m.trigger,
           m.trigger_vector, m.content_vector, m.entity_vector
    FROM memories m
    WHERE (m.workspace_id = ? OR m.workspace_id = 'global')
  `).all(currentWsId);

  const vecCandidates = [];
  for (const row of allRows) {
    if (shadowedSet.has(`${row.layer}:${row.slug}`) || (row.layer === 'team' && shadowedSet.has(row.slug))) {
      continue;
    }

    let multiVec = null;
    try {
      if (row.trigger_vector && row.content_vector && row.entity_vector) {
        const tVec = JSON.parse(row.trigger_vector);
        const cVec = JSON.parse(row.content_vector);
        const eVec = JSON.parse(row.entity_vector);
        if (tVec.length === activeConfig.dimensions) {
          multiVec = {
            trigger_vector: tVec,
            content_vector: cVec,
            entity_vector: eVec
          };
        }
      }
    } catch {}

    if (!multiVec) {
      if (activeConfig.engine === 'onnx') {
        multiVec = await generateMultiVectorAsync({
          trigger: row.trigger,
          body: '',
          slug: row.slug,
          domain: row.domain,
          type: row.type
        });
      } else {
        multiVec = generateMultiVector({
          trigger: row.trigger,
          body: '',
          slug: row.slug,
          domain: row.domain,
          type: row.type
        });
      }
    }

    const multiVecSim = computeMultiVectorSimilarity(queryVec, multiVec);
    vecCandidates.push({ slug: row.slug, layer: row.layer, row, multiVecSim });
  }

  vecCandidates.sort((a, b) => b.multiVecSim - a.multiVecSim);
  const vecRankMap = new Map();
  vecCandidates.forEach((item, idx) => {
    if (item.multiVecSim > 0.05) {
      vecRankMap.set(item.slug, { rank: idx + 1, sim: item.multiVecSim, row: item.row });
    }
  });

  // 3. FTS5 Lexical Retrieval
  const ftsQuery = queryTokens.map(tok => `"${tok}"*`).join(' OR ');
  let ftsMatches = [];
  try {
    const stmt = db.prepare(`
      SELECT f.slug, f.layer, f.workspace_id, f.domain, f.type, f.trigger, f.content, bm25(memories_fts) as bm25_score
      FROM memories_fts f
      WHERE memories_fts MATCH ?
        AND (f.workspace_id = ? OR f.workspace_id = 'global')
      ORDER BY bm25_score ASC
      LIMIT 50
    `);
    ftsMatches = stmt.all(ftsQuery, currentWsId);
  } catch {
    // If FTS fails, use file-based fallback
    return searchMemoriesFileBasedFallback(workspaceRoot, queryText, options);
  }

  const ftsRankMap = new Map();
  ftsMatches.forEach((row, idx) => {
    if (!shadowedSet.has(`${row.layer}:${row.slug}`) && !(row.layer === 'team' && shadowedSet.has(row.slug))) {
      ftsRankMap.set(row.slug, { rank: idx + 1, bm25_score: row.bm25_score, row });
    }
  });

  // 4. Reciprocal Rank Fusion (RRF)
  const candidateSlugs = new Set([...vecRankMap.keys(), ...ftsRankMap.keys()]);
  const precedence = { workspace: 3, private: 2, team: 1 };
  const candidateMap = new Map();

  const k = 60; // Standard RRF constant
  const mode = options.mode || 'hybrid'; // 'hybrid', 'multi_vector', 'lexical'

  for (const slug of candidateSlugs) {
    const vecItem = vecRankMap.get(slug);
    const ftsItem = ftsRankMap.get(slug);
    const baseRow = (ftsItem && ftsItem.row) || (vecItem && vecItem.row);
    if (!baseRow) continue;

    let rrfScore = 0;
    if (mode === 'lexical') {
      rrfScore = ftsItem ? (1.0 / (k + ftsItem.rank)) : 0;
    } else if (mode === 'multi_vector') {
      rrfScore = vecItem ? (1.0 / (k + vecItem.rank)) : 0;
    } else {
      // Hybrid RRF: 45% Lexical BM25 + 55% Multi-Vector Semantic Embedding
      const ftsScore = ftsItem ? (0.45 / (k + ftsItem.rank)) : 0;
      const vecScore = vecItem ? (0.55 / (k + vecItem.rank)) : 0;
      rrfScore = ftsScore + vecScore;
    }

    if (rrfScore <= 0) continue;

    // Normalize confidence to 0.0 - 1.0
    // Max theoretical score is 1 / 61 ~= 0.016393
    const maxTheoreticalRrf = 1.0 / 61.0;
    const confidenceDecimal = Math.min(1.0, Math.max(0.01, rrfScore / maxTheoreticalRrf));

    // Get 1-hop related memories from graph
    const graphRows = db.prepare(`
      SELECT target_slug, rel_type FROM memories_graph 
      WHERE (workspace_id = ? OR workspace_id = 'global') AND source_slug = ?
    `).all(currentWsId, slug);

    const cand = {
      slug: baseRow.slug,
      layer: baseRow.layer,
      domain: baseRow.domain,
      type: baseRow.type,
      description: baseRow.trigger,
      confidence: Math.round(confidenceDecimal * 100),
      confidenceDecimal,
      related: graphRows.map(g => g.target_slug),
      precedenceTier: precedence[baseRow.layer] || 0
    };

    const existing = candidateMap.get(slug);
    if (!existing) {
      candidateMap.set(slug, cand);
    } else if (cand.precedenceTier > existing.precedenceTier) {
      candidateMap.set(slug, cand);
    } else if (cand.precedenceTier === existing.precedenceTier && cand.confidence > existing.confidence) {
      candidateMap.set(slug, cand);
    }
  }

  const results = Array.from(candidateMap.values());
  results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.precedenceTier - a.precedenceTier;
  });

  const limit = options.limit || 5;
  return results.slice(0, limit);
}

/**
 * Retrieves the complete Knowledge Graph data for visualization (D3 / SVG canvas).
 * Guarantees referential integrity so broken or orphaned links never crash D3 force layouts.
 */
export function getKnowledgeGraphData(workspaceRoot) {
  const db = getDatabase();
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  let rawNodes = [];
  let rawLinks = [];

  if (db) {
    syncSqliteMetadata(workspaceRoot);

    rawNodes = db.prepare(`
      SELECT m.slug as id, m.slug, m.layer, m.domain, m.type, m.verified, m.trigger as description,
             COALESCE(t.applied_count, 0) as applied_count,
             COALESCE(t.recalled_count, 0) as recalled_count,
             COALESCE(t.test_pass_count, 0) as test_pass_count,
             COALESCE(t.test_fail_count, 0) as test_fail_count,
             COALESCE(t.efficacy_score, 1.0) as efficacy_score
      FROM memories m
      LEFT JOIN telemetry t ON m.slug = t.slug
      WHERE m.workspace_id = ? OR m.workspace_id = 'global'
    `).all(currentWsId);

    rawLinks = db.prepare(`
      SELECT source_slug as source, target_slug as target, rel_type as type
      FROM memories_graph
      WHERE workspace_id = ? OR workspace_id = 'global'
    `).all(currentWsId);
  } else {
    // File-based graph construction fallback
    const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
    const tele = readTelemetryJson();

    rawNodes = activeEntries.map(e => ({
      id: e.slug,
      slug: e.slug,
      layer: e.layerKey,
      domain: e.domain,
      type: e.type,
      verified: e.verified,
      description: e.trigger,
      applied_count: tele[e.slug]?.applied_count || 0,
      recalled_count: tele[e.slug]?.recalled_count || 0,
      test_pass_count: tele[e.slug]?.test_pass_count || 0,
      test_fail_count: tele[e.slug]?.test_fail_count || 0,
      efficacy_score: typeof tele[e.slug]?.efficacy_score === 'number' ? tele[e.slug].efficacy_score : 1.0
    }));

    for (const entry of activeEntries) {
      if (Array.isArray(entry.related)) {
        for (const rel of entry.related) {
          if (rel) rawLinks.push({ source: entry.slug, target: rel, type: 'related' });
        }
      }
      if (entry.overridesList) {
        for (const ov of entry.overridesList) {
          if (ov) rawLinks.push({ source: entry.slug, target: ov, type: 'overrides' });
        }
      }
    }
  }

  // Deduplicate nodes across precedence layers
  const nodeMap = new Map();
  const precedence = { workspace: 3, private: 2, team: 1 };
  for (const n of rawNodes) {
    const existing = nodeMap.get(n.slug);
    if (!existing || (precedence[n.layer] || 0) > (precedence[existing.layer] || 0)) {
      nodeMap.set(n.slug, n);
    }
  }

  const nodes = Array.from(nodeMap.values());
  const validNodeIds = new Set(nodes.map(n => n.id));

  // Evaluate staleness (>180d)
  const now = Date.now();
  for (const node of nodes) {
    if (!node.verified) {
      node.stale = true;
    } else {
      const parsed = Date.parse(node.verified);
      node.stale = isNaN(parsed) || ((now - parsed) > 180 * 24 * 3600 * 1000);
    }
  }

  // Filter links for referential integrity: D3 crashes if edge connects to a non-existent node ID
  const validLinks = [];
  const brokenLinks = [];

  for (const l of rawLinks) {
    if (validNodeIds.has(l.source) && validNodeIds.has(l.target)) {
      validLinks.push(l);
    } else {
      brokenLinks.push(l);
    }
  }

  // Compute bi-directional degree and link lists on each node
  const incomingMap = new Map();
  const outgoingMap = new Map();
  for (const n of nodes) {
    incomingMap.set(n.id, []);
    outgoingMap.set(n.id, []);
  }

  for (const l of validLinks) {
    if (outgoingMap.has(l.source)) {
      outgoingMap.get(l.source).push(l.target);
    }
    if (incomingMap.has(l.target)) {
      incomingMap.get(l.target).push(l.source);
    }
  }

  for (const node of nodes) {
    node.backlinks = incomingMap.get(node.id) || [];
    node.forwardlinks = outgoingMap.get(node.id) || [];
    node.incomingCount = node.backlinks.length;
    node.outgoingCount = node.forwardlinks.length;
  }

  const avgEfficacy = nodes.length
    ? Number((nodes.reduce((acc, n) => acc + (n.efficacy_score || 1.0), 0) / nodes.length).toFixed(2))
    : 1.0;

  return {
    nodes,
    links: validLinks,
    brokenLinks,
    summary: {
      totalNodes: nodes.length,
      totalLinks: validLinks.length,
      brokenLinksCount: brokenLinks.length,
      domains: [...new Set(nodes.map(n => n.domain))],
      avgEfficacyScore: avgEfficacy
    }
  };
}

/**
 * Retrieves bi-directional graph neighbors (both outgoing references and incoming backlinks) for a given slug.
 */
export function getMemoryGraphNeighbors(workspaceRoot, slug) {
  if (!slug) return { slug: '', outgoing: [], incoming: [] };
  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  const graph = getKnowledgeGraphData(workspaceRoot);
  const targetNode = graph.nodes.find(n => n.id === cleanSlug || n.slug === cleanSlug);

  const outgoing = graph.links
    .filter(l => l.source === cleanSlug)
    .map(l => ({ target_slug: l.target, rel_type: l.type }));

  const incoming = graph.links
    .filter(l => l.target === cleanSlug)
    .map(l => ({ source_slug: l.source, rel_type: l.type }));

  return {
    slug: cleanSlug,
    node: targetNode || null,
    outgoing,
    incoming,
    backlinksCount: incoming.length,
    outgoingCount: outgoing.length
  };
}

/**
 * File-based telemetry helpers for SQLite fallback.
 */
function readTelemetryJson() {
  const p = getTelemetryJsonPath();
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeTelemetryJson(data) {
  const p = getTelemetryJsonPath();
  try {
    atomicWriteFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

/**
 * Records telemetry events and verification feedback for memory utility and efficacy scoring.
 * Works seamlessly across both SQLite and JSON fallback modes.
 */
export function recordTelemetryEvent(slug, eventType = 'recall', details = {}) {
  if (!slug) return;
  const db = getDatabase();
  const nowIso = new Date().toISOString();

  if (db) {
    try {
      db.prepare(`
        INSERT OR IGNORE INTO telemetry (slug, recalled_count, applied_count, test_pass_count, test_fail_count, efficacy_score)
        VALUES (?, 0, 0, 0, 0, 1.0)
      `).run(slug);

      if (eventType === 'apply') {
        db.prepare(`
          UPDATE telemetry SET applied_count = applied_count + 1, last_applied = ? WHERE slug = ?
        `).run(nowIso, slug);
      } else if (eventType === 'test_pass') {
        db.prepare(`
          UPDATE telemetry 
          SET test_pass_count = test_pass_count + 1,
              efficacy_score = MIN(1.0, efficacy_score + 0.05),
              last_feedback = ?
          WHERE slug = ?
        `).run(details.message || 'test_passed', slug);
      } else if (eventType === 'test_fail') {
        db.prepare(`
          UPDATE telemetry 
          SET test_fail_count = test_fail_count + 1,
              efficacy_score = MAX(0.1, efficacy_score - 0.20),
              last_feedback = ?
          WHERE slug = ?
        `).run(details.message || 'test_failed', slug);
      } else {
        db.prepare(`
          UPDATE telemetry SET recalled_count = recalled_count + 1, last_recalled = ? WHERE slug = ?
        `).run(nowIso, slug);
      }
      return;
    } catch {}
  }

  // Fallback to telemetry.json
  const data = readTelemetryJson();
  if (!data[slug]) {
    data[slug] = {
      recalled_count: 0,
      applied_count: 0,
      test_pass_count: 0,
      test_fail_count: 0,
      efficacy_score: 1.0,
      last_recalled: null,
      last_applied: null,
      last_feedback: null
    };
  }
  if (eventType === 'apply') {
    data[slug].applied_count = (data[slug].applied_count || 0) + 1;
    data[slug].last_applied = nowIso;
  } else if (eventType === 'test_pass') {
    data[slug].test_pass_count = (data[slug].test_pass_count || 0) + 1;
    data[slug].efficacy_score = Math.min(1.0, (data[slug].efficacy_score || 1.0) + 0.05);
    data[slug].last_feedback = details.message || 'test_passed';
  } else if (eventType === 'test_fail') {
    data[slug].test_fail_count = (data[slug].test_fail_count || 0) + 1;
    data[slug].efficacy_score = Math.max(0.1, (data[slug].efficacy_score || 1.0) - 0.20);
    data[slug].last_feedback = details.message || 'test_failed';
  } else {
    data[slug].recalled_count = (data[slug].recalled_count || 0) + 1;
    data[slug].last_recalled = nowIso;
  }
  writeTelemetryJson(data);
}

/**
 * Public command: Explicitly records memory efficacy feedback (test_pass, test_fail, applied).
 */
export function recordMemoryEfficacy(slug, feedbackType, details = {}) {
  recordTelemetryEvent(slug, feedbackType, details);
  const db = getDatabase();
  if (db) {
    try {
      const row = db.prepare('SELECT * FROM telemetry WHERE slug = ?').get(slug);
      if (row) return row;
    } catch {}
  }
  const data = readTelemetryJson();
  return data[slug] || { slug, efficacy_score: 1.0 };
}

/**
 * Zero-Turn Proactive Recall Probe.
 * Evaluates natural language input or working context against indexed memory triggers
 * using dense vector embeddings in < 5ms. Returns advisory banners for high-confidence matches.
 *
 * @param {string} workspaceRoot
 * @param {string} queryOrContext
 * @param {Object} options
 * @returns {Object} Proactive probe matches and advisory system messages
 */
export async function proactiveMemoryProbe(workspaceRoot = process.cwd(), queryOrContext = '', options = {}) {
  if (!queryOrContext || typeof queryOrContext !== 'string' || !queryOrContext.trim()) {
    return { triggered: false, count: 0, matches: [], advisoryMessage: '' };
  }

  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.55;
  const limit = options.limit || 3;
  const matches = await searchMemoriesHybrid(workspaceRoot, queryOrContext, {
    limit,
    mode: 'hybrid'
  });

  const highConfidence = matches.filter(m => (m.confidenceDecimal || m.confidence / 100) >= threshold);

  if (highConfidence.length === 0) {
    return { triggered: false, count: 0, matches: [], advisoryMessage: '' };
  }

  const bullets = highConfidence.map(m => {
    return `- **[${m.layer}] ${m.slug}** (${m.confidence}% match): ${m.description}`;
  });

  const advisoryMessage = `> [!NOTE]\n> 🧠 **Proactive Knowledge Advisory (${highConfidence.length} relevant convention(s) detected):**\n` +
    bullets.join('\n') +
    `\n> Recall full guidance anytime via \`get_memory_content(slug="...")\`.\n`;

  return {
    triggered: true,
    count: highConfidence.length,
    matches: highConfidence,
    advisoryMessage
  };
}

/**
 * Generates a self-contained, interactive HTML canvas artifact
 * featuring D3 force simulation, domain clusters, staleness alerts, and inspector drawer.
 */
export function generateKnowledgeGraphHtml(workspaceRoot = process.cwd()) {
  const graphData = getKnowledgeGraphData(workspaceRoot);
  const dataJson = JSON.stringify(graphData);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Knowledge Capture Graph Visualizer</title>
  <script src="https://d3js.org/d3.v7.min.js"></script>
  <style>
    :root {
      --bg: #0f172a;
      --card-bg: #1e293b;
      --border: #334155;
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --workspace-color: #a855f7;
      --private-color: #3b82f6;
      --team-color: #10b981;
      --stale-color: #ef4444;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      overflow: hidden;
      height: 100vh;
      width: 100vw;
      display: flex;
    }

    #controls {
      position: absolute;
      top: 16px;
      left: 16px;
      z-index: 10;
      background: rgba(30, 41, 59, 0.85);
      backdrop-filter: blur(8px);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      width: 330px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }

    h1 { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .metrics { font-size: 11px; color: var(--text-muted); display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .metric-badge { background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); }
    .metric-badge strong { color: var(--text); }

    input#search {
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      color: var(--text);
      font-size: 13px;
    }
    input#search:focus { outline: none; border-color: #38bdf8; }

    .domains { display: flex; flex-wrap: wrap; gap: 6px; max-height: 90px; overflow-y: auto; }
    .domain-chip {
      font-size: 11px;
      padding: 3px 8px;
      border-radius: 20px;
      background: #334155;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }
    .domain-chip.active { background: #3b82f6; color: white; }

    .studio-actions { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--border); padding-top: 10px; }
    .studio-btn {
      background: #334155;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: all 0.15s;
    }
    .studio-btn:hover { background: #475569; }
    .studio-btn.active { background: #f59e0b; color: #000; border-color: #f59e0b; }
    .studio-btn.btn-primary { background: #2563eb; border-color: #3b82f6; }
    .studio-btn.btn-primary:hover { background: #1d4ed8; }

    .banner {
      font-size: 11px;
      padding: 6px 10px;
      border-radius: 6px;
      background: rgba(245, 158, 11, 0.15);
      border: 1px solid #f59e0b;
      color: #f59e0b;
    }
    .hidden { display: none !important; }

    .legend { display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: var(--text-muted); border-top: 1px solid var(--border); padding-top: 8px; }
    .legend-item { display: flex; align-items: center; gap: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

    #canvas-container { flex: 1; height: 100%; position: relative; }
    svg { width: 100%; height: 100%; }

    #drawer {
      position: absolute;
      top: 16px;
      right: 16px;
      bottom: 16px;
      width: 380px;
      background: rgba(30, 41, 59, 0.96);
      backdrop-filter: blur(12px);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px;
      display: none;
      flex-direction: column;
      gap: 14px;
      z-index: 20;
      overflow-y: auto;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
    }
    #drawer.open { display: flex; }
    .close-btn { align-self: flex-end; background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; }
    .drawer-title { font-size: 16px; font-weight: 600; color: #fff; word-break: break-all; }
    .drawer-badge { display: inline-block; font-size: 11px; padding: 2px 8px; border-radius: 12px; text-transform: uppercase; font-weight: 600; }
    .drawer-section { border-top: 1px solid var(--border); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    .drawer-section h3 { font-size: 12px; text-transform: uppercase; color: var(--text-muted); }

    .form-group { display: flex; flex-direction: column; gap: 4px; }
    .form-label { font-size: 11px; font-weight: 600; color: var(--text-muted); }
    .studio-input, .studio-textarea {
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      color: var(--text);
      font-size: 12px;
      font-family: inherit;
      width: 100%;
    }
    .studio-input:focus, .studio-textarea:focus { outline: none; border-color: #38bdf8; }
    .verified-row { display: flex; gap: 6px; align-items: center; }

    .small-btn {
      background: #334155;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 4px;
      padding: 4px 8px;
      font-size: 11px;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      transition: background 0.15s;
    }
    .small-btn:hover { background: #475569; }
    .small-btn.btn-success { background: rgba(16, 185, 129, 0.2); border-color: #10b981; color: #10b981; }
    .small-btn.btn-success:hover { background: rgba(16, 185, 129, 0.4); }
    .small-btn.btn-danger { background: rgba(239, 68, 68, 0.2); border-color: #ef4444; color: #ef4444; }
    .small-btn.btn-danger:hover { background: rgba(239, 68, 68, 0.4); }

    .efficacy-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      background: #0f172a;
      border: 1px solid var(--border);
    }

    .link-item {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 5px 8px;
      font-size: 11px;
    }
    .disconnect-btn {
      color: #ef4444;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 13px;
      padding: 0 4px;
    }

    /* Modal */
    #patch-modal {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(4px);
      z-index: 50;
      display: none;
      align-items: center;
      justify-content: center;
    }
    #patch-modal.open { display: flex; }
    .modal-box {
      background: #1e293b;
      border: 1px solid var(--border);
      border-radius: 12px;
      width: 600px;
      max-width: 90vw;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7);
    }
    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .modal-body {
      padding: 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .modal-body pre {
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      font-family: monospace;
      font-size: 12px;
      color: #38bdf8;
      overflow-x: auto;
      max-height: 320px;
    }
    .modal-footer {
      padding: 16px 20px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }
  </style>
</head>
<body>
  <div id="controls">
    <h1>🧠 Memory Studio</h1>
    <div class="metrics">
      <div class="metric-badge">Nodes: <strong id="m-nodes">0</strong></div>
      <div class="metric-badge">Edges: <strong id="m-links">0</strong></div>
      <div class="metric-badge">Domains: <strong id="m-domains">0</strong></div>
      <div class="metric-badge">Avg Efficacy: <strong id="m-efficacy">100%</strong></div>
    </div>
    <input type="text" id="search" placeholder="Search memory slugs or triggers...">
    <div class="domains" id="domain-chips"></div>

    <div class="studio-actions">
      <button id="btn-connect-mode" class="studio-btn">🔗 Connect Mode: OFF</button>
      <div id="connect-banner" class="banner hidden">Connect Mode: Click Source node, then Target node</div>
      <button id="btn-export-patch" class="studio-btn btn-primary">📦 Export Staged Patch (<span id="staged-count">0</span>)</button>
    </div>

    <div class="legend">
      <div class="legend-item"><span class="dot" style="background:var(--workspace-color)"></span> Workspace Scoped (.agents/)</div>
      <div class="legend-item"><span class="dot" style="background:var(--private-color)"></span> Private Layer (~/.gemini/private/)</div>
      <div class="legend-item"><span class="dot" style="background:var(--team-color)"></span> Team Global (~/.gemini/team/)</div>
      <div class="legend-item"><span class="dot" style="border: 2px solid var(--stale-color)"></span> Stale Rule (>180d or unverified)</div>
    </div>
  </div>

  <div id="canvas-container">
    <svg id="graph-svg"></svg>
  </div>

  <div id="drawer">
    <button class="close-btn" id="drawer-close">&times;</button>
    <div class="drawer-title" id="d-title"></div>
    <div><span class="drawer-badge" id="d-badge"></span> <span style="font-size: 12px; color: var(--text-muted);" id="d-type"></span></div>

    <div class="drawer-section">
      <h3>Memory Metadata Editor</h3>
      <div class="form-group">
        <label class="form-label" for="edit-domain">Domain</label>
        <input type="text" id="edit-domain" class="studio-input" />
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-desc">Trigger Condition / Description</label>
        <textarea id="edit-desc" class="studio-textarea" rows="3"></textarea>
      </div>
      <div class="form-group">
        <label class="form-label" for="edit-verified">Verified Date</label>
        <div class="verified-row">
          <input type="date" id="edit-verified" class="studio-input" />
          <button id="btn-bump-today" class="small-btn">📅 Bump to Today</button>
        </div>
      </div>
      <button id="btn-stage-node" class="studio-btn btn-primary" style="margin-top:4px;">💾 Stage Node Edits</button>
      <span id="stage-feedback" style="font-size:11px;color:#10b981;display:none;text-align:center;">✓ Edits staged!</span>
    </div>

    <div class="drawer-section">
      <h3>Operational Utility & Efficacy</h3>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <span class="form-label">Efficacy Score:</span>
        <div class="efficacy-badge" id="d-efficacy-badge">100%</div>
      </div>
      <div style="font-size: 12px; color: var(--text-muted);" id="d-utility-stats"></div>
      <div style="display:flex; gap:6px; margin-top:4px;">
        <button id="btn-feedback-pass" class="small-btn btn-success" style="flex:1;">👍 Pass (+5%)</button>
        <button id="btn-feedback-fail" class="small-btn btn-danger" style="flex:1;">👎 Fail (-20%)</button>
      </div>
    </div>

    <div class="drawer-section">
      <h3>Lateral Memory Links</h3>
      <div id="d-links-list" style="display:flex; flex-direction:column; gap:4px;"></div>
    </div>
  </div>

  <div id="patch-modal">
    <div class="modal-box">
      <div class="modal-header">
        <h2 style="font-size: 16px;">📦 Staged Memory Patch</h2>
        <button class="close-btn" id="modal-close">&times;</button>
      </div>
      <div class="modal-body">
        <div id="patch-summary" style="font-size:13px; color: var(--text-muted);"></div>
        <pre><code id="patch-code"></code></pre>
      </div>
      <div class="modal-footer">
        <button id="btn-copy-patch" class="studio-btn">📋 Copy JSON</button>
        <button id="btn-download-patch" class="studio-btn btn-primary">⬇️ Download patch.json</button>
      </div>
    </div>
  </div>

  <script>
    const data = ${dataJson};

    // Staged modifications store
    const staged = {
      nodeUpdates: {},
      addedLinks: [],
      removedLinks: []
    };

    let connectMode = false;
    let connectSourceNode = null;
    let selectedNode = null;
    let selectedDomain = null;

    function updateSummaryMetrics() {
      document.getElementById('m-nodes').textContent = data.nodes.length;
      document.getElementById('m-links').textContent = data.links.length;
      document.getElementById('m-domains').textContent = [...new Set(data.nodes.map(n => n.domain))].length;
      const avgEff = data.nodes.length
        ? Math.round((data.nodes.reduce((acc, n) => acc + (n.efficacy_score !== undefined ? n.efficacy_score : 1.0), 0) / data.nodes.length) * 100)
        : 100;
      document.getElementById('m-efficacy').textContent = avgEff + '%';
      
      const stagedCount = Object.keys(staged.nodeUpdates).length + staged.addedLinks.length + staged.removedLinks.length;
      document.getElementById('staged-count').textContent = stagedCount;
    }

    updateSummaryMetrics();

    const domainChipsContainer = document.getElementById('domain-chips');
    data.summary.domains.forEach(d => {
      const chip = document.createElement('div');
      chip.className = 'domain-chip';
      chip.textContent = d;
      chip.onclick = () => {
        if (selectedDomain === d) {
          selectedDomain = null;
          chip.classList.remove('active');
        } else {
          document.querySelectorAll('.domain-chip').forEach(c => c.classList.remove('active'));
          selectedDomain = d;
          chip.classList.add('active');
        }
        updateHighlights();
      };
      domainChipsContainer.appendChild(chip);
    });

    const svg = d3.select("#graph-svg");
    const width = window.innerWidth;
    const height = window.innerHeight;

    const defs = svg.append("defs");
    defs.append("marker")
      .attr("id", "arrow-overrides")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#f59e0b");

    const g = svg.append("g");
    svg.call(d3.zoom().scaleExtent([0.1, 4]).on("zoom", (event) => g.attr("transform", event.transform)));

    const simulation = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id(d => d.id).distance(90))
      .force("charge", d3.forceManyBody().strength(-280))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(d => getRadius(d) + 14));

    let linkElements = g.append("g").attr("class", "links").selectAll("line");
    let nodeElements = g.append("g").attr("class", "nodes").selectAll("circle");
    let labelElements = g.append("g").attr("class", "labels").selectAll("text");

    function renderGraphElements() {
      linkElements = linkElements.data(data.links, d => \`\${d.source.id || d.source}-\${d.target.id || d.target}\`);
      linkElements.exit().remove();
      const linkEnter = linkElements.enter().append("line")
        .attr("stroke", d => d.type === 'overrides' ? "#f59e0b" : "#475569")
        .attr("stroke-width", d => d.type === 'overrides' ? 2 : 1.5)
        .attr("stroke-dasharray", d => d.type === 'overrides' ? "none" : "4 4")
        .attr("marker-end", d => d.type === 'overrides' ? "url(#arrow-overrides)" : null);
      linkElements = linkEnter.merge(linkElements);

      nodeElements = nodeElements.data(data.nodes, d => d.id);
      nodeElements.exit().remove();
      const nodeEnter = nodeElements.enter().append("circle")
        .attr("r", d => getRadius(d))
        .attr("fill", d => getNodeColor(d.layer))
        .attr("stroke", d => d.stale ? "#ef4444" : "#ffffff")
        .attr("stroke-width", d => d.stale ? 2.5 : 1)
        .attr("cursor", "pointer")
        .call(d3.drag()
          .on("start", dragstarted)
          .on("drag", dragged)
          .on("end", dragended))
        .on("click", (event, d) => onNodeClicked(event, d));
      nodeElements = nodeEnter.merge(nodeElements);

      labelElements = labelElements.data(data.nodes, d => d.id);
      labelElements.exit().remove();
      const labelEnter = labelElements.enter().append("text")
        .text(d => d.slug)
        .attr("font-size", 10)
        .attr("fill", "#cbd5e1")
        .attr("dx", 14)
        .attr("dy", 4)
        .attr("pointer-events", "none");
      labelElements = labelEnter.merge(labelElements);

      simulation.nodes(data.nodes);
      simulation.force("link").links(data.links);
      simulation.alpha(0.3).restart();
    }

    renderGraphElements();

    simulation.on("tick", () => {
      linkElements
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      nodeElements
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);

      labelElements
        .attr("x", d => d.x)
        .attr("y", d => d.y);
    });

    function getRadius(d) {
      const base = 8;
      const count = d.applied_count || 0;
      return base + Math.min(12, Math.sqrt(count) * 3);
    }

    function getNodeColor(layer) {
      if (layer === 'workspace') return '#a855f7';
      if (layer === 'private') return '#3b82f6';
      return '#10b981';
    }

    function dragstarted(event, d) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event, d) {
      d.fx = event.x;
      d.fy = event.y;
    }
    function dragended(event, d) {
      if (!event.active) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }

    // Connect Mode Toggle
    const btnConnectMode = document.getElementById('btn-connect-mode');
    const connectBanner = document.getElementById('connect-banner');

    btnConnectMode.onclick = () => {
      connectMode = !connectMode;
      connectSourceNode = null;
      if (connectMode) {
        btnConnectMode.classList.add('active');
        btnConnectMode.textContent = '🔗 Connect Mode: ACTIVE';
        connectBanner.classList.remove('hidden');
        document.body.style.cursor = 'crosshair';
      } else {
        btnConnectMode.classList.remove('active');
        btnConnectMode.textContent = '🔗 Connect Mode: OFF';
        connectBanner.classList.add('hidden');
        document.body.style.cursor = 'default';
        nodeElements.attr('stroke', d => d.stale ? '#ef4444' : '#ffffff');
      }
    };

    function onNodeClicked(event, d) {
      if (connectMode) {
        if (!connectSourceNode) {
          connectSourceNode = d;
          connectBanner.textContent = \`Source selected: \${d.slug}. Now click target node.\`;
          nodeElements.attr('stroke', n => n.id === d.id ? '#f59e0b' : (n.stale ? '#ef4444' : '#ffffff'))
            .attr('stroke-width', n => n.id === d.id ? 4 : (n.stale ? 2.5 : 1));
        } else if (connectSourceNode.id === d.id) {
          connectSourceNode = null;
          connectBanner.textContent = 'Connect Mode: Click Source node, then Target node';
          nodeElements.attr('stroke', n => n.stale ? '#ef4444' : '#ffffff')
            .attr('stroke-width', n => n.stale ? 2.5 : 1);
        } else {
          // Connect connectSourceNode -> d
          const relType = window.confirm(\`Create 'overrides' link from \${connectSourceNode.slug} -> \${d.slug}?\\n(Click OK for 'overrides', Cancel for 'related')\`) ? 'overrides' : 'related';
          const newLink = {
            source: connectSourceNode,
            target: d,
            type: relType
          };
          data.links.push(newLink);
          staged.addedLinks.push({
            sourceSlug: connectSourceNode.slug,
            targetSlug: d.slug,
            type: relType
          });
          updateSummaryMetrics();
          renderGraphElements();

          connectSourceNode = null;
          connectBanner.textContent = 'Link created! Click next source or toggle off Connect Mode.';
          nodeElements.attr('stroke', n => n.stale ? '#ef4444' : '#ffffff')
            .attr('stroke-width', n => n.stale ? 2.5 : 1);
        }
        return;
      }

      showDrawer(d);
    }

    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', updateHighlights);

    function updateHighlights() {
      const query = searchInput.value.toLowerCase().trim();
      nodeElements.attr("opacity", d => {
        const matchesQuery = !query || d.slug.toLowerCase().includes(query) || (d.description && d.description.toLowerCase().includes(query));
        const matchesDomain = !selectedDomain || d.domain === selectedDomain;
        return (matchesQuery && matchesDomain) ? 1.0 : 0.15;
      });
      labelElements.attr("opacity", d => {
        const matchesQuery = !query || d.slug.toLowerCase().includes(query) || (d.description && d.description.toLowerCase().includes(query));
        const matchesDomain = !selectedDomain || d.domain === selectedDomain;
        return (matchesQuery && matchesDomain) ? 1.0 : 0.15;
      });
      linkElements.attr("opacity", d => {
        const sSlug = d.source.slug || '';
        const tSlug = d.target.slug || '';
        const sDom = d.source.domain || '';
        const tDom = d.target.domain || '';
        const srcMatch = (!query || sSlug.toLowerCase().includes(query)) && (!selectedDomain || sDom === selectedDomain);
        const tgtMatch = (!query || tSlug.toLowerCase().includes(query)) && (!selectedDomain || tDom === selectedDomain);
        return (srcMatch && tgtMatch) ? 0.8 : 0.05;
      });
    }

    const drawer = document.getElementById('drawer');
    document.getElementById('drawer-close').onclick = () => drawer.classList.remove('open');

    function showDrawer(d) {
      selectedNode = d;
      drawer.classList.add('open');
      document.getElementById('d-title').textContent = d.slug;
      const badge = document.getElementById('d-badge');
      badge.textContent = d.layer;
      badge.style.background = getNodeColor(d.layer);
      badge.style.color = '#fff';

      document.getElementById('d-type').textContent = \`[\${d.type || 'convention'}]\`;

      // Fill editable fields (checking staged overrides first)
      const stagedUpdate = staged.nodeUpdates[d.slug] || {};
      document.getElementById('edit-domain').value = stagedUpdate.domain !== undefined ? stagedUpdate.domain : (d.domain || '');
      document.getElementById('edit-desc').value = stagedUpdate.description !== undefined ? stagedUpdate.description : (d.description || '');
      document.getElementById('edit-verified').value = stagedUpdate.verified !== undefined ? stagedUpdate.verified : (d.verified || '');

      renderUtilityStats(d);
      renderLinksList(d);
      document.getElementById('stage-feedback').style.display = 'none';
    }

    function renderUtilityStats(d) {
      const eff = Math.round((d.efficacy_score !== undefined ? d.efficacy_score : 1.0) * 100);
      const effBadge = document.getElementById('d-efficacy-badge');
      effBadge.textContent = eff + '%';
      effBadge.style.color = eff >= 80 ? '#10b981' : (eff >= 50 ? '#f59e0b' : '#ef4444');

      document.getElementById('d-utility-stats').innerHTML = \`
        <div>• <strong>Applied Count:</strong> \${d.applied_count || 0} times</div>
        <div>• <strong>Recalled Count:</strong> \${d.recalled_count || 0} times</div>
        <div>• <strong>Test Passes:</strong> \${d.test_pass_count || 0} | <strong>Fails:</strong> \${d.test_fail_count || 0}</div>
        <div>• <strong>Status:</strong> \${d.stale ? '<span style=\"color:#ef4444\">(STALE > 180d)</span>' : 'Verified & Active ✅'}</div>
      \`;
    }

    function renderLinksList(d) {
      const linksContainer = document.getElementById('d-links-list');
      linksContainer.innerHTML = '';

      const connectedLinks = data.links.filter(l => {
        const sId = l.source.id || l.source;
        const tId = l.target.id || l.target;
        return sId === d.id || tId === d.id;
      });

      if (connectedLinks.length === 0) {
        linksContainer.innerHTML = '<span style=\"font-size: 11px; color: var(--text-muted);\">No lateral connections.</span>';
        return;
      }

      connectedLinks.forEach(l => {
        const sId = l.source.id || l.source;
        const targetObj = sId === d.id ? l.target : l.source;
        const targetSlug = targetObj.slug || targetObj.id || targetObj;

        const item = document.createElement('div');
        item.className = 'link-item';
        item.innerHTML = \`
          <span>\${l.type === 'overrides' ? '⚠️ overrides' : '🔗 related'}: <strong>\${targetSlug}</strong></span>
          <button class=\"disconnect-btn\" title=\"Remove link\">&times;</button>
        \`;
        item.querySelector('.disconnect-btn').onclick = () => {
          data.links = data.links.filter(link => link !== l);
          staged.removedLinks.push({
            sourceSlug: (l.source.slug || l.source.id),
            targetSlug: (l.target.slug || l.target.id),
            type: l.type
          });
          updateSummaryMetrics();
          renderGraphElements();
          renderLinksList(d);
        };
        linksContainer.appendChild(item);
      });
    }

    // Bump to Today
    document.getElementById('btn-bump-today').onclick = () => {
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('edit-verified').value = today;
    };

    // Stage Node Edits
    document.getElementById('btn-stage-node').onclick = () => {
      if (!selectedNode) return;
      const newDomain = document.getElementById('edit-domain').value.trim();
      const newDesc = document.getElementById('edit-desc').value.trim();
      const newVerified = document.getElementById('edit-verified').value.trim();

      staged.nodeUpdates[selectedNode.slug] = {
        slug: selectedNode.slug,
        layer: selectedNode.layer,
        domain: newDomain,
        description: newDesc,
        verified: newVerified
      };

      // Update in memory node object
      selectedNode.domain = newDomain;
      selectedNode.description = newDesc;
      selectedNode.verified = newVerified;
      selectedNode.stale = false;

      updateSummaryMetrics();
      renderGraphElements();
      renderUtilityStats(selectedNode);

      const fb = document.getElementById('stage-feedback');
      fb.style.display = 'block';
      setTimeout(() => { fb.style.display = 'none'; }, 2500);
    };

    // Quick Feedback buttons
    document.getElementById('btn-feedback-pass').onclick = () => {
      if (!selectedNode) return;
      selectedNode.test_pass_count = (selectedNode.test_pass_count || 0) + 1;
      selectedNode.efficacy_score = Math.min(1.0, (selectedNode.efficacy_score !== undefined ? selectedNode.efficacy_score : 1.0) + 0.05);
      renderUtilityStats(selectedNode);
      updateSummaryMetrics();
      staged.nodeUpdates[selectedNode.slug] = Object.assign(staged.nodeUpdates[selectedNode.slug] || {}, {
        slug: selectedNode.slug,
        efficacy_score: selectedNode.efficacy_score
      });
    };

    document.getElementById('btn-feedback-fail').onclick = () => {
      if (!selectedNode) return;
      selectedNode.test_fail_count = (selectedNode.test_fail_count || 0) + 1;
      selectedNode.efficacy_score = Math.max(0.1, (selectedNode.efficacy_score !== undefined ? selectedNode.efficacy_score : 1.0) - 0.20);
      renderUtilityStats(selectedNode);
      updateSummaryMetrics();
      staged.nodeUpdates[selectedNode.slug] = Object.assign(staged.nodeUpdates[selectedNode.slug] || {}, {
        slug: selectedNode.slug,
        efficacy_score: selectedNode.efficacy_score
      });
    };

    // Patch Modal and Export
    const patchModal = document.getElementById('patch-modal');
    document.getElementById('btn-export-patch').onclick = () => {
      const summaryDiv = document.getElementById('patch-summary');
      const modCount = Object.keys(staged.nodeUpdates).length;
      const addCount = staged.addedLinks.length;
      const remCount = staged.removedLinks.length;

      summaryDiv.innerHTML = \`
        <strong>Staged Changes:</strong> \${modCount} node(s) modified, \${addCount} link(s) added, \${remCount} link(s) removed.
      \`;

      const patchData = {
        generated_at: new Date().toISOString(),
        version: "2.0.0",
        patch: staged
      };

      const jsonStr = JSON.stringify(patchData, null, 2);
      document.getElementById('patch-code').textContent = jsonStr;
      patchModal.classList.add('open');
    };

    document.getElementById('modal-close').onclick = () => patchModal.classList.remove('open');

    document.getElementById('btn-copy-patch').onclick = () => {
      const text = document.getElementById('patch-code').textContent;
      navigator.clipboard.writeText(text).then(() => {
        alert('Staged patch JSON copied to clipboard!');
      });
    };

    document.getElementById('btn-download-patch').onclick = () => {
      const text = document.getElementById('patch-code').textContent;
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = \`memory-patch-\${new Date().toISOString().slice(0, 10)}.json\`;
      a.click();
      URL.revokeObjectURL(url);
    };
  </script>
</body>
</html>`;
}

/**
 * Semantic Contradiction & Codebase Drift Detection Engine.
 *
 * Audits memories across all active layers against:
 * 1. Semantic Contradictions: Conflicting rules on identical triggers or domains without explicit overrides.
 * 2. Codebase Drift: References to missing files, incompatible engine requirements, and verification staleness.
 *
 * @param {string} workspaceRoot
 * @param {Object} [options]
 * @param {string} [options.domain] Optional domain filter
 * @param {number} [options.threshold=0.65] Semantic similarity threshold for contradiction evaluation
 * @returns {Object} Structured contradiction and drift audit report
 */
export function detectContradictionsAndDrift(workspaceRoot = process.cwd(), options = {}) {
  const currentWsId = normalizeWorkspaceId(workspaceRoot);
  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.65;

  // 1. Retrieve all active entries and shadow relationships
  const { activeEntries, shadowedEntries } = scanLayerEntries(workspaceRoot, 'all');

  // Filter by domain if specified
  let targetEntries = activeEntries;
  if (options.domain) {
    const dLower = options.domain.toLowerCase();
    targetEntries = activeEntries.filter(e => (e.domain || '').toLowerCase() === dLower);
  }

  const slugMap = new Map();
  for (const entry of activeEntries) {
    slugMap.set(entry.slug, entry);
  }

  const shadowedSet = new Set();
  for (const shadowed of shadowedEntries) {
    shadowedSet.add(`${shadowed.layerKey}:${shadowed.slug}`);
    shadowedSet.add(shadowed.slug);
  }

  const contradictions = [];
  const drifts = [];

  // 2. Multi-Vector Representations for Contradiction Detection
  const entryVectors = [];
  for (const entry of targetEntries) {
    let body = '';
    let fm = {};
    try {
      const raw = fs.readFileSync(entry.file, 'utf8');
      const parsed = parseYamlFrontmatter(raw);
      body = parsed.body || '';
      fm = parsed.frontmatter || {};
    } catch {}

    const multiVec = generateMultiVector({
      trigger: entry.trigger,
      body,
      slug: entry.slug,
      domain: entry.domain,
      type: entry.type,
      related: entry.related
    });

    entryVectors.push({
      entry,
      body,
      fm,
      multiVec
    });
  }

  // Cross-compare pairs for semantic contradictions
  for (let i = 0; i < entryVectors.length; i++) {
    for (let j = i + 1; j < entryVectors.length; j++) {
      const a = entryVectors[i];
      const b = entryVectors[j];

      // If one overrides the other, they are shadowed and not in contradiction
      if (a.entry.overrides === b.entry.slug || b.entry.overrides === a.entry.slug) {
        continue;
      }
      if (shadowedSet.has(`${a.entry.layerKey}:${a.entry.slug}`) || shadowedSet.has(`${b.entry.layerKey}:${b.entry.slug}`)) {
        continue;
      }

      // Check trigger/intent semantic similarity
      const triggerSim = computeDenseCosineSimilarity(a.multiVec.trigger_vector, b.multiVec.trigger_vector);
      const sameDomain = a.entry.domain && b.entry.domain && a.entry.domain === b.entry.domain;

      if (triggerSim >= threshold || (sameDomain && triggerSim >= 0.50)) {
        // Evaluate polarity or opposing mandates in triggers and bodies
        const textA = `${a.entry.trigger} ${a.body}`.toLowerCase();
        const textB = `${b.entry.trigger} ${b.body}`.toLowerCase();

        // Conflicting toolchain indicators
        const toolchains = [
          ['pnpm', 'npm'],
          ['pnpm', 'yarn'],
          ['yarn', 'npm'],
          ['bun', 'npm'],
          ['jest', 'vitest'],
          ['mocha', 'jest'],
          ['pipenv', 'poetry'],
          ['poetry', 'uv']
        ];

        let conflictReason = null;
        let severity = 'medium';

        for (const [tool1, tool2] of toolchains) {
          if ((textA.includes(tool1) && textB.includes(tool2)) || (textA.includes(tool2) && textB.includes(tool1))) {
            conflictReason = `Opposing toolchain recommendations: ${a.entry.slug} mandates '${tool1}' while ${b.entry.slug} mandates '${tool2}'.`;
            severity = 'high';
            break;
          }
        }

        // Direct mandate polarity conflict (always/require vs never/avoid)
        if (!conflictReason) {
          const positiveReg = /\b(always|must|require|required|enforce|mandatory|should always|ensure)\b/i;
          const negativeReg = /\b(never|do not|don't|prohibit|prohibited|forbidden|avoid|must not|cannot)\b/i;

          const aPos = positiveReg.test(textA);
          const aNeg = negativeReg.test(textA);
          const bPos = positiveReg.test(textB);
          const bNeg = negativeReg.test(textB);

          if ((aPos && bNeg) || (aNeg && bPos)) {
            conflictReason = `Direct directive polarity conflict: ${a.entry.slug} and ${b.entry.slug} prescribe conflicting mandatory vs prohibited rules for similar situations.`;
            severity = 'high';
          } else if (triggerSim >= 0.85) {
            conflictReason = `High trigger duplication without explicit inheritance: ${a.entry.slug} and ${b.entry.slug} fire on virtually identical scenarios (trigger similarity: ${Math.round(triggerSim * 100)}%).`;
            severity = 'medium';
          }
        }

        if (conflictReason) {
          contradictions.push({
            type: 'semantic_contradiction',
            severity,
            slug_a: a.entry.slug,
            layer_a: a.entry.layerKey,
            slug_b: b.entry.slug,
            layer_b: b.entry.layerKey,
            domain: a.entry.domain || 'general',
            trigger_similarity: Math.round(triggerSim * 100),
            conflict_reason: conflictReason,
            remediation: a.entry.layerKey !== b.entry.layerKey
              ? `Declare 'overrides: ${b.entry.layerKey === 'team' ? b.entry.slug : a.entry.slug}' in the higher-tier memory file.`
              : `Consolidate ${a.entry.slug} and ${b.entry.slug} into a unified rule via /kc-consolidate.`
          });
        }
      }
    }
  }

  // 3. Codebase Drift Detection
  // Check package.json engines if exists
  let targetNodeEngine = null;
  const pkgPath = path.join(workspaceRoot, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
      if (pkg.engines && pkg.engines.node) {
        targetNodeEngine = pkg.engines.node;
      }
    } catch {}
  }

  const now = Date.now();
  const ONE_DAY_MS = 24 * 3600 * 1000;

  for (const item of entryVectors) {
    const entry = item.entry;
    const fm = item.fm;
    const body = item.body;

    // A. Staleness drift: verified > 180 days or missing
    if (!entry.verified) {
      drifts.push({
        slug: entry.slug,
        layer: entry.layerKey,
        type: 'missing_verification',
        severity: 'low',
        detail: `Memory entry has no 'verified: YYYY-MM-DD' timestamp.`,
        remediation: `Inspect rule accuracy and add 'verified: ${new Date().toISOString().slice(0, 10)}'.`
      });
    } else {
      const vDate = new Date(entry.verified);
      if (!isNaN(vDate.getTime())) {
        const daysOld = Math.floor((now - vDate.getTime()) / ONE_DAY_MS);
        if (daysOld > 180) {
          drifts.push({
            slug: entry.slug,
            layer: entry.layerKey,
            type: 'staleness_drift',
            severity: daysOld > 365 ? 'high' : 'medium',
            detail: `Memory verified ${daysOld} days ago (last verified: ${entry.verified}). May no longer reflect modern conventions.`,
            remediation: `Re-validate rule against modern codebase and update 'verified:' timestamp or deprecate.`
          });
        }
      }
    }

    // B. Dangling override drift: overrides points to non-existent entry
    if (entry.overrides) {
      const targetSlug = entry.overrides;
      if (!slugMap.has(targetSlug)) {
        drifts.push({
          slug: entry.slug,
          layer: entry.layerKey,
          type: 'dangling_override_drift',
          severity: 'medium',
          detail: `Entry declares 'overrides: ${targetSlug}', but target slug '${targetSlug}' does not exist in any lower tier.`,
          remediation: `Remove 'overrides: ${targetSlug}' or rename to matching upstream slug.`
        });
      }
    }

    // C. Broken related graph link drift
    if (Array.isArray(entry.related)) {
      for (const rel of entry.related) {
        if (rel && !slugMap.has(rel)) {
          drifts.push({
            slug: entry.slug,
            layer: entry.layerKey,
            type: 'broken_related_link',
            severity: 'low',
            detail: `Lateral related link '${rel}' points to a non-existent slug.`,
            remediation: `Prune or update '${rel}' in 'related:' frontmatter.`
          });
        }
      }
    }

    // D. Referenced file drift: checks if configuration files explicitly named in body exist
    const referencedFiles = [];
    const configMatches = body.match(/\b([a-zA-Z0-9_\-\.]+\.(json|ya?ml|toml|conf|config\.[a-z]+))\b/g);
    if (configMatches) {
      for (const cf of configMatches) {
        if (cf.startsWith('.') || cf.includes('config') || cf.includes('docker') || cf.includes('lint')) {
          referencedFiles.push(cf);
        }
      }
    }

    for (const ref of [...new Set(referencedFiles)]) {
      const fullPath = path.join(workspaceRoot, ref);
      if (!fs.existsSync(fullPath)) {
        drifts.push({
          slug: entry.slug,
          layer: entry.layerKey,
          type: 'referenced_file_missing',
          severity: 'medium',
          detail: `Memory references configuration file '${ref}' which does not exist in the current workspace.`,
          remediation: `Update memory to reflect current configuration files or remove obsolete reference.`
        });
      }
    }

    // E. Engine mismatch drift
    if (targetNodeEngine && body.includes('Node')) {
      const match = body.match(/Node(?:\.js)?\s+(?:v|version\s+)?([0-9]+)/i);
      if (match) {
        const statedVersion = parseInt(match[1], 10);
        const reqMatch = targetNodeEngine.match(/>=?\s*([0-9]+)/);
        if (reqMatch) {
          const minRequired = parseInt(reqMatch[1], 10);
          if (statedVersion < minRequired) {
            drifts.push({
              slug: entry.slug,
              layer: entry.layerKey,
              type: 'runtime_engine_drift',
              severity: 'high',
              detail: `Memory references Node ${statedVersion}, but repository enforces '${targetNodeEngine}'.`,
              remediation: `Update memory guideline to target current Node runtime requirement (${targetNodeEngine}).`
            });
          }
        }
      }
    }
  }

  return {
    workspace: workspaceRoot,
    total_memories_checked: entryVectors.length,
    contradictions_count: contradictions.length,
    drifts_count: drifts.length,
    status: (contradictions.length === 0 && drifts.length === 0) ? 'HEALTHY' : 'DRIFT_DETECTED',
    contradictions,
    drifts
  };
}
