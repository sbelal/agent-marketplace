import fs from 'node:fs';
import path from 'node:path';
import { scanLayerEntries } from '../retrieval/shadow-resolver.js';
import { parseYamlFrontmatter } from '../core/yaml-parser.js';
import { generateMultiVector, generateMultiVectorAsync } from '../embeddings/multi-vector.js';
import { computeDenseCosineSimilarity } from '../embeddings/heuristic-provider.js';
import { getActiveEmbeddingConfig } from '../embeddings/onnx-provider.js';
import { loadCachedVectorsMap } from '../db/indexer.js';

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasAffirmativeToolMention(text, tool) {
  const toolRe = new RegExp(`\\b${escapeRegex(tool)}\\b`, 'i');
  if (!toolRe.test(text)) return false;

  const lines = text.split(/\r?\n/);
  const negationBeforeRe = new RegExp(`\\b(?:never|do\\s+not|don't|avoid|stop\\s+using|instead\\s+of|not\\s+use|replace)\\b[^\\n.;,]*\\b${escapeRegex(tool)}\\b`, 'i');
  const negationAfterRe = new RegExp(`\\b${escapeRegex(tool)}\\b[^\\n.;,]*\\b(?:is\\s+deprecated|deprecated|prohibited|forbidden|must\\s+not|not\\s+allowed)\\b`, 'i');

  for (const line of lines) {
    if (!toolRe.test(line)) continue;
    // Split on clause boundaries so "Never use pnpm, always enforce npm" isolates clauses
    const clauses = line.split(/[,;]+/);
    for (const clause of clauses) {
      if (!toolRe.test(clause)) continue;
      if (!negationBeforeRe.test(clause) && !negationAfterRe.test(clause)) {
        return true;
      }
    }
  }
  return false;
}

function findFileInWorkspace(workspaceRoot, ref) {
  if (fs.existsSync(path.join(workspaceRoot, ref))) return true;
  if (ref.includes('/') || ref.includes('\\')) return false;

  const targetLower = ref.toLowerCase();
  const queue = [{ dir: workspaceRoot, depth: 0 }];
  while (queue.length > 0) {
    const { dir, depth } = queue.shift();
    if (depth > 3) continue;
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && entry.name.toLowerCase() === targetLower) {
          return true;
        }
        if (entry.isDirectory() && depth < 3 && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          queue.push({ dir: path.join(dir, entry.name), depth: depth + 1 });
        }
      }
    } catch {}
  }
  return false;
}

