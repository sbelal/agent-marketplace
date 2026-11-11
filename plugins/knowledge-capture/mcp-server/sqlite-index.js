import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import {
  resolveStoragePaths,
  findMarkdownFiles,
  parseYamlFrontmatter
} from './memory-service.js';

/**
 * sqlite-index.js
 * 
 * High-performance, zero-dependency SQLite FTS5 & Graph index cache for Knowledge Capture.
 * Stored at ~/.gemini/knowledge-capture/cache.sqlite.
 * Flat Markdown files remain the canonical version-controlled source of truth.
 */

export function getDbPath() {
  const home = os.homedir();
  const dir = path.join(home, '.gemini', 'knowledge-capture');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, 'cache.sqlite');
}

let dbInstance = null;

export function getDatabase() {
  if (dbInstance) return dbInstance;
  const dbPath = getDbPath();
  const db = new DatabaseSync(dbPath);

  // Initialize Schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      val TEXT
    );

    CREATE TABLE IF NOT EXISTS memories (
      layer TEXT,
      slug TEXT,
      domain TEXT,
      type TEXT,
      verified TEXT,
      trigger TEXT,
      path TEXT,
      mtime INTEGER,
      applies_to TEXT,
      PRIMARY KEY (layer, slug)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      slug,
      domain,
      type,
      trigger,
      content,
      layer UNINDEXED,
      tokenize='porter unicode61'
    );

    CREATE TABLE IF NOT EXISTS memories_graph (
      source_slug TEXT,
      target_slug TEXT,
      rel_type TEXT,
      PRIMARY KEY (source_slug, target_slug, rel_type)
    );

    CREATE TABLE IF NOT EXISTS telemetry (
      slug TEXT PRIMARY KEY,
      recalled_count INTEGER DEFAULT 0,
      applied_count INTEGER DEFAULT 0,
      last_recalled TEXT,
      last_applied TEXT
    );
  `);

  dbInstance = db;
  return dbInstance;
}

/**
 * Tokenizes text into a normalized set of lowercase words.
 */
function tokenizeText(str) {
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
function computeCosineSimilarity(tokensA, tokensB) {
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
 * Incrementally synchronizes SQLite index with the filesystem markdown files.
 */
export function syncSqliteIndex(workspaceRoot = process.cwd()) {
  const db = getDatabase();
  const paths = resolveStoragePaths(workspaceRoot);

  const layerDirs = [
    { layer: 'workspace', dir: paths.workspaceDir },
    { layer: 'private', dir: paths.privateDir },
    { layer: 'team', dir: paths.teamDir }
  ];

  const currentFiles = new Map(); // key: "layer:slug" -> file info

  for (const { layer, dir } of layerDirs) {
    const files = findMarkdownFiles(dir);
    for (const filePath of files) {
      const base = path.basename(filePath, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const stats = fs.statSync(filePath);
        const mtime = Math.floor(stats.mtimeMs);
        currentFiles.set(`${layer}:${base}`, { layer, slug: base, filePath, mtime });
      } catch {}
    }
  }

  // Find existing indexed records
  const existingRows = db.prepare('SELECT layer, slug, mtime FROM memories').all();
  const existingMap = new Map();
  for (const row of existingRows) {
    existingMap.set(`${row.layer}:${row.slug}`, row.mtime);
  }

  // Statements
  const insertMeta = db.prepare(`
    INSERT INTO memories (layer, slug, domain, type, verified, trigger, path, mtime, applies_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(layer, slug) DO UPDATE SET
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      path=excluded.path,
      mtime=excluded.mtime,
      applies_to=excluded.applies_to
  `);

  const deleteFts = db.prepare('DELETE FROM memories_fts WHERE layer = ? AND slug = ?');
  const insertFts = db.prepare(`
    INSERT INTO memories_fts (slug, domain, type, trigger, content, layer)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const deleteGraph = db.prepare('DELETE FROM memories_graph WHERE source_slug = ?');
  const insertGraph = db.prepare(`
    INSERT OR IGNORE INTO memories_graph (source_slug, target_slug, rel_type)
    VALUES (?, ?, ?)
  `);

  // Index new or modified files
  for (const [key, item] of currentFiles.entries()) {
    const prevMtime = existingMap.get(key);
    if (prevMtime && prevMtime === item.mtime) {
      continue; // Unchanged
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

      insertMeta.run(
        item.layer,
        item.slug,
        domain,
        type,
        verified,
        trigger,
        item.filePath,
        item.mtime,
        appliesTo
      );

      deleteFts.run(item.layer, item.slug);
      insertFts.run(item.slug, domain, type, trigger, parsed.body, item.layer);

      deleteGraph.run(item.slug);
      if (Array.isArray(fm.related)) {
        for (const rel of fm.related) {
          if (rel) insertGraph.run(item.slug, rel, 'related');
        }
      }
      if (fm.overrides) {
        const overridesList = Array.isArray(fm.overrides) ? fm.overrides : [fm.overrides];
        for (const ov of overridesList) {
          if (ov) insertGraph.run(item.slug, ov, 'overrides');
        }
      }
    } catch {}
  }

  // Remove records for deleted files
  const deleteMeta = db.prepare('DELETE FROM memories WHERE layer = ? AND slug = ?');
  for (const row of existingRows) {
    const key = `${row.layer}:${row.slug}`;
    if (!currentFiles.has(key)) {
      deleteMeta.run(row.layer, row.slug);
      deleteFts.run(row.layer, row.slug);
      deleteGraph.run(row.slug);
    }
  }

  return { totalIndexed: currentFiles.size };
}

