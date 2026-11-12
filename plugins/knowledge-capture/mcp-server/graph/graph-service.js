import path from 'node:path';
import { getDatabase } from '../db/connection.js';
import { normalizeWorkspaceId } from '../core/storage-paths.js';
import { scanLayerEntries } from '../retrieval/shadow-resolver.js';
import { readTelemetryJson } from '../db/telemetry.js';
import { syncSqliteMetadataSync } from '../db/indexer.js';

/**
 * Synchronously synchronizes file metadata, FTS5 text, and graph relationships into SQLite.
 * Delegates to shared syncSqliteMetadataSync so table schemas never diverge.
 */
export function syncSqliteMetadata(workspaceRoot = process.cwd()) {
  return syncSqliteMetadataSync(workspaceRoot);
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
      SELECT m.slug as id, m.slug, m.layer, m.team_slug, m.domain, m.type, m.verified, m.trigger as description,
             COALESCE(t.applied_count, 0) as applied_count,
             COALESCE(t.recalled_count, 0) as recalled_count,
             COALESCE(t.test_pass_count, 0) as test_pass_count,
             COALESCE(t.test_fail_count, 0) as test_fail_count,
             COALESCE(t.efficacy_score, 1.0) as efficacy_score
      FROM memories m
      LEFT JOIN telemetry t ON LOWER(m.slug) = LOWER(t.slug)
      WHERE m.workspace_id = ? OR m.workspace_id = 'global'
    `).all(currentWsId);

    rawLinks = db.prepare(`
      SELECT DISTINCT source_layer, source_team_slug, source_slug as source, target_slug as target, rel_type as type
      FROM memories_graph
      WHERE workspace_id = ? OR workspace_id = 'global'
    `).all(currentWsId);
  } else {
    const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
    const tele = readTelemetryJson();
    const teleLower = {};
    for (const [k, v] of Object.entries(tele)) {
      teleLower[k.toLowerCase()] = v;
    }

    rawNodes = activeEntries.map(e => {
      const tEntry = tele[e.slug] || teleLower[e.slug.toLowerCase()];
      return {
        id: e.slug,
        slug: e.slug,
        layer: e.layerKey,
        team_slug: e.teamSlug || '',
        domain: e.domain,
        type: e.type,
        verified: e.verified,
        description: e.trigger,
        applied_count: tEntry?.applied_count || 0,
        recalled_count: tEntry?.recalled_count || 0,
        test_pass_count: tEntry?.test_pass_count || 0,
        test_fail_count: tEntry?.test_fail_count || 0,
        efficacy_score: typeof tEntry?.efficacy_score === 'number' ? tEntry.efficacy_score : 1.0
      };
    });

    const seenFallbackLinks = new Set();
    for (const entry of activeEntries) {
      if (Array.isArray(entry.related)) {
        for (const rel of entry.related) {
          const key = `${entry.slug}->${rel}:related`;
          if (rel && !seenFallbackLinks.has(key)) {
            seenFallbackLinks.add(key);
            rawLinks.push({
              source_layer: entry.layerKey,
              source_team_slug: entry.teamSlug || '',
              source: entry.slug,
              target: rel,
              type: 'related'
            });
          }
        }
      }
      if (entry.overridesList) {
        for (const ov of entry.overridesList) {
          const key = `${entry.slug}->${ov}:overrides`;
          if (ov && !seenFallbackLinks.has(key)) {
            seenFallbackLinks.add(key);
            rawLinks.push({
              source_layer: entry.layerKey,
              source_team_slug: entry.teamSlug || '',
              source: entry.slug,
              target: ov,
              type: 'overrides'
            });
          }
        }
      }
    }
  }

  const nodeMap = new Map();
  const precedence = { workspace: 3, private: 2, team: 1 };
  for (const n of rawNodes) {
    const slugKey = n.slug.toLowerCase();
    const existing = nodeMap.get(slugKey);
    if (!existing || (precedence[n.layer] || 0) > (precedence[existing.layer] || 0)) {
      nodeMap.set(slugKey, n);
    }
  }

  const nodes = Array.from(nodeMap.values());
  const validNodeIdLookup = new Map(nodes.map(n => [n.id.toLowerCase(), n.id]));
  const activeNodeKeys = new Set(nodes.map(n => `${n.layer}:${n.team_slug || ''}:${n.slug.toLowerCase()}`));

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
    // Exclude links originating from shadowed lower-tier memories
    if (l.source_layer && !activeNodeKeys.has(`${l.source_layer}:${l.source_team_slug || ''}:${l.source.toLowerCase()}`)) {
      continue;
    }
    const canonicalSource = validNodeIdLookup.get(String(l.source || '').toLowerCase());
    const canonicalTarget = validNodeIdLookup.get(String(l.target || '').toLowerCase());
    if (canonicalSource && canonicalTarget) {
      validLinks.push({ source: canonicalSource, target: canonicalTarget, type: l.type });
    } else {
      brokenLinks.push({ source: canonicalSource || l.source, target: canonicalTarget || l.target, type: l.type });
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
 * Supports depth (1 to 3) to retrieve full multi-hop spanning tree.
 */
export function getMemoryGraphNeighbors(workspaceRoot, slug, options = {}) {
  if (!slug) return { slug: '', outgoing: [], incoming: [] };
  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  const cleanKey = cleanSlug.toLowerCase();
  const depth = typeof options === 'number' ? options : (options.depth || 1);

  if (depth > 1) {
    return getMemorySpanningTree(workspaceRoot, cleanSlug, typeof options === 'object' ? options : { depth });
  }

  const graph = getKnowledgeGraphData(workspaceRoot);
  const targetNode = graph.nodes.find(n => n.id.toLowerCase() === cleanKey || n.slug.toLowerCase() === cleanKey);

  const outgoing = graph.links
    .filter(l => l.source.toLowerCase() === cleanKey)
    .map(l => ({ target_slug: l.target, rel_type: l.type }));

  const incoming = graph.links
    .filter(l => l.target.toLowerCase() === cleanKey)
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
 * GraphRAG Multi-Hop Spanning Tree Recall.
 * Traverses bi-directional relationships (outgoing related/overrides and incoming backlinks)
 * up to maxDepth (1 to 3) to construct an interconnected sub-graph context envelope.
 */
export function getMemorySpanningTree(workspaceRoot, rootSlug, options = {}) {
  const maxDepth = Math.max(1, Math.min(3, parseInt(options.maxDepth ?? options.depth ?? 2, 10) || 2));
  const maxNodes = Math.max(1, Math.min(30, parseInt(options.maxNodes || 15, 10) || 15));
  if (!rootSlug) {
    return { rootSlug: '', depth: maxDepth, totalDiscovered: 0, nodes: [], links: [], contextEnvelope: '' };
  }

  const cleanRoot = path.basename(rootSlug.trim()).replace(/\.md$/i, '').toLowerCase();
  const graph = getKnowledgeGraphData(workspaceRoot);
  const nodeLookup = new Map(graph.nodes.map(n => [n.id.toLowerCase(), n]));

  const rootNode = nodeLookup.get(cleanRoot);
  if (!rootNode) {
    return { rootSlug: cleanRoot, depth: maxDepth, totalDiscovered: 0, nodes: [], links: [], contextEnvelope: '' };
  }

  const visitedSlugs = new Set([cleanRoot]);
  const discoveredNodes = [{ ...rootNode, hop: 0, pathFromRoot: [cleanRoot] }];
  const discoveredLinks = [];
  const seenLinkKeys = new Set();

  let currentLevel = [cleanRoot];

  for (let hop = 1; hop <= maxDepth; hop++) {
    const nextLevel = [];
    for (const currentSlug of currentLevel) {
      if (discoveredNodes.length >= maxNodes) break;

      // Outgoing links
      const outgoing = graph.links.filter(l => l.source.toLowerCase() === currentSlug);
      for (const link of outgoing) {
        const targetSlug = link.target.toLowerCase();
        const linkKey = `${link.source.toLowerCase()}->${link.target.toLowerCase()}:${link.type}`;
        if (!seenLinkKeys.has(linkKey)) {
          seenLinkKeys.add(linkKey);
          discoveredLinks.push({ source: link.source, target: link.target, type: link.type, hop, direction: 'outgoing' });
        }
        if (!visitedSlugs.has(targetSlug)) {
          visitedSlugs.add(targetSlug);
          const targetNode = nodeLookup.get(targetSlug);
          if (targetNode) {
            discoveredNodes.push({ ...targetNode, hop, relation: link.type, direction: 'outgoing', parent: currentSlug });
            nextLevel.push(targetSlug);
          }
          if (discoveredNodes.length >= maxNodes) break;
        }
      }

      // Incoming backlinks
      const incoming = graph.links.filter(l => l.target.toLowerCase() === currentSlug);
      for (const link of incoming) {
        const sourceSlug = link.source.toLowerCase();
        const backlinkKey = `${link.source.toLowerCase()}->${link.target.toLowerCase()}:${link.type}`;
        if (!seenLinkKeys.has(backlinkKey)) {
          seenLinkKeys.add(backlinkKey);
          discoveredLinks.push({ source: link.source, target: link.target, type: link.type, hop, direction: 'incoming' });
        }
        if (!visitedSlugs.has(sourceSlug)) {
          visitedSlugs.add(sourceSlug);
          const sourceNode = nodeLookup.get(sourceSlug);
          if (sourceNode) {
            discoveredNodes.push({ ...sourceNode, hop, relation: link.type, direction: 'incoming', parent: currentSlug });
            nextLevel.push(sourceSlug);
          }
          if (discoveredNodes.length >= maxNodes) break;
        }
      }
    }
    currentLevel = nextLevel;
    if (currentLevel.length === 0 || discoveredNodes.length >= maxNodes) break;
  }

  let envelope = `### 🌐 GraphRAG Spanning Tree Context Envelope (Depth: ${maxDepth}, ${discoveredNodes.length} Nodes Connected)\n\n`;
  envelope += `* **Root Memory:** \`[${rootNode.layer}] ${rootNode.slug}\` (${rootNode.type}) — ${rootNode.description}\n`;

  const hopNodes = discoveredNodes.filter(n => n.hop > 0);
  if (hopNodes.length > 0) {
    envelope += `* **Connected Knowledge Graph Sub-Tree:**\n`;
    for (const n of hopNodes) {
      const indent = '  '.repeat(n.hop);
      const relTag = n.direction === 'outgoing' ? `${n.relation}` : `referenced_by (${n.relation})`;
      envelope += `${indent}- [Hop ${n.hop}: ${relTag}] **[${n.layer}] ${n.slug}** (${n.type}): ${n.description}\n`;
    }
  }

  return {
    rootSlug: cleanRoot,
    depth: maxDepth,
    totalDiscovered: discoveredNodes.length,
    nodes: discoveredNodes,
    links: discoveredLinks,
    edges: discoveredLinks,
    contextEnvelope: envelope.trim()
  };
}