function extractAffirmativeConfigReferences(body) {
  const refs = new Set();
  const lines = body.split(/\r?\n/);
  let inCodeBlock = false;
  const negationLineRe = /\b(?:never|do\s+not|don't|avoid|instead\s+of|deprecated|obsolete|removed|replace)\b/i;
  const filePattern = /(?:[a-zA-Z0-9_\-./]+\/)?(?:\.[a-zA-Z0-9_\-.]+|[a-zA-Z0-9_\-.]+)\.(?:json|ya?ml|toml|conf|config\.[a-z]+)\b/g;

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (inCodeBlock || negationLineRe.test(line)) continue;

    const matches = line.match(filePattern);
    if (!matches) continue;
    for (const cf of matches) {
      const clean = cf.replace(/^\.\//, '');
      const base = path.basename(clean).toLowerCase();
      if (base.startsWith('.') || base.includes('config') || base.includes('docker') || base.includes('lint') || clean.includes('/')) {
        refs.add(clean);
      }
    }
  }
  return Array.from(refs);
}

function analyzeContradictionsAndDrifts(workspaceRoot, entryVectors, allKnownSlugs, shadowedSet, options = {}) {
  const threshold = (typeof options.threshold === 'number' && Number.isFinite(options.threshold)) ? options.threshold : 0.65;
  const contradictions = [];
  const ambiguousPairs = [];
  const drifts = [];

  for (let i = 0; i < entryVectors.length; i++) {
    for (let j = i + 1; j < entryVectors.length; j++) {
      const a = entryVectors[i];
      const b = entryVectors[j];

      const aOverrides = (a.entry.overridesList || []).map(s => s.toLowerCase());
      const bOverrides = (b.entry.overridesList || []).map(s => s.toLowerCase());
      if (aOverrides.includes(b.entry.slug.toLowerCase()) || bOverrides.includes(a.entry.slug.toLowerCase())) {
        continue;
      }
      if (shadowedSet.has(`${a.entry.layerKey}:${a.entry.slug}`) || shadowedSet.has(`${b.entry.layerKey}:${b.entry.slug}`)) {
        continue;
      }

      const triggerSim = computeDenseCosineSimilarity(a.multiVec.trigger_vector, b.multiVec.trigger_vector);
      const sameDomain = a.entry.domain && b.entry.domain && a.entry.domain === b.entry.domain;

      if (triggerSim >= threshold || (sameDomain && triggerSim >= 0.50)) {
        const textA = `${a.entry.trigger}\n${a.body}`;
        const textB = `${b.entry.trigger}\n${b.body}`;

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
          const aUses1 = hasAffirmativeToolMention(textA, tool1);
          const bUses2 = hasAffirmativeToolMention(textB, tool2);
          const aUses2 = hasAffirmativeToolMention(textA, tool2);
          const bUses1 = hasAffirmativeToolMention(textB, tool1);

          if ((aUses1 && bUses2 && !bUses1) || (aUses2 && bUses1 && !aUses1)) {
            const firstTool = (aUses1 && bUses2 && !bUses1) ? tool1 : tool2;
            const secondTool = firstTool === tool1 ? tool2 : tool1;
            conflictReason = `Opposing toolchain recommendations: ${a.entry.slug} mandates '${firstTool}' while ${b.entry.slug} mandates '${secondTool}'.`;
            severity = 'high';
            break;
          }
        }

        if (!conflictReason) {
          const positiveReg = /\b(always|must|require|required|enforce|mandatory|should always|ensure)\b/i;
          const negativeReg = /\b(never|do not|don't|prohibit|prohibited|forbidden|avoid|must not|cannot)\b/i;

          const aPos = positiveReg.test(textA);
          const aNeg = negativeReg.test(textA);
          const bPos = positiveReg.test(textB);
          const bNeg = negativeReg.test(textB);

          if ((aPos && !aNeg && bNeg && !bPos) || (aNeg && !aPos && bPos && !bNeg)) {
            conflictReason = `Direct directive polarity conflict: ${a.entry.slug} and ${b.entry.slug} prescribe conflicting mandatory vs prohibited rules for similar situations.`;
            severity = 'high';
          } else if (triggerSim >= 0.85) {
            conflictReason = `High trigger duplication without explicit inheritance: ${a.entry.slug} and ${b.entry.slug} fire on virtually identical scenarios (trigger similarity: ${Math.round(triggerSim * 100)}%).`;
            severity = 'medium';
          } else if (triggerSim >= 0.55 && ((aPos && bNeg) || (aNeg && bPos))) {
            ambiguousPairs.push({
              slug_a: a.entry.slug,
              slug_b: b.entry.slug,
              domain: a.entry.domain || 'general',
              trigger_similarity: Math.round(triggerSim * 100),
              excerpt_a: textA.slice(0, 200).trim(),
              excerpt_b: textB.slice(0, 200).trim(),
              note: 'Both memories mix positive and negative directives on overlapping scenarios; verify nuance via LLM review.'
            });
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
            evidence: {
              excerpt_a: textA.slice(0, 240).trim(),
              excerpt_b: textB.slice(0, 240).trim()
            },
            remediation: a.entry.layerKey !== b.entry.layerKey
              ? `Declare 'overrides: ${b.entry.layerKey === 'team' ? b.entry.slug : a.entry.slug}' in the higher-tier memory file.`
              : `Consolidate ${a.entry.slug} and ${b.entry.slug} into a unified rule via /kc-consolidate.`
          });
        }
      }
    }
  }

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
    const body = item.body;

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

    const targetOverrides = entry.overridesList && entry.overridesList.length > 0
      ? entry.overridesList
      : (entry.overrides ? String(entry.overrides).split(',').map(s => s.trim()).filter(Boolean) : []);

    for (const targetSlug of targetOverrides) {
      if (!allKnownSlugs.has(targetSlug.toLowerCase())) {
        drifts.push({
          slug: entry.slug,
          layer: entry.layerKey,
          type: 'dangling_override_drift',
          severity: 'medium',
          detail: `Entry declares 'overrides: ${targetSlug}', but target slug '${targetSlug}' does not exist in any layer.`,
          remediation: `Remove 'overrides: ${targetSlug}' or rename to matching upstream slug.`
        });
      }
    }

    if (Array.isArray(entry.related)) {
      for (const rel of entry.related) {
        if (rel && !allKnownSlugs.has(rel.toLowerCase())) {
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

    const referencedFiles = extractAffirmativeConfigReferences(body);
    for (const ref of referencedFiles) {
      if (!findFileInWorkspace(workspaceRoot, ref)) {
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

    if (targetNodeEngine && /node/i.test(body)) {
      const reqMatch = targetNodeEngine.match(/(?:>=?\s*|\^|~|^v?)([0-9]+)/);
      if (reqMatch) {
        const minRequired = parseInt(reqMatch[1], 10);
        // Strip migration expressions like "from Node 18 to Node 22" before scanning required versions
        const sanitizedBody = body.replace(
          /\b(?:from|migrating\s+from|upgrading\s+from|dropped|legacy)\s+Node(?:\.js)?\s+(?:v|version\s+)?[0-9]+(?:\s*(?:to|->|→)\s*Node(?:\.js)?\s+(?:v|version\s+)?[0-9]+)?/gi,
          ' '
        );
        const versionRegex = /Node(?:\.js)?\s+(?:v|version\s+)?([0-9]+)/gi;
        const flaggedVersions = new Set();
        let match;
        while ((match = versionRegex.exec(sanitizedBody)) !== null) {
          const statedVersion = parseInt(match[1], 10);
          if (statedVersion < minRequired && !flaggedVersions.has(statedVersion)) {
            flaggedVersions.add(statedVersion);
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
    ambiguous_pairs_count: ambiguousPairs.length,
    status: (contradictions.length === 0 && drifts.length === 0) ? 'HEALTHY' : 'DRIFT_DETECTED',
    contradictions,
    drifts,
    ambiguous_pairs: ambiguousPairs
  };
}

function prepareEntriesForAudit(workspaceRoot, options = {}) {
  const { activeEntries, shadowedEntries } = scanLayerEntries(workspaceRoot, 'all');
  let targetEntries = activeEntries;
  if (options.domain) {
    const dLower = options.domain.toLowerCase();
    targetEntries = activeEntries.filter(e => (e.domain || '').toLowerCase() === dLower);
  }

  const allKnownSlugs = new Map();
  for (const entry of activeEntries) {
    allKnownSlugs.set(entry.slug.toLowerCase(), entry);
  }
  for (const entry of shadowedEntries) {
    allKnownSlugs.set(entry.slug.toLowerCase(), entry);
  }

  const shadowedSet = new Set();
  for (const shadowed of shadowedEntries) {
    shadowedSet.add(`${shadowed.layerKey}:${shadowed.slug}`);
    shadowedSet.add(shadowed.slug);
  }

  const cachedVectors = loadCachedVectorsMap(workspaceRoot);
  return { targetEntries, allKnownSlugs, shadowedSet, cachedVectors };
}

/**
 * Synchronous Semantic Contradiction & Codebase Drift Detection Engine.
 * Reuses cached SQLite vectors (including ONNX 384-d when indexed) or generates synchronous heuristic vectors.
 */
export function detectContradictionsAndDrift(workspaceRoot = process.cwd(), options = {}) {
  const { targetEntries, allKnownSlugs, shadowedSet, cachedVectors } = prepareEntriesForAudit(workspaceRoot, options);

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

    const cacheKey = `${entry.layerKey}:${entry.teamSlug || ''}:${entry.file}`;
    const multiVec = cachedVectors.get(cacheKey) || generateMultiVector({
      trigger: entry.trigger,
      body,
      slug: entry.slug,
      domain: entry.domain,
      type: entry.type,
      related: entry.related
    });

    entryVectors.push({ entry, body, fm, multiVec });
  }

  return analyzeContradictionsAndDrifts(workspaceRoot, entryVectors, allKnownSlugs, shadowedSet, options);
}

/**
 * Async Semantic Contradiction & Codebase Drift Detection Engine.
 * Uses active ONNX / Heuristic embedding provider for uncached entries.
 */
export async function detectContradictionsAndDriftAsync(workspaceRoot = process.cwd(), options = {}) {
  const { targetEntries, allKnownSlugs, shadowedSet, cachedVectors } = prepareEntriesForAudit(workspaceRoot, options);
  const activeConfig = getActiveEmbeddingConfig();

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

    const cacheKey = `${entry.layerKey}:${entry.teamSlug || ''}:${entry.file}`;
    let multiVec = cachedVectors.get(cacheKey);
    if (!multiVec) {
      const vecInput = {
        trigger: entry.trigger,
        body,
        slug: entry.slug,
        domain: entry.domain,
        type: entry.type,
        related: entry.related
      };
      multiVec = activeConfig.engine === 'onnx'
        ? await generateMultiVectorAsync(vecInput)
        : generateMultiVector(vecInput);
    }

    entryVectors.push({ entry, body, fm, multiVec });
  }

  return analyzeContradictionsAndDrifts(workspaceRoot, entryVectors, allKnownSlugs, shadowedSet, options);
}