/**
 * Searches memories using SQLite FTS5 BM25 combined with token Cosine Similarity.
 */
export function searchMemoriesHybrid(workspaceRoot, queryText, options = {}) {
  const db = getDatabase();
  syncSqliteIndex(workspaceRoot);

  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    return [];
  }

  const cleanQuery = queryText.trim();
  const queryTokens = tokenizeText(cleanQuery);
  if (queryTokens.length === 0) return [];

  // 1. FTS5 Match Query (prefix matches)
  const ftsQuery = queryTokens.map(tok => `"${tok}"*`).join(' OR ');
  let ftsMatches = [];
  try {
    const stmt = db.prepare(`
      SELECT f.slug, f.layer, f.domain, f.type, f.trigger, f.content, bm25(memories_fts) as bm25_score
      FROM memories_fts f
      WHERE memories_fts MATCH ?
      ORDER BY bm25_score ASC
      LIMIT 25
    `);
    ftsMatches = stmt.all(ftsQuery);
  } catch {
    // Fallback if FTS syntax error
    ftsMatches = [];
  }

  // Precedence map: Workspace > Private > Team
  const precedence = { workspace: 3, private: 2, team: 1 };

  // Calculate scores
  const results = [];
  const seenSlugs = new Set();

  for (const row of ftsMatches) {
    if (seenSlugs.has(row.slug)) continue;
    seenSlugs.add(row.slug);

    const docTokens = tokenizeText(`${row.slug} ${row.domain} ${row.type} ${row.trigger} ${row.content}`);
    const cosineSim = computeCosineSimilarity(queryTokens, docTokens);

    // Normalize BM25 score (lower is better in SQLite bm25, typically -10 to 0)
    const normBm25 = Math.min(1.0, Math.max(0, -row.bm25_score / 15.0));
    const combinedConfidence = Math.min(1.0, (cosineSim * 0.6) + (normBm25 * 0.4));

    // Get 1-hop related memories from graph
    const graphRows = db.prepare(`
      SELECT target_slug, rel_type FROM memories_graph WHERE source_slug = ?
    `).all(row.slug);

    results.push({
      slug: row.slug,
      layer: row.layer,
      domain: row.domain,
      type: row.type,
      description: row.trigger,
      confidence: Math.round(combinedConfidence * 100),
      confidenceDecimal: combinedConfidence,
      related: graphRows.map(g => g.target_slug),
      precedenceTier: precedence[row.layer] || 0
    });
  }

  // Sort by confidence desc, then precedence tier desc
  results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.precedenceTier - a.precedenceTier;
  });

  const limit = options.limit || 5;
  return results.slice(0, limit);
}

/**
 * Retrieves the complete Knowledge Graph data for visualization (D3 / SVG canvas).
 */
export function getKnowledgeGraphData(workspaceRoot) {
  const db = getDatabase();
  syncSqliteIndex(workspaceRoot);

  const nodes = db.prepare(`
    SELECT m.slug as id, m.slug, m.layer, m.domain, m.type, m.verified, m.trigger as description,
           COALESCE(t.applied_count, 0) as applied_count,
           COALESCE(t.recalled_count, 0) as recalled_count
    FROM memories m
    LEFT JOIN telemetry t ON m.slug = t.slug
  `).all();

  const links = db.prepare(`
    SELECT source_slug as source, target_slug as target, rel_type as type
    FROM memories_graph
  `).all();

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

  return {
    nodes,
    links,
    summary: {
      totalNodes: nodes.length,
      totalLinks: links.length,
      domains: [...new Set(nodes.map(n => n.domain))]
    }
  };
}

/**
 * Records telemetry events (recall or application) for memory utility scoring.
 */
export function recordTelemetryEvent(slug, eventType = 'recall') {
  if (!slug) return;
  const db = getDatabase();
  const nowIso = new Date().toISOString();

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
}
