import fs from 'node:fs';
import path from 'node:path';
import { scanLayerEntries } from '../retrieval/shadow-resolver.js';
import { parseYamlFrontmatter } from '../core/yaml-parser.js';
import { generateMultiVector } from '../embeddings/multi-vector.js';
import { computeDenseCosineSimilarity } from '../embeddings/heuristic-provider.js';

/**
 * Memory Dreaming & Autonomous Semantic Synthesis Engine (/kc-dream).
 * 
 * Performs offline semantic synthesis across memory stores:
 * 1. Clusters memories by intent and semantic similarity.
 * 2. Detects fragmented facets of common systems (e.g. separate narrow rules on scaling).
 * 3. Synthesizes a unified consolidated master candidate proposal.
 */
export function dreamMemoryConsolidation(workspaceRoot = process.cwd(), options = {}) {
  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.65;
  const targetDomain = options.domain ? options.domain.toLowerCase() : null;

  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  let candidates = activeEntries;
  if (targetDomain) {
    candidates = activeEntries.filter(e => (e.domain || '').toLowerCase() === targetDomain);
  }

  const items = [];
  for (const entry of candidates) {
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

    items.push({
      slug: entry.slug,
      layer: entry.layerKey,
      domain: entry.domain || 'general',
      type: entry.type || 'convention',
      trigger: entry.trigger,
      body,
      related: entry.related || [],
      overrides: entry.overrides || null,
      multiVec
    });
  }

  // Cluster related memories
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < items.length; i++) {
    if (assigned.has(items[i].slug)) continue;

    const clusterMembers = [items[i]];
    assigned.add(items[i].slug);

    for (let j = i + 1; j < items.length; j++) {
      if (assigned.has(items[j].slug)) continue;

      const triggerSim = computeDenseCosineSimilarity(
        items[i].multiVec.trigger_vector,
        items[j].multiVec.trigger_vector
      );
      const contentSim = computeDenseCosineSimilarity(
        items[i].multiVec.content_vector,
        items[j].multiVec.content_vector
      );

      const sameDomain = items[i].domain === items[j].domain;
      // High semantic similarity or same domain with moderate similarity
      if (triggerSim >= threshold || (sameDomain && (triggerSim >= 0.50 || contentSim >= 0.55))) {
        clusterMembers.push(items[j]);
        assigned.add(items[j].slug);
      }
    }

    if (clusterMembers.length > 1) {
      const primary = clusterMembers[0];
      const memberSlugs = clusterMembers.map(m => m.slug);
      const unifiedDomain = primary.domain;

      const combinedWords = memberSlugs
        .map(s => s.replace(/^(k8s|git|ci|docker|tf)-/, ''))
        .join('-')
        .split('-')
        .filter((w, idx, arr) => arr.indexOf(w) === idx)
        .slice(0, 5)
        .join('-');

      const prefix = primary.slug.split('-')[0];
      const targetSlug = `${prefix}-${combinedWords}`.slice(0, 45).replace(/-+$/, '');

      const triggers = clusterMembers.map(m => m.trigger.replace(/^When\s+/i, '').replace(/\.$/, ''));
      const unifiedTrigger = `When handling ${unifiedDomain} operations involving ${triggers.join(' or ')}`;

      const whySections = clusterMembers.map(m => `- **From ${m.slug}:** ${m.trigger}`).join('\n');
      const howSections = clusterMembers.map(m => {
        const bodyClean = m.body.replace(/^#\s+[^\n]+/m, '').trim();
        return `### Guidelines from ${m.slug}\n${bodyClean}`;
      }).join('\n\n');

      const synthesizedBody = `# Consolidated ${unifiedDomain.toUpperCase()} Guidelines: ${targetSlug}\n\n## Why\nConsolidates fragmented guidelines across:\n${whySections}\n\n## How to apply\n${howSections}`;

      clusters.push({
        clusterId: `cluster-${clusters.length + 1}`,
        domain: unifiedDomain,
        memberSlugs,
        targetSlug,
        unifiedTrigger,
        synthesizedBody,
        estimatedTokenSavingsPct: Math.round(((clusterMembers.length - 1) / clusterMembers.length) * 40),
        recommendation: `Consolidate [${memberSlugs.join(', ')}] into master rule '${targetSlug}'.`
      });
    }
  }

  return {
    workspace: workspaceRoot,
    totalMemoriesAnalyzed: items.length,
    clustersDiscovered: clusters.length,
    consolidationPotential: clusters.length > 0 ? 'HIGH' : 'OPTIMAL',
    clusters
  };
}
