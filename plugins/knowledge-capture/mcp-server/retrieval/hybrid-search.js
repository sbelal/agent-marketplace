import fs from 'node:fs';
import { getDatabase } from '../db/connection.js';
import { normalizeWorkspaceId } from '../core/storage-paths.js';
import { parseYamlFrontmatter } from '../core/yaml-parser.js';
import { findMarkdownFiles, scanLayerEntries } from './shadow-resolver.js';
import { tokenizeText, computeCosineSimilarity } from '../embeddings/heuristic-provider.js';
import { getActiveEmbeddingConfig, generateEmbedding } from '../embeddings/onnx-provider.js';
import { generateMultiVector, generateMultiVectorAsync, computeMultiVectorSimilarity } from '../embeddings/multi-vector.js';
import { readTelemetryJson, emitTelemetryEvent } from '../db/telemetry.js';
import { syncSqliteCore, getIndexLayerDirs, bufferOrJsonToArray } from '../db/indexer.js';
import path from 'node:path';

/**
 * Checks if the SQLite cache is dirty (files modified, added, deleted, or embedding dimension changed).
 * Pure query, side-effect free.
 */
export function isIndexDirty(workspaceRoot = process.cwd()) {
  const db = getDatabase();
  if (!db) return true;

  const { layerDirs, currentWsId } = getIndexLayerDirs(workspaceRoot);
  const activeConfig = getActiveEmbeddingConfig();

  try {
    const dimRow = db.prepare('SELECT val FROM meta WHERE key = ?').get('embedding_dim');
    if (!dimRow || parseInt(dimRow.val, 10) !== activeConfig.dimensions) {
      return true;
    }
  } catch {
    return true;
  }

  const checkRowStmt = db.prepare(
    'SELECT mtime, (trigger_vector IS NOT NULL AND content_vector IS NOT NULL AND entity_vector IS NOT NULL) AS has_vec FROM memories WHERE workspace_id = ? AND layer = ? AND team_slug = ? AND path = ?'
  );

  let diskCount = 0;
  for (const { dir, wsId, layer, teamSlug } of layerDirs) {
    const files = findMarkdownFiles(dir);
    for (const f of files) {
      const base = path.basename(f, '.md');
      if (base.toUpperCase() === 'README') continue;
      diskCount++;
      try {
        const stats = fs.statSync(f);
        const mtime = Math.floor(stats.mtimeMs);
        const row = checkRowStmt.get(wsId, layer, teamSlug, f);
        if (!row || row.mtime !== mtime || !row.has_vec) {
          return true;
        }
      } catch {
        return true;
      }
    }
  }

  try {
    const countRow = db.prepare(`SELECT count(*) as c FROM memories WHERE workspace_id = ? OR workspace_id = 'global'`).get(currentWsId);
    if ((countRow ? countRow.c : 0) !== diskCount) {
      return true;
    }
  } catch {
    return true;
  }

  return false;
}

/**
 * Synchronizes file metadata, FTS5 index, graph relationships, and semantic embeddings into SQLite.
 * Partitioned per workspace and layer (Workspace, Private, Team).
 */
export async function syncSqliteIndex(workspaceRoot = process.cwd()) {
  return syncSqliteCore(workspaceRoot, { computeVectors: true });
}

/**
 * File-based search fallback for environments without SQLite.
 */
