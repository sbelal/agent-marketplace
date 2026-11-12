import fs from 'node:fs';
import path from 'node:path';
import { getDatabase } from '../db/connection.js';
import { resolveStoragePaths, normalizeWorkspaceId } from '../core/storage-paths.js';
import { parseYamlFrontmatter } from '../core/yaml-parser.js';
import { findMarkdownFiles, scanLayerEntries } from '../retrieval/shadow-resolver.js';
import { readTelemetryJson } from '../db/telemetry.js';

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
    { layer: 'workspace', wsId: currentWsId, dir: paths.workspaceDir, teamSlug: null },
    { layer: 'private', wsId: 'global', dir: paths.privateDir, teamSlug: null }
  ];

  if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
    for (const tRepo of paths.activeTeamDirs) {
      layerDirs.push({ layer: 'team', wsId: 'global', dir: tRepo.dir, teamSlug: tRepo.slug });
    }
  } else {
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
      workspace_id, layer, slug, domain, type, verified, trigger, path, mtime, team_slug
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, layer, slug) DO UPDATE SET
      domain=excluded.domain,
      type=excluded.type,
      verified=excluded.verified,
      trigger=excluded.trigger,
      path=excluded.path,
      mtime=excluded.mtime,
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

  db.exec('BEGIN IMMEDIATE');
  try {
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
          item.mtime,
          item.teamSlug || null
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
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { totalIndexed: currentFiles.size };
}

/**
 * Returns complete referentially-validated knowledge graph data with bi-directional degree metrics.
 * Pure read query adhering to CQS (does not mutate SQLite metadata).
 */
export function getKnowledgeGraphData(workspaceRoot) {
  const db = getDatabase();
  const currentWsId = normalizeWorkspaceId(workspaceRoot);

  let rawNodes = [];
  let rawLinks = [];

  if (db) {
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
      SELECT DISTINCT source_slug as source, target_slug as target, rel_type as type
      FROM memories_graph
      WHERE workspace_id = ? OR workspace_id = 'global'
    `).all(currentWsId);
  } else {
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

    const seenFallbackLinks = new Set();
    for (const entry of activeEntries) {
      if (Array.isArray(entry.related)) {
        for (const rel of entry.related) {
          const key = `${entry.slug}->${rel}:related`;
          if (rel && !seenFallbackLinks.has(key)) {
            seenFallbackLinks.add(key);
            rawLinks.push({ source: entry.slug, target: rel, type: 'related' });
          }
        }
      }
      if (entry.overridesList) {
        for (const ov of entry.overridesList) {
          const key = `${entry.slug}->${ov}:overrides`;
          if (ov && !seenFallbackLinks.has(key)) {
            seenFallbackLinks.add(key);
            rawLinks.push({ source: entry.slug, target: ov, type: 'overrides' });
          }
        }
      }
    }
  }

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

  const now = Date.now();
  for (const node of nodes) {
    if (!node.verified) {
      node.stale = true;
    } else {
      const parsed = Date.parse(node.verified);
      node.stale = isNaN(parsed) || ((now - parsed) > 180 * 24 * 3600 * 1000);
    }
  }

  const validLinks = [];
  const brokenLinks = [];

  for (const l of rawLinks) {
    if (validNodeIds.has(l.source) && validNodeIds.has(l.target)) {
      validLinks.push(l);
    } else {
      brokenLinks.push(l);
    }
  }

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
      staleNodesCount: nodes.filter(n => n.stale).length,
      avgEfficacyScore: avgEfficacy,
      domains: Array.from(new Set(nodes.map(n => n.domain)))
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
