import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from '../db/connection.js';
import { resolveStoragePaths, normalizeWorkspaceId } from '../core/storage-paths.js';
import { parseYamlFrontmatter } from '../core/yaml-parser.js';
import { findMarkdownFiles, scanLayerEntries } from './shadow-resolver.js';
import { tokenizeText, computeCosineSimilarity, computeDenseCosineSimilarity } from '../embeddings/heuristic-provider.js';
import { getActiveEmbeddingConfig, generateEmbedding } from '../embeddings/onnx-provider.js';
import { generateMultiVector, generateMultiVectorAsync, computeMultiVectorSimilarity } from '../embeddings/multi-vector.js';
import { readTelemetryJson, emitTelemetryEvent } from '../db/telemetry.js';

/**
 * Checks if the SQLite cache is dirty (files modified, added, deleted, or embedding dimension changed).
 * Pure query, side-effect free.
 */
export function isIndexDirty(workspaceRoot = process.cwd()) {
  const db = getDatabase();
  if (!db) return true;

  const paths = resolveStoragePaths(workspaceRoot);
  const currentWsId = normalizeWorkspaceId(workspaceRoot);
  const activeConfig = getActiveEmbeddingConfig();

  try {
    const dimRow = db.prepare('SELECT val FROM meta WHERE key = ?').get('embedding_dim');
    if (dimRow && parseInt(dimRow.val, 10) !== activeConfig.dimensions) {
      return true;
    }
  } catch {}

  const layerDirs = [
    { layer: 'workspace', wsId: currentWsId, dir: paths.workspaceDir },
    { layer: 'private', wsId: 'global', dir: paths.privateDir }
  ];
  if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
    for (const tRepo of paths.activeTeamDirs) {
      layerDirs.push({ layer: 'team', wsId: 'global', dir: tRepo.dir });
    }
  } else {
    layerDirs.push({ layer: 'team', wsId: 'global', dir: paths.teamDir });
  }

  let diskCount = 0;
  for (const { dir, wsId, layer } of layerDirs) {
    const files = findMarkdownFiles(dir);
    for (const f of files) {
      const base = path.basename(f, '.md');
      if (base.toUpperCase() === 'README') continue;
      diskCount++;
      try {
        const stats = fs.statSync(f);
        const mtime = Math.floor(stats.mtimeMs);
        const row = db.prepare('SELECT mtime FROM memories WHERE workspace_id = ? AND layer = ? AND slug = ?').get(wsId, layer, base);
        if (!row || row.mtime !== mtime) {
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

  const paths = resolveStoragePaths(workspaceRoot);
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  const layerDirs = [
    { layer: 'workspace', wsId: currentWsId, dir: paths.workspaceDir, teamSlug: null },
    { layer: 'private', wsId: 'global', dir: paths.privateDir, teamSlug: null }
  ];

  if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
    for (const tRepo of paths.activeTeamDirs) {
      layerDirs.push({ layer: 'team', wsId: 'global', dir: tRepo.dir, teamSlug: tRepo.slug });
    }
  } else if (!paths.settings?.teamRepos || paths.settings.teamRepos.length === 0) {
    layerDirs.push({ layer: 'team', wsId: 'global', dir: paths.teamDir, teamSlug: 'default' });
  }

  const currentFiles = new Map();

  for (const { layer, wsId, dir, teamSlug } of layerDirs) {
    const files = findMarkdownFiles(dir);
    for (const filePath of files) {
      const base = path.basename(filePath, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const stats = fs.statSync(filePath);
        const mtime = Math.floor(stats.mtimeMs);
        currentFiles.set(`${wsId}:${layer}:${base}`, { wsId, layer, slug: base, filePath, mtime, teamSlug });
      } catch {}
    }
  }

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

  const insertMeta = db.prepare(`
    INSERT INTO memories (
      workspace_id, layer, slug, domain, type, verified, trigger, path, mtime,
      trigger_vector, content_vector, entity_vector, team_slug
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, layer, slug) DO UPDATE SET
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      path=excluded.path,
      mtime=excluded.mtime,
      trigger_vector=excluded.trigger_vector,
      content_vector=excluded.content_vector,
      entity_vector=excluded.entity_vector,
      team_slug=excluded.team_slug
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

  const pendingUpdates = [];

  for (const [key, item] of currentFiles.entries()) {
    const prev = existingMap.get(key);
    if (prev && prev.mtime === item.mtime && prev.hasValidVector) {
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

      pendingUpdates.push({ item, domain, type, verified, trigger, body: parsed.body, fm, multiVec });
    } catch {}
  }

  // Atomically flush updates and deletions within an immediate transaction
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const u of pendingUpdates) {
      insertMeta.run(
        u.item.wsId,
        u.item.layer,
        u.item.slug,
        u.domain,
        u.type,
        u.verified,
        u.trigger,
        u.item.filePath,
        u.item.mtime,
        JSON.stringify(u.multiVec.trigger_vector),
        JSON.stringify(u.multiVec.content_vector),
        JSON.stringify(u.multiVec.entity_vector),
        u.item.teamSlug || null
      );

      deleteFts.run(u.item.wsId, u.item.layer, u.item.slug);
      insertFts.run(u.item.slug, u.domain, u.type, u.trigger, u.body, u.item.layer, u.item.wsId);

      deleteGraph.run(u.item.wsId, u.item.slug);
      if (Array.isArray(u.fm.related)) {
        for (const rel of u.fm.related) {
          if (rel) insertGraph.run(u.item.wsId, u.item.slug, rel, 'related');
        }
      }
      if (u.fm.overrides) {
        const overridesList = Array.isArray(u.fm.overrides) ? u.fm.overrides : [u.fm.overrides];
        for (const ov of overridesList) {
          if (ov) insertGraph.run(u.item.wsId, u.item.slug, ov, 'overrides');
        }
      }
    }

    // Delete removed files from DB
    const deleteMeta = db.prepare('DELETE FROM memories WHERE workspace_id = ? AND layer = ? AND slug = ?');
    for (const row of existingRows) {
      const key = `${row.workspace_id}:${row.layer}:${row.slug}`;
      if (!currentFiles.has(key)) {
        deleteMeta.run(row.workspace_id, row.layer, row.slug);
        deleteFts.run(row.workspace_id, row.layer, row.slug);
        deleteGraph.run(row.workspace_id, row.slug);
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
 * File-based search fallback for environments without SQLite.
 */
export function searchMemoriesFileBasedFallback(workspaceRoot, queryText, options = {}) {
  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  const tokens = tokenizeText(queryText);
  if (!tokens.length) return [];

  const tele = readTelemetryJson();
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
      const efficacyScore = typeof tele[entry.slug]?.efficacy_score === 'number' ? tele[entry.slug].efficacy_score : 1.0;
      const baseConfidence = Math.round(Math.min(1.0, combinedScore * 1.5) * 100);
      const modulatedConfidence = Math.round(baseConfidence * (0.6 + 0.4 * efficacyScore));
      scored.push({
        slug: entry.slug,
        layer: entry.layerKey,
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
  const activeSlugMap = new Map();
  for (const entry of activeEntries) {
    activeSlugMap.set(entry.slug, entry);
  }

  const shadowedSet = new Set();
  for (const shadowed of shadowedEntries) {
    shadowedSet.add(`${shadowed.layerKey}:${shadowed.slug}`);
    shadowedSet.add(shadowed.slug);
  }

  const allRows = db.prepare(`
    SELECT m.slug, m.layer, m.workspace_id, m.domain, m.type, m.trigger, m.path,
           m.trigger_vector, m.content_vector, m.entity_vector,
           COALESCE(t.efficacy_score, 1.0) as efficacy_score,
           COALESCE(t.test_pass_count, 0) as test_pass_count,
           COALESCE(t.test_fail_count, 0) as test_fail_count
    FROM memories m
    LEFT JOIN telemetry t ON m.slug = t.slug
    WHERE (m.workspace_id = ? OR m.workspace_id = 'global')
  `).all(currentWsId);

  const precedence = { workspace: 3, private: 2, team: 1 };
  const allRowsMap = new Map();
  const allRowsLayerMap = new Map();
  for (const r of allRows) {
    if (shadowedSet.has(`${r.layer}:${r.slug}`) || (r.layer === 'team' && shadowedSet.has(r.slug))) {
      continue;
    }
    allRowsLayerMap.set(`${r.layer}:${r.slug}`, r);
    const existing = allRowsMap.get(r.slug);
    if (!existing || (precedence[r.layer] || 0) > (precedence[existing.layer] || 0)) {
      allRowsMap.set(r.slug, r);
    }
  }

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

  const ftsQuery = queryTokens.map(tok => `"${tok}"*`).join(' OR ');
  let ftsMatches = [];
  try {
    const stmt = db.prepare(`
      SELECT f.slug, f.layer, f.workspace_id, f.domain, f.type, f.trigger, f.content, bm25(memories_fts) as bm25_score,
             COALESCE(t.efficacy_score, 1.0) as efficacy_score
      FROM memories_fts f
      LEFT JOIN telemetry t ON f.slug = t.slug
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
    if (!shadowedSet.has(`${row.layer}:${row.slug}`) && !(row.layer === 'team' && shadowedSet.has(row.slug))) {
      ftsRankMap.set(row.slug, { rank: idx + 1, bm25_score: row.bm25_score, row });
    }
  });

  const candidateSlugs = new Set([...vecRankMap.keys(), ...ftsRankMap.keys()]);
  const candidateMap = new Map();

  const k = 60;
  const mode = options.mode || 'hybrid';

  for (const slug of candidateSlugs) {
    const vecItem = vecRankMap.get(slug);
    const ftsItem = ftsRankMap.get(slug);
    const baseRow = allRowsMap.get(slug) || (ftsItem && ftsItem.row) || (vecItem && vecItem.row);
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
    const confidenceDecimal = Math.min(1.0, Math.max(0.01, rrfScore / maxTheoreticalRrf));

    const graphRows = db.prepare(`
      SELECT target_slug, rel_type FROM memories_graph 
      WHERE (workspace_id = ? OR workspace_id = 'global') AND source_slug = ?
    `).all(currentWsId, slug);

    const efficacyScore = typeof baseRow.efficacy_score === 'number' ? baseRow.efficacy_score : 1.0;
    const baseConfidence = Math.round(confidenceDecimal * 100);
    const modulatedConfidence = Math.round(baseConfidence * (0.6 + 0.4 * efficacyScore));

    const cand = {
      slug: baseRow.slug,
      layer: baseRow.layer,
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
  const topResults = results.slice(0, limit);

  // Asynchronous non-blocking telemetry emitter (preserves CQS while recording recall metrics)
  for (const item of topResults) {
    if (item.slug) emitTelemetryEvent(item.slug, 'recall');
  }

  return topResults;
}