export function searchMemoriesFileBasedFallback(workspaceRoot, queryText, options = {}) {
  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  const tokens = tokenizeText(queryText);
  if (!tokens.length) return [];

  const tele = readTelemetryJson();
  const teleLower = {};
  for (const [k, v] of Object.entries(tele)) {
    teleLower[k.toLowerCase()] = v;
  }

  const scored = [];
  const precedence = { workspace: 3, private: 2, team: 1 };

  for (const entry of activeEntries) {
    const entryTokens = tokenizeText(`${entry.slug} ${entry.domain} ${entry.type} ${entry.trigger}`);
    const sim = computeCosineSimilarity(tokens, entryTokens);

    let matchCount = 0;
    const lowerTrigger = entry.trigger.toLowerCase();
    const lowerSlug = entry.slug.toLowerCase();
    for (const t of tokens) {
      if (lowerTrigger.includes(t) || lowerSlug.includes(t)) {
        matchCount++;
      }
    }

    const keywordBoost = matchCount / tokens.length;
    const combinedScore = (sim * 0.6) + (keywordBoost * 0.4);

    if (combinedScore > 0.05) {
      const tEntry = tele[entry.slug] || teleLower[entry.slug.toLowerCase()];
      const efficacyScore = typeof tEntry?.efficacy_score === 'number' ? tEntry.efficacy_score : 1.0;
      const baseConfidence = Math.round(Math.min(1.0, combinedScore * 1.5) * 100);
      const modulatedConfidence = Math.round(baseConfidence * (0.6 + 0.4 * efficacyScore));
      scored.push({
        slug: entry.slug,
        layer: entry.layerKey,
        teamSlug: entry.teamSlug || null,
        domain: entry.domain,
        type: entry.type,
        description: entry.trigger,
        confidence: modulatedConfidence,
        confidenceDecimal: modulatedConfidence / 100,
        efficacyScore,
        ...(efficacyScore < 0.6 ? { lowEfficacyWarning: `Memory efficacy rating is ${Math.round(efficacyScore * 100)}% due to prior test failures.` } : {}),
        related: entry.related || [],
        precedenceTier: precedence[entry.layerKey] || 0
      });
    }
  }

  scored.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.precedenceTier - a.precedenceTier;
  });

  const limit = options.limit || 5;
  return scored.slice(0, limit);
}

/**
 * Multi-Vector Hybrid Semantic Retrieval with Reciprocal Rank Fusion (RRF).
 * Respects CQS: Only syncs index if files have changed or if options.sync === true.
 * Supports token-budgeted hierarchical recall ('compact' vs 'full' format).
 */
