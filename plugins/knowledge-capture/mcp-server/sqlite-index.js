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
    INSERT INTO memories (workspace_id, layer, slug, domain, type, verified, trigger, path, mtime, applies_to)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, layer, slug) DO UPDATE SET
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      path=excluded.path,
      mtime=excluded.mtime,
      applies_to=excluded.applies_to
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
        appliesTo
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
 * Evaluates token cosine similarity and keyword matches directly from markdown files.
 */
function searchMemoriesFileBasedFallback(workspaceRoot, queryText, options = {}) {
  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  if (activeEntries.length === 0) return [];

  const queryTokens = tokenizeText(queryText);
  if (queryTokens.length === 0) return [];

  const precedence = { workspace: 3, private: 2, team: 1 };
  const results = [];

  for (const entry of activeEntries) {
    let body = '';
    try {
      const raw = fs.readFileSync(entry.file, 'utf8');
      const parsed = parseYamlFrontmatter(raw);
      body = parsed.body || '';
    } catch {}

    const docText = `${entry.slug} ${entry.domain} ${entry.type} ${entry.trigger} ${body}`;
    const docTokens = tokenizeText(docText);
    const cosineSim = computeCosineSimilarity(queryTokens, docTokens);

    // Keyword match frequency
    let matchCount = 0;
    for (const tok of queryTokens) {
      if (docText.toLowerCase().includes(tok)) matchCount++;
    }
    const tokenOverlap = queryTokens.length > 0 ? matchCount / queryTokens.length : 0;

    const combinedConfidence = Math.min(1.0, (cosineSim * 0.6) + (tokenOverlap * 0.4));
    if (combinedConfidence <= 0.05 && tokenOverlap === 0) continue;

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
 * Hybrid semantic search with deterministic precedence and override shadowing.
 * Combines SQLite FTS5 BM25 with token Cosine Similarity, or falls back to file-based search.
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

  // 2. FTS5 Match Query (prefix matches)
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

  const precedence = { workspace: 3, private: 2, team: 1 };
  const candidateMap = new Map(); // slug -> candidate

  for (const row of ftsMatches) {
    // Exclude shadowed lower-tier rules
    if (shadowedSet.has(`${row.layer}:${row.slug}`) || (row.layer === 'team' && shadowedSet.has(row.slug))) {
      continue;
    }

    const docTokens = tokenizeText(`${row.slug} ${row.domain} ${row.type} ${row.trigger} ${row.content}`);
    const cosineSim = computeCosineSimilarity(queryTokens, docTokens);

    // Normalize BM25 score (lower is better in SQLite bm25, typically -15 to 0)
    const normBm25 = Math.min(1.0, Math.max(0, -row.bm25_score / 15.0));
    const combinedConfidence = Math.min(1.0, (cosineSim * 0.6) + (normBm25 * 0.4));

    // Get 1-hop related memories from graph
    const graphRows = db.prepare(`
      SELECT target_slug, rel_type FROM memories_graph 
      WHERE (workspace_id = ? OR workspace_id = 'global') AND source_slug = ?
    `).all(currentWsId, row.slug);

    const cand = {
      slug: row.slug,
      layer: row.layer,
      domain: row.domain,
      type: row.type,
      description: row.trigger,
      confidence: Math.round(combinedConfidence * 100),
      confidenceDecimal: combinedConfidence,
      related: graphRows.map(g => g.target_slug),
      precedenceTier: precedence[row.layer] || 0
    };

    // Precedence-aware deduplication: Workspace > Private > Team
    const existing = candidateMap.get(row.slug);
    if (!existing) {
      candidateMap.set(row.slug, cand);
    } else if (cand.precedenceTier > existing.precedenceTier) {
      candidateMap.set(row.slug, cand);
    } else if (cand.precedenceTier === existing.precedenceTier && cand.confidence > existing.confidence) {
      candidateMap.set(row.slug, cand);
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
