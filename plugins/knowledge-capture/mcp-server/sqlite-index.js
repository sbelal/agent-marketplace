import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveStoragePaths,
  findMarkdownFiles,
  parseYamlFrontmatter,
  scanLayerEntries
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

export function getDbPath() {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'knowledge-capture');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'cache.sqlite');
}

export function getTelemetryJsonPath() {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'knowledge-capture');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'telemetry.json');
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

    // Initialize Schema with workspace partitioning
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
        applies_to TEXT,
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
        last_recalled TEXT,
        last_applied TEXT
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
  for (const w of words) {
    features.push(`w:${w}`);
    if (w.length >= 3) {
      for (let i = 0; i <= w.length - 3; i++) {
        features.push(`3:${w.slice(i, i + 3)}`);
      }
    }
    if (w.length >= 4) {
      for (let i = 0; i <= w.length - 4; i++) {
        features.push(`4:${w.slice(i, i + 4)}`);
      }
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

/**
 * Generates multi-vector representation across 3 facets: trigger, content, entity.
 */
export function generateMultiVector(entry) {
  const triggerText = `${entry.trigger || entry.description || ''} ${JSON.stringify(entry.applies_to || '')}`;
  const contentText = typeof entry.body === 'string' ? entry.body : (entry.content || '');
  const entityText = `${entry.slug || ''} ${entry.domain || ''} ${entry.type || ''} ${(entry.related || []).join(' ')}`;

  return {
    trigger_vector: generateDenseEmbedding(triggerText, 128),
    content_vector: generateDenseEmbedding(contentText, 128),
    entity_vector: generateDenseEmbedding(entityText, 128)
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
 * Incrementally synchronizes SQLite index with filesystem markdown files.
 * Uses workspace_id partitioning to prevent cross-workspace data loss.
 */
export function syncSqliteIndex(workspaceRoot = process.cwd()) {
  const db = getDatabase();
  if (!db) {
    return { totalIndexed: 0, fileBasedFallback: true };
  }

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
    SELECT workspace_id, layer, slug, mtime 
    FROM memories 
    WHERE workspace_id = ? OR workspace_id = 'global'
  `).all(currentWsId);

  const existingMap = new Map();
  for (const row of existingRows) {
    existingMap.set(`${row.workspace_id}:${row.layer}:${row.slug}`, row.mtime);
  }

  // Prepared Statements
  const insertMeta = db.prepare(`
    INSERT INTO memories (
      workspace_id, layer, slug, domain, type, verified, trigger, path, mtime, applies_to,
      trigger_vector, content_vector, entity_vector
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, layer, slug) DO UPDATE SET
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      path=excluded.path,
      mtime=excluded.mtime,
      applies_to=excluded.applies_to,
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

  // Index new or modified files
  for (const [key, item] of currentFiles.entries()) {
    const prevMtime = existingMap.get(key);
    if (prevMtime && prevMtime === item.mtime) {
      continue; // File unchanged
    }

    try {
      const rawContent = fs.readFileSync(item.filePath, 'utf8');
      const parsed = parseYamlFrontmatter(rawContent);
      const fm = parsed.frontmatter;

      const domain = fm.domain || 'general';
      const type = fm.type || 'general';
      const verified = fm.verified || '';
      const trigger = fm.description || fm.trigger || '';
      const appliesTo = fm.applies_to ? JSON.stringify(fm.applies_to) : '';

      const multiVec = generateMultiVector({
        trigger,
        applies_to: fm.applies_to,
        body: parsed.body,
        slug: item.slug,
        domain,
        type,
        related: fm.related
      });

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
        appliesTo,
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
function searchMemoriesFileBasedFallback(workspaceRoot, queryText, options = {}) {
  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  if (activeEntries.length === 0) return [];

  const cleanQuery = queryText.trim();
  const queryTokens = tokenizeText(cleanQuery);
  if (queryTokens.length === 0) return [];

  const queryVec = generateDenseEmbedding(cleanQuery, 128);
  const precedence = { workspace: 3, private: 2, team: 1 };
  const results = [];

  for (const entry of activeEntries) {
    let body = '';
    try {
      const raw = fs.readFileSync(entry.file, 'utf8');
      const parsed = parseYamlFrontmatter(raw);
      body = parsed.body || '';
    } catch {}

    const multiVec = generateMultiVector({
      trigger: entry.trigger,
      applies_to: entry.applies_to,
      body,
      slug: entry.slug,
      domain: entry.domain,
      type: entry.type,
      related: entry.related
    });

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
 * Deterministically enforces Workspace > Private > Team precedence and active override shadowing.
 */
export function searchMemoriesHybrid(workspaceRoot, queryText, options = {}) {
  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    return [];
  }

  const db = getDatabase();
  if (!db) {
    return searchMemoriesFileBasedFallback(workspaceRoot, queryText, options);
  }

  syncSqliteIndex(workspaceRoot);

  const cleanQuery = queryText.trim();
  const queryTokens = tokenizeText(cleanQuery);
  if (queryTokens.length === 0) return [];

  const queryVec = generateDenseEmbedding(cleanQuery, 128);
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
    SELECT m.slug, m.layer, m.workspace_id, m.domain, m.type, m.trigger, m.applies_to,
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
        multiVec = {
          trigger_vector: JSON.parse(row.trigger_vector),
          content_vector: JSON.parse(row.content_vector),
          entity_vector: JSON.parse(row.entity_vector)
        };
      }
    } catch {}

    if (!multiVec) {
      multiVec = generateMultiVector({
        trigger: row.trigger,
        applies_to: row.applies_to ? JSON.parse(row.applies_to) : null,
        body: '',
        slug: row.slug,
        domain: row.domain,
        type: row.type
      });
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
    syncSqliteIndex(workspaceRoot);

    rawNodes = db.prepare(`
      SELECT m.slug as id, m.slug, m.layer, m.domain, m.type, m.verified, m.trigger as description,
             COALESCE(t.applied_count, 0) as applied_count,
             COALESCE(t.recalled_count, 0) as recalled_count
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
      recalled_count: tele[e.slug]?.recalled_count || 0
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

  return {
    nodes,
    links: validLinks,
    brokenLinks,
    summary: {
      totalNodes: nodes.length,
      totalLinks: validLinks.length,
      brokenLinksCount: brokenLinks.length,
      domains: [...new Set(nodes.map(n => n.domain))]
    }
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
    fs.writeFileSync(p, JSON.stringify(data, null, 2), 'utf8');
  } catch {}
}

/**
 * Records telemetry events (recall or application) for memory utility scoring.
 * Works seamlessly across both SQLite and JSON fallback modes.
 */
export function recordTelemetryEvent(slug, eventType = 'recall') {
  if (!slug) return;
  const db = getDatabase();
  const nowIso = new Date().toISOString();

  if (db) {
    try {
      if (eventType === 'apply') {
        db.prepare(`
          INSERT INTO telemetry (slug, applied_count, last_applied)
          VALUES (?, 1, ?)
          ON CONFLICT(slug) DO UPDATE SET
            applied_count = applied_count + 1,
            last_applied = excluded.last_applied
        `).run(slug, nowIso);
      } else {
        db.prepare(`
          INSERT INTO telemetry (slug, recalled_count, last_recalled)
          VALUES (?, 1, ?)
          ON CONFLICT(slug) DO UPDATE SET
            recalled_count = recalled_count + 1,
            last_recalled = excluded.last_recalled
        `).run(slug, nowIso);
      }
      return;
    } catch {}
  }

  // Fallback to telemetry.json
  const data = readTelemetryJson();
  if (!data[slug]) {
    data[slug] = { recalled_count: 0, applied_count: 0, last_recalled: null, last_applied: null };
  }
  if (eventType === 'apply') {
    data[slug].applied_count = (data[slug].applied_count || 0) + 1;
    data[slug].last_applied = nowIso;
  } else {
    data[slug].recalled_count = (data[slug].recalled_count || 0) + 1;
    data[slug].last_recalled = nowIso;
  }
  writeTelemetryJson(data);
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
      width: 320px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }

    h1 { font-size: 16px; font-weight: 600; display: flex; align-items: center; gap: 8px; }
    .metrics { font-size: 12px; color: var(--text-muted); display: flex; gap: 12px; }
    .metric-badge { background: #0f172a; padding: 4px 8px; border-radius: 6px; border: 1px solid var(--border); }

    input#search {
      width: 100%;
      background: #0f172a;
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 8px 12px;
      color: var(--text);
      font-size: 13px;
    }
    input#search:focus { outline: none; border-color: #3b82f6; }

    .domains { display: flex; flex-wrap: wrap; gap: 6px; max-height: 120px; overflow-y: auto; }
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

    .legend { display: flex; flex-direction: column; gap: 6px; font-size: 11px; color: var(--text-muted); }
    .legend-item { display: flex; align-items: center; gap: 8px; }
    .dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }

    #canvas-container { flex: 1; height: 100%; position: relative; }
    svg { width: 100%; height: 100%; }

    #drawer {
      position: absolute;
      top: 16px;
      right: 16px;
      bottom: 16px;
      width: 360px;
      background: rgba(30, 41, 59, 0.95);
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
    .drawer-desc { font-size: 13px; line-height: 1.5; color: #cbd5e1; }
    .drawer-section { border-top: 1px solid var(--border); padding-top: 10px; }
    .drawer-section h3 { font-size: 12px; text-transform: uppercase; color: var(--text-muted); margin-bottom: 6px; }
    .link-pill { display: inline-block; font-size: 11px; background: #0f172a; border: 1px solid var(--border); padding: 4px 8px; border-radius: 4px; margin: 2px; }
  </style>
</head>
<body>
  <div id="controls">
    <h1>🧠 Knowledge Graph</h1>
    <div class="metrics">
      <div class="metric-badge">Nodes: <span id="m-nodes">0</span></div>
      <div class="metric-badge">Edges: <span id="m-links">0</span></div>
      <div class="metric-badge">Domains: <span id="m-domains">0</span></div>
    </div>
    <input type="text" id="search" placeholder="Search memory slugs or triggers...">
    <div class="domains" id="domain-chips"></div>
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
    <div><span class="drawer-badge" id="d-badge"></span> <span style="font-size: 12px; color: var(--text-muted);" id="d-domain"></span></div>
    <div class="drawer-desc" id="d-desc"></div>
    <div class="drawer-section">
      <h3>Operational Utility</h3>
      <div style="font-size: 12px;" id="d-utility"></div>
    </div>
    <div class="drawer-section">
      <h3>Connected Lateral Memories (1-Hop Graph)</h3>
      <div id="d-links"></div>
    </div>
  </div>

  <script>
    const data = ${dataJson};

    document.getElementById('m-nodes').textContent = data.nodes.length;
    document.getElementById('m-links').textContent = data.links.length;
    document.getElementById('m-domains').textContent = data.summary.domains.length;

    const domainChipsContainer = document.getElementById('domain-chips');
    let selectedDomain = null;

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

    const g = svg.append("g");
    svg.call(d3.zoom().scaleExtent([0.1, 4]).on("zoom", (event) => g.attr("transform", event.transform)));

    const simulation = d3.forceSimulation(data.nodes)
      .force("link", d3.forceLink(data.links).id(d => d.id).distance(80))
      .force("charge", d3.forceManyBody().strength(-250))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide().radius(d => getRadius(d) + 12));

    const link = g.append("g")
      .selectAll("line")
      .data(data.links)
      .enter().append("line")
      .attr("stroke", d => d.type === 'overrides' ? "#f59e0b" : "#475569")
      .attr("stroke-width", d => d.type === 'overrides' ? 2 : 1.5)
      .attr("stroke-dasharray", d => d.type === 'overrides' ? "none" : "4 4");

    const node = g.append("g")
      .selectAll("circle")
      .data(data.nodes)
      .enter().append("circle")
      .attr("r", d => getRadius(d))
      .attr("fill", d => getNodeColor(d.layer))
      .attr("stroke", d => d.stale ? "#ef4444" : "#ffffff")
      .attr("stroke-width", d => d.stale ? 2.5 : 1)
      .attr("cursor", "pointer")
      .call(d3.drag()
        .on("start", dragstarted)
        .on("drag", dragged)
        .on("end", dragended))
      .on("click", (event, d) => showDrawer(d));

    const label = g.append("g")
      .selectAll("text")
      .data(data.nodes)
      .enter().append("text")
      .text(d => d.slug)
      .attr("font-size", 10)
      .attr("fill", "#cbd5e1")
      .attr("dx", 12)
      .attr("dy", 4)
      .attr("pointer-events", "none");

    simulation.on("tick", () => {
      link
        .attr("x1", d => d.source.x)
        .attr("y1", d => d.source.y)
        .attr("x2", d => d.target.x)
        .attr("y2", d => d.target.y);

      node
        .attr("cx", d => d.x)
        .attr("cy", d => d.y);

      label
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

    const searchInput = document.getElementById('search');
    searchInput.addEventListener('input', updateHighlights);

    function updateHighlights() {
      const query = searchInput.value.toLowerCase().trim();
      node.attr("opacity", d => {
        const matchesQuery = !query || d.slug.toLowerCase().includes(query) || (d.description && d.description.toLowerCase().includes(query));
        const matchesDomain = !selectedDomain || d.domain === selectedDomain;
        return (matchesQuery && matchesDomain) ? 1.0 : 0.15;
      });
      label.attr("opacity", d => {
        const matchesQuery = !query || d.slug.toLowerCase().includes(query) || (d.description && d.description.toLowerCase().includes(query));
        const matchesDomain = !selectedDomain || d.domain === selectedDomain;
        return (matchesQuery && matchesDomain) ? 1.0 : 0.15;
      });
      link.attr("opacity", d => {
        const srcMatch = (!query || d.source.slug.toLowerCase().includes(query)) && (!selectedDomain || d.source.domain === selectedDomain);
        const tgtMatch = (!query || d.target.slug.toLowerCase().includes(query)) && (!selectedDomain || d.target.domain === selectedDomain);
        return (srcMatch && tgtMatch) ? 0.8 : 0.05;
      });
    }

    const drawer = document.getElementById('drawer');
    document.getElementById('drawer-close').onclick = () => drawer.classList.remove('open');

    function showDrawer(d) {
      drawer.classList.add('open');
      document.getElementById('d-title').textContent = d.slug;
      const badge = document.getElementById('d-badge');
      badge.textContent = d.layer;
      badge.style.background = getNodeColor(d.layer);
      badge.style.color = '#fff';

      document.getElementById('d-domain').textContent = \`[\${d.domain}] • \${d.type}\`;
      document.getElementById('d-desc').textContent = d.description || 'No trigger condition defined.';
      document.getElementById('d-utility').innerHTML = \`
        <div>• <strong>Applied Count:</strong> \${d.applied_count || 0} times</div>
        <div>• <strong>Recalled Count:</strong> \${d.recalled_count || 0} times</div>
        <div>• <strong>Verified Date:</strong> \${d.verified || 'Missing'} \${d.stale ? '<span style=\"color:#ef4444\">(STALE > 180d)</span>' : '✅'}</div>
      \`;

      const connected = data.links
        .filter(l => (l.source.id === d.id || l.target.id === d.id))
        .map(l => (l.source.id === d.id ? l.target.slug : l.source.slug));

      const linksDiv = document.getElementById('d-links');
      linksDiv.innerHTML = '';
      if (connected.length === 0) {
        linksDiv.innerHTML = '<span style=\"font-size: 12px; color: var(--text-muted);\">No lateral connections.</span>';
      } else {
        [...new Set(connected)].forEach(slug => {
          const pill = document.createElement('span');
          pill.className = 'link-pill';
          pill.textContent = slug;
          linksDiv.appendChild(pill);
        });
      }
    }
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
      applies_to: entry.applies_to,
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

    // D. Referenced file drift: checks if files explicitly named in applies_to or body exist
    const referencedFiles = [];
    if (fm.applies_to && Array.isArray(fm.applies_to.file_patterns)) {
      for (const p of fm.applies_to.file_patterns) {
        if (!p.includes('*') && !p.includes('{')) referencedFiles.push(p);
      }
    }

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
