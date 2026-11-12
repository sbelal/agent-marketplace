import fs from 'node:fs';
import path from 'node:path';
import { normalizeWorkspaceId } from '../core/storage-paths.js';
import { scanLayerEntries } from '../retrieval/shadow-resolver.js';
import { parseYamlFrontmatter } from '../core/yaml-parser.js';
import { generateMultiVector } from '../embeddings/multi-vector.js';
import { computeDenseCosineSimilarity } from '../embeddings/heuristic-provider.js';

/**
 * Semantic Contradiction & Codebase Drift Detection Engine.
 *
 * Audits memories across all active layers against:
 * 1. Semantic Contradictions: Conflicting rules on identical triggers or domains without explicit overrides.
 * 2. Codebase Drift: References to missing files, incompatible engine requirements, and verification staleness.
 */
export function detectContradictionsAndDrift(workspaceRoot = process.cwd(), options = {}) {
  const currentWsId = normalizeWorkspaceId(workspaceRoot);
  const threshold = typeof options.threshold === 'number' ? options.threshold : 0.65;

  const { activeEntries, shadowedEntries } = scanLayerEntries(workspaceRoot, 'all');

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

  for (let i = 0; i < entryVectors.length; i++) {
    for (let j = i + 1; j < entryVectors.length; j++) {
      const a = entryVectors[i];
      const b = entryVectors[j];

      if (a.entry.overrides === b.entry.slug || b.entry.overrides === a.entry.slug) {
        continue;
      }
      if (shadowedSet.has(`${a.entry.layerKey}:${a.entry.slug}`) || shadowedSet.has(`${b.entry.layerKey}:${b.entry.slug}`)) {
        continue;
      }

      const triggerSim = computeDenseCosineSimilarity(a.multiVec.trigger_vector, b.multiVec.trigger_vector);
      const sameDomain = a.entry.domain && b.entry.domain && a.entry.domain === b.entry.domain;

      if (triggerSim >= threshold || (sameDomain && triggerSim >= 0.50)) {
        const textA = `${a.entry.trigger} ${a.body}`.toLowerCase();
        const textB = `${b.entry.trigger} ${b.body}`.toLowerCase();

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