export async function searchMemoriesHybrid(workspaceRoot, queryText, options = {}) {
  if (!queryText || typeof queryText !== 'string' || !queryText.trim()) {
    return [];
  }

  const db = getDatabase();
  if (!db) {
    return searchMemoriesFileBasedFallback(workspaceRoot, queryText, options);
  }

  // CQS & Dirty Check: only sync if explicitly requested or if files have changed
  if (options.sync === true || isIndexDirty(workspaceRoot)) {
    await syncSqliteIndex(workspaceRoot);
  }

  const cleanQuery = queryText.trim();
  const queryTokens = tokenizeText(cleanQuery);
  if (queryTokens.length === 0) return [];

  const activeConfig = getActiveEmbeddingConfig();
  const queryVec = await generateEmbedding(cleanQuery, activeConfig.dimensions);
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  const { activeEntries, shadowedEntries } = scanLayerEntries(workspaceRoot, 'all');
  const activeKeySet = new Set();
  for (const entry of activeEntries) {
    activeKeySet.add(`${entry.layerKey}:${entry.teamSlug || ''}:${entry.file}`);
  }

  const shadowedSet = new Set();
  for (const shadowed of shadowedEntries) {
    shadowedSet.add(`${shadowed.layerKey}:${shadowed.teamSlug || ''}:${shadowed.file}`);
    shadowedSet.add(`${shadowed.layerKey}:${shadowed.slug.toLowerCase()}`);
  }

  const allRows = db.prepare(`
    SELECT m.slug, m.layer, m.team_slug, m.workspace_id, m.domain, m.type, m.trigger, m.path,
           m.trigger_vector, m.content_vector, m.entity_vector,
           COALESCE(t.efficacy_score, 1.0) as efficacy_score,
           COALESCE(t.test_pass_count, 0) as test_pass_count,
           COALESCE(t.test_fail_count, 0) as test_fail_count
    FROM memories m
    LEFT JOIN telemetry t ON LOWER(m.slug) = LOWER(t.slug)
    WHERE (m.workspace_id = ? OR m.workspace_id = 'global')
  `).all(currentWsId);

  const precedence = { workspace: 3, private: 2, team: 1 };
  const allRowsMap = new Map();
  const activeRows = [];

  for (const r of allRows) {
    const teamSlug = r.team_slug || '';
    const fileKey = `${r.layer}:${teamSlug}:${r.path}`;
    const isActiveFile = activeKeySet.size > 0
      ? activeKeySet.has(fileKey)
      : !shadowedSet.has(`${r.layer}:${r.slug.toLowerCase()}`);
    if (!isActiveFile) {
      continue;
    }
    activeRows.push(r);
    const slugLower = r.slug.toLowerCase();
    const existing = allRowsMap.get(slugLower);
    if (!existing || (precedence[r.layer] || 0) > (precedence[existing.layer] || 0)) {
      allRowsMap.set(slugLower, r);
    }
  }

  const vecCandidates = [];
  for (const row of activeRows) {
    let multiVec = null;
    try {
      if (row.trigger_vector && row.content_vector && row.entity_vector) {
        const tVec = bufferOrJsonToArray(row.trigger_vector);
        const cVec = bufferOrJsonToArray(row.content_vector);
        const eVec = bufferOrJsonToArray(row.entity_vector);
        if (tVec && cVec && eVec && tVec.length === activeConfig.dimensions) {
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
    vecCandidates.push({ slugLower: row.slug.toLowerCase(), slug: row.slug, layer: row.layer, row, multiVecSim });
  }

  vecCandidates.sort((a, b) => b.multiVecSim - a.multiVecSim);
  const vecRankMap = new Map();
  vecCandidates.forEach((item, idx) => {
    if (item.multiVecSim > 0.05 && !vecRankMap.has(item.slugLower)) {
      vecRankMap.set(item.slugLower, { rank: idx + 1, sim: item.multiVecSim, row: item.row });
    }
  });

  const ftsQuery = queryTokens.map(tok => `"${tok}"*`).join(' OR ');
  let ftsMatches = [];
  try {
    const stmt = db.prepare(`
      SELECT f.slug, f.layer, f.team_slug, f.workspace_id, f.domain, f.type, f.trigger, f.content, bm25(memories_fts) as bm25_score,
             COALESCE(t.efficacy_score, 1.0) as efficacy_score
      FROM memories_fts f
      LEFT JOIN telemetry t ON LOWER(f.slug) = LOWER(t.slug)
      WHERE memories_fts MATCH ?
        AND (f.workspace_id = ? OR f.workspace_id = 'global')
      ORDER BY bm25_score ASC
      LIMIT 50
    `);
    ftsMatches = stmt.all(ftsQuery, currentWsId);
  } catch {
    return searchMemoriesFileBasedFallback(workspaceRoot, queryText, options);
  }

  const ftsRankMap = new Map();
  ftsMatches.forEach((row, idx) => {
    const slugLower = row.slug.toLowerCase();
    const teamSlug = row.team_slug || '';
    const activeRow = allRowsMap.get(slugLower);
    const isShadowed = activeRow && (activeRow.layer !== row.layer || (activeRow.team_slug || '') !== teamSlug);
    if (!isShadowed && !ftsRankMap.has(slugLower)) {
      ftsRankMap.set(slugLower, { rank: idx + 1, bm25_score: row.bm25_score, row });
    }
  });

  const candidateSlugs = new Set([...vecRankMap.keys(), ...ftsRankMap.keys()]);
  const candidateMap = new Map();

  const k = 60;
  const mode = options.mode || 'hybrid';

  const graphStmt = db.prepare(`
    SELECT target_slug, rel_type FROM memories_graph
    WHERE (workspace_id = ? OR workspace_id = 'global')
      AND source_layer = ? AND source_team_slug = ? AND LOWER(source_slug) = ?
  `);

  for (const slugLower of candidateSlugs) {
    const vecItem = vecRankMap.get(slugLower);
    const ftsItem = ftsRankMap.get(slugLower);
    const baseRow = allRowsMap.get(slugLower) || (ftsItem && ftsItem.row) || (vecItem && vecItem.row);
    if (!baseRow) continue;

    let rrfScore = 0;
    if (mode === 'lexical') {
      rrfScore = ftsItem ? (1.0 / (k + ftsItem.rank)) : 0;
    } else if (mode === 'multi_vector') {
      rrfScore = vecItem ? (1.0 / (k + vecItem.rank)) : 0;
    } else {
      const ftsScore = ftsItem ? (0.45 / (k + ftsItem.rank)) : 0;
      const vecScore = vecItem ? (0.55 / (k + vecItem.rank)) : 0;
      rrfScore = ftsScore + vecScore;
    }

    if (rrfScore <= 0) continue;

    const maxTheoreticalRrf = 1.0 / 61.0;
    let confidenceDecimal = Math.min(1.0, Math.max(0.01, rrfScore / maxTheoreticalRrf));

    // Calibrate pure-semantic matches in hybrid mode by true vector cosine strength
    if (mode === 'hybrid' && !ftsItem && vecItem) {
      const rankDecay = 61.0 / (k + vecItem.rank);
      const simNormalized = Math.min(1.0, Math.max(0, (vecItem.sim - 0.12) / 0.33));
      const semanticConf = (0.20 + 0.65 * simNormalized) * rankDecay;
      confidenceDecimal = Math.min(1.0, Math.max(0.01, semanticConf));
    }

    const graphRows = graphStmt.all(currentWsId, baseRow.layer, baseRow.team_slug || '', slugLower);

    const efficacyScore = typeof baseRow.efficacy_score === 'number' ? baseRow.efficacy_score : 1.0;
    const baseConfidence = Math.round(confidenceDecimal * 100);
    const modulatedConfidence = Math.round(baseConfidence * (0.6 + 0.4 * efficacyScore));

    const cand = {
      slug: baseRow.slug,
      layer: baseRow.layer,
      teamSlug: baseRow.team_slug || null,
      domain: baseRow.domain,
      type: baseRow.type,
      description: baseRow.trigger,
      confidence: modulatedConfidence,
      confidenceDecimal: modulatedConfidence / 100,
      efficacyScore,
      ...(efficacyScore < 0.6 ? { lowEfficacyWarning: `Memory efficacy rating is ${Math.round(efficacyScore * 100)}% due to prior test failures.` } : {}),
      related: graphRows.map(g => g.target_slug),
      precedenceTier: precedence[baseRow.layer] || 0
    };

    // Hierarchical Recall: Full body on demand
    if (options.format === 'full' && baseRow.path && fs.existsSync(baseRow.path)) {
      try {
        const fileContent = fs.readFileSync(baseRow.path, 'utf8');
        const parsed = parseYamlFrontmatter(fileContent);
        cand.content = parsed.body;
      } catch {}
    }

    const existing = candidateMap.get(slugLower);
    if (!existing) {
      candidateMap.set(slugLower, cand);
    } else if (cand.precedenceTier > existing.precedenceTier) {
      candidateMap.set(slugLower, cand);
    } else if (cand.precedenceTier === existing.precedenceTier && cand.confidence > existing.confidence) {
      candidateMap.set(slugLower, cand);
    }
  }

  const results = Array.from(candidateMap.values());
  results.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return b.precedenceTier - a.precedenceTier;
  });

  const limit = options.limit || 5;
  const topResults = results.slice(0, limit);

  // Asynchronous non-blocking telemetry emitter (preserves CQS while recording recall metrics)
  for (const item of topResults) {
    if (item.slug) emitTelemetryEvent(item.slug, 'recall');
  }

  return topResults;
}

