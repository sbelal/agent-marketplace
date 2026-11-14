import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { resolveStoragePaths, GIT_EXEC_ENV } from './storage-paths.js';
import { createLayerProvider } from './layer-provider.js';
import { parseYamlFrontmatter, serializeYamlFrontmatter, parseInlineArrayOrList } from './yaml-parser.js';
import { findMarkdownFiles, scanLayerEntries } from '../retrieval/shadow-resolver.js';
import { getMemorySpanningTree } from '../graph/graph-service.js';
import { emitTelemetryEvent } from '../db/telemetry.js';
import { getActiveEmbeddingConfig } from '../embeddings/onnx-provider.js';

const STALE_THRESHOLD_DAYS = 180;

export function parsePorcelainZ(raw) {
  if (!raw) return [];
  const tokens = raw.split('\0');
  const entries = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;
    const status = token.slice(0, 2);
    const file = token.slice(3);
    entries.push({ status, file, raw: `${status.trim()} ${file}`.trim() });
    // Renames/copies emit an extra NUL-terminated original path
    if (status[0] === 'R' || status[0] === 'C') {
      i++;
    }
  }
  return entries;
}

/**
 * Atomic file persistence using temporary write and atomic filesystem rename.
 */
export function atomicWriteFileSync(filePath, content, encoding = 'utf8') {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tempPath = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}.${Date.now()}`);
  try {
    fs.writeFileSync(tempPath, content, encoding);
    fs.renameSync(tempPath, filePath);
  } catch (err) {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    throw err;
  }
}

export function evaluateEntryStaleness(verifiedString, nowMs = Date.now()) {
  if (!verifiedString || typeof verifiedString !== 'string') {
    return { isStale: true, reason: 'missing-date', daysOld: null };
  }
  const parsed = Date.parse(verifiedString.trim());
  if (isNaN(parsed)) {
    return { isStale: true, reason: 'invalid-date', daysOld: null };
  }
  const diffDays = Math.floor((nowMs - parsed) / (1000 * 60 * 60 * 24));
  const isStale = diffDays > STALE_THRESHOLD_DAYS;
  return {
    isStale,
    reason: isStale ? 'older-than-180-days' : 'fresh',
    daysOld: diffDays
  };
}

export function queryGitRepoStatus(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    return {
      isGit: false,
      isClean: true,
      branch: null,
      isPromoteBranch: false,
      uncommittedCount: 0,
      uncommittedList: [],
      upstreamAhead: 0,
      upstreamBehind: 0
    };
  }
  try {
    let branch = '';
    try {
      branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: repoDir,
        encoding: 'utf8',
        timeout: 2000,
        env: GIT_EXEC_ENV,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    } catch {
      branch = execFileSync('git', ['symbolic-ref', '--short', 'HEAD'], {
        cwd: repoDir,
        encoding: 'utf8',
        timeout: 2000,
        env: GIT_EXEC_ENV,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
    }

    const isPromoteBranch = branch.startsWith('promote/') || branch.startsWith('adr/');

    const porcelain = execFileSync('git', ['status', '--porcelain', '-z'], {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 2000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    });

    const parsedEntries = parsePorcelainZ(porcelain);
    const isClean = parsedEntries.length === 0;
    const uncommittedList = parsedEntries.map(e => e.raw);
    const uncommittedCount = parsedEntries.length;

    let upstreamAhead = 0;
    let upstreamBehind = 0;
    try {
      const counts = execFileSync('git', ['rev-list', '--left-right', '--count', 'HEAD...@{u}'], {
        cwd: repoDir,
        encoding: 'utf8',
        timeout: 2000,
        env: GIT_EXEC_ENV,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      const parts = counts.split(/\s+/);
      if (parts.length >= 2) {
        upstreamAhead = parseInt(parts[0], 10) || 0;
        upstreamBehind = parseInt(parts[1], 10) || 0;
      }
    } catch {}

    const defaultBranch = detectTeamDefaultBranch(repoDir);

    return {
      isGit: true,
      branch,
      defaultBranch,
      isClean,
      isPromoteBranch,
      uncommittedCount,
      uncommittedList,
      upstreamAhead,
      upstreamBehind
    };
  } catch {
    return {
      isGit: true,
      branch: 'unknown',
      defaultBranch: 'main',
      isClean: true,
      isPromoteBranch: false,
      uncommittedCount: 0,
      uncommittedList: [],
      upstreamAhead: 0,
      upstreamBehind: 0
    };
  }
}

/**
 * Returns summary of persistent memory entries grouped by domain.
 * Supports hierarchical recall with 'compact' format (~15 tokens per entry).
 */
export function getMemorySummary(workspaceRoot, targetLayer = 'all', filterOptions = {}) {
  let layerArg = targetLayer;
  let opts = filterOptions || {};

  if (targetLayer && typeof targetLayer === 'object') {
    opts = targetLayer;
    layerArg = opts.layer || 'all';
  }

  const domainFilter = typeof opts.domain === 'string' && opts.domain.trim() ? opts.domain.trim().toLowerCase() : null;
  const queryFilter = typeof opts.query === 'string' && opts.query.trim() ? opts.query.trim().toLowerCase() : null;
  const format = opts.format || 'standard';

  const { activeEntries } = scanLayerEntries(workspaceRoot, layerArg);

  if (activeEntries.length === 0) {
    return 'No persistent memory entries found in the selected layer(s).';
  }

  const filtered = activeEntries.filter((row) => {
    if (domainFilter && row.domain.toLowerCase() !== domainFilter) {
      return false;
    }
    if (queryFilter) {
      const searchable = [row.slug, row.domain, row.type, row.trigger, row.overrides, (row.related || []).join(' ')].join(' ').toLowerCase();
      const tokens = queryFilter.split(/\s+/).filter(Boolean);
      if (!tokens.every((tok) => searchable.includes(tok))) {
        return false;
      }
    }
    return true;
  });

  if (filtered.length === 0) {
    return 'No persistent memory entries matched the specified filter criteria.';
  }

  const domainGroups = new Map();
  for (const row of filtered) {
    const dom = row.domain || 'general';
    if (!domainGroups.has(dom)) domainGroups.set(dom, []);
    domainGroups.get(dom).push(row);
  }

  const sortedDomains = Array.from(domainGroups.keys()).sort((a, b) => {
    if (a === 'general' && b !== 'general') return 1;
    if (b === 'general' && a !== 'general') return -1;
    return a.localeCompare(b);
  });

  // Token-Budgeted Hierarchical Recall: 'compact' format
  if (format === 'compact') {
    let output = `### 🧠 Memory Summary (Compact Index)\n\n`;
    for (const dom of sortedDomains) {
      output += `#### Domain: ${dom}\n`;
      for (const row of domainGroups.get(dom)) {
        output += `- **[${row.layerKey}] ${row.slug}** (${row.type}): ${row.trigger}\n`;
      }
      output += '\n';
    }
    output += `*Use \`get_memory_content(slug="...")\` to expand full instructions and code.*`;
    return output.trim();
  }

  // Standard tabular format
  let output = '';
  for (const dom of sortedDomains) {
    output += `### Domain: ${dom}\n\n`;
    output += `| Slug | Layer | Type | Overrides | Related Slugs | Trigger (WHEN to apply) |\n`;
    output += `| :--- | :---: | :---: | :---: | :--- | :--- |\n`;
    for (const row of domainGroups.get(dom)) {
      const relatedStr = (row.related && row.related.length > 0) ? `\`[${row.related.join(', ')}]\`` : '-';
      const overridesStr = row.overrides ? `\`${row.overrides}\`` : '-';
      output += `| \`${row.slug}\` | **${row.layerKey}** | \`${row.type}\` | ${overridesStr} | ${relatedStr} | ${row.trigger} |\n`;
    }
    output += '\n';
  }

  return output.trim();
}

export function getLayerStatistics(workspaceRoot) {
  const paths = resolveStoragePaths(workspaceRoot);

  const workspaceFiles = findMarkdownFiles(paths.workspaceDir).filter(f => path.basename(f, '.md').toUpperCase() !== 'README');
  const privateFiles = findMarkdownFiles(paths.privateDir).filter(f => path.basename(f, '.md').toUpperCase() !== 'README');
  
  let teamFiles = [];
  const hasConfiguredTeamRepos = Array.isArray(paths.settings?.teamRepos) && paths.settings.teamRepos.length > 0;
  if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
    for (const tRepo of paths.activeTeamDirs) {
      teamFiles.push(...findMarkdownFiles(tRepo.dir).filter(f => path.basename(f, '.md').toUpperCase() !== 'README'));
    }
  } else if (!hasConfiguredTeamRepos) {
    teamFiles = findMarkdownFiles(paths.teamDir).filter(f => path.basename(f, '.md').toUpperCase() !== 'README');
  }

  const { allEntries, activeEntries } = scanLayerEntries(workspaceRoot, 'all');

  const domainCounts = {};
  for (const entry of activeEntries) {
    const dom = entry.domain || 'general';
    domainCounts[dom] = (domainCounts[dom] || 0) + 1;
  }

  const sortedDomains = Object.entries(domainCounts).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return a[0].localeCompare(b[0]);
  });

  const domains = {};
  for (const [dom, count] of sortedDomains) {
    domains[dom] = count;
  }
  const domainSummary = sortedDomains.length > 0 ? sortedDomains.map(([dom, count]) => `${dom} (${count})`).join(', ') : 'none';

  const nowMs = Date.now();
  const staleEntries = [];
  for (const entry of allEntries) {
    const check = evaluateEntryStaleness(entry.verified, nowMs);
    if (check.isStale) {
      staleEntries.push({
        layer: entry.layer,
        slug: entry.slug,
        domain: entry.domain,
        verified: entry.verified || 'missing',
        daysOld: check.daysOld,
        reason: check.reason
      });
    }
  }

  const privateGit = queryGitRepoStatus(paths.privateDir);
  let teamGit = {
    isGit: false,
    isClean: true,
    branch: null,
    defaultBranch: 'main',
    isPromoteBranch: false,
    uncommittedCount: 0,
    uncommittedList: [],
    upstreamAhead: 0,
    upstreamBehind: 0
  };

  if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
    const teamReposGit = [];
    for (const tRepo of paths.activeTeamDirs) {
      const gStatus = queryGitRepoStatus(tRepo.dir);
      if (gStatus.isGit) {
        teamReposGit.push({ slug: tRepo.slug, name: tRepo.name, ...gStatus });
      }
    }
    if (teamReposGit.length > 0) {
      const hasUncommitted = teamReposGit.some(r => !r.isClean);
      const onPromote = teamReposGit.find(r => r.isPromoteBranch);
      const totalBehind = teamReposGit.reduce((acc, r) => acc + (r.upstreamBehind || 0), 0);
      const totalAhead = teamReposGit.reduce((acc, r) => acc + (r.upstreamAhead || 0), 0);
      const totalUncommitted = teamReposGit.reduce((acc, r) => acc + (r.uncommittedCount || 0), 0);
      const allUncommittedList = teamReposGit.flatMap(r => (r.uncommittedList || []).map(l => `[${r.slug}] ${l}`));
      const primaryRepo = onPromote || teamReposGit[0];
      teamGit = {
        isGit: true,
        isClean: !hasUncommitted,
        uncommittedCount: totalUncommitted,
        uncommittedList: allUncommittedList,
        branch: primaryRepo?.branch || 'main',
        defaultBranch: primaryRepo?.defaultBranch || 'main',
        isPromoteBranch: Boolean(onPromote),
        upstreamAhead: totalAhead,
        upstreamBehind: totalBehind,
        repos: teamReposGit
      };
    }
  } else if (!hasConfiguredTeamRepos) {
    teamGit = queryGitRepoStatus(paths.teamDir);
  }

  const totalFiles = workspaceFiles.length + privateFiles.length + teamFiles.length;

  return {
    counts: {
      workspace: workspaceFiles.length,
      private: privateFiles.length,
      team: teamFiles.length,
      total: totalFiles,
      active: activeEntries.length,
      totalActive: activeEntries.length
    },
    paths: {
      settings: paths.settingsPath,
      workspace: paths.workspaceDir,
      private: paths.privateDir,
      team: paths.teamDir
    },
    domains,
    domainSummary,
    staleCount: staleEntries.length,
    staleEntries,
    staleness: {
      staleCount: staleEntries.length,
      staleEntries
    },
    syncStatus: {
      privateGit,
      teamGit,
      privateRepoConfigured: Boolean(paths.settings?.privateRepoUrl),
      teamRepoConfigured: Boolean(paths.settings?.teamRepoUrl || (paths.activeTeamDirs && paths.activeTeamDirs.length > 0))
    },
    embedding: getActiveEmbeddingConfig()
  };
}

export function resolveSingleMemoryContent(workspaceRoot, layer, slug, activeIndex, options = {}) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('A memory slug string is required.');
  }

  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  const slugKey = cleanSlug.toLowerCase();
  const normalizedLayer = (layer || 'all').toLowerCase();
  const paths = resolveStoragePaths(workspaceRoot);
  const layerProvider = createLayerProvider(workspaceRoot);

  let filePath = null;
  let resolvedLayer = normalizedLayer;
  let resolvedTeamSlug = '';

  if (normalizedLayer === 'all') {
    const active = activeIndex ? (activeIndex.get(slugKey) || activeIndex.get(cleanSlug)) : null;
    if (active && fs.existsSync(active.file)) {
      filePath = active.file;
      resolvedLayer = active.layerKey;
      resolvedTeamSlug = active.teamSlug || '';
    } else {
      const match = layerProvider.findMemoryFile(cleanSlug, 'all');
      if (match) {
        filePath = match.path;
        resolvedLayer = match.layer;
        resolvedTeamSlug = match.teamSlug || '';
      }
    }
    if (!filePath) {
      throw new Error(`Memory slug '${cleanSlug}' was not found in any active layer.`);
    }
  } else {
    const match = layerProvider.findMemoryFile(cleanSlug, normalizedLayer);
    if (!match || !fs.existsSync(match.path)) {
      throw new Error(`Memory slug '${cleanSlug}' was not found in layer '${normalizedLayer}'.`);
    }
    filePath = match.path;
    resolvedLayer = match.layer;
    resolvedTeamSlug = match.teamSlug || '';
  }

  // Asynchronous non-blocking telemetry emitter (preserves CQS while recording recall metrics)
  emitTelemetryEvent(slugKey, 'recall', { workspaceRoot, layer: resolvedLayer, teamSlug: resolvedTeamSlug });

  const rawContent = fs.readFileSync(filePath, 'utf8');
  const parsed = parseYamlFrontmatter(rawContent);
  const relatedList = Array.isArray(parsed.frontmatter.related) ? parsed.frontmatter.related : [];

  let enrichedContent = rawContent;
  const resolvedRelated = [];

  if (relatedList.length > 0) {
    const graphLines = [];
    for (const relSlug of relatedList) {
      const relKey = String(relSlug || '').trim().replace(/\.md$/i, '').toLowerCase();
      const target = activeIndex && relKey ? (activeIndex.get(relKey) || activeIndex.get(relSlug)) : null;
      if (target) {
        graphLines.push(`- \`[${target.layerKey}] ${target.slug}\` (${target.type}): ${target.trigger}`);
        resolvedRelated.push({
          slug: target.slug,
          layer: target.layerKey,
          type: target.type,
          description: target.trigger,
          resolved: true
        });
      } else {
        graphLines.push(`- \`[unresolved/broken reference] ${relSlug}\``);
        resolvedRelated.push({ slug: relSlug, layer: null, resolved: false });
      }
    }
    enrichedContent = rawContent.trimEnd() + '\n\n---\n### Related Memories Available (1-Hop Graph)\n' + graphLines.join('\n') + '\n';
  }

  // Resolve backlinks
  const backlinks = [];
  const backlinkLines = [];
  const seenBacklinks = new Set();
  if (activeIndex) {
    for (const entry of activeIndex.values()) {
      if (!entry || entry.slug.toLowerCase() === slugKey) continue;
      const entrySlugKey = entry.slug.toLowerCase();
      if (seenBacklinks.has(entrySlugKey)) continue;
      const isRelated = Array.isArray(entry.related) && entry.related.some(r => String(r).trim().replace(/\.md$/i, '').toLowerCase() === slugKey);
      const isOverridden = Array.isArray(entry.overridesList) && entry.overridesList.some(o => String(o).trim().replace(/\.md$/i, '').toLowerCase() === slugKey);
      if (isRelated || isOverridden) {
        seenBacklinks.add(entrySlugKey);
        const relType = isOverridden ? 'overridden_by' : 'related_by';
        backlinks.push({
          slug: entry.slug,
          layer: entry.layerKey,
          type: entry.type,
          relation: relType,
          description: entry.trigger,
          resolved: true
        });
        backlinkLines.push(`- \`[${entry.layerKey}] ${entry.slug}\` (${entry.type}, ${relType}): ${entry.trigger}`);
      }
    }
  }

  if (backlinkLines.length > 0) {
    enrichedContent = enrichedContent.trimEnd() + '\n\n---\n### Incoming Backlinks (Referenced By)\n' + backlinkLines.join('\n') + '\n';
  }

  // GraphRAG Multi-Hop Spanning Tree Recall (if depth > 1 requested)
  const depth = typeof options === 'number' ? options : (options.depth || 1);
  let spanningTree = null;
  if (depth > 1) {
    spanningTree = getMemorySpanningTree(workspaceRoot, cleanSlug, { depth, maxDepth: depth });
    if (spanningTree && spanningTree.contextEnvelope) {
      enrichedContent = enrichedContent.trimEnd() + '\n\n---\n' + spanningTree.contextEnvelope + '\n';
    }
  }

  return {
    layer: resolvedLayer,
    slug: slugKey,
    path: filePath,
    frontmatter: parsed.frontmatter,
    relatedMemories: resolvedRelated,
    backlinks,
    spanningTree,
    content: enrichedContent
  };
}

export function getMemoryContent(workspaceRoot, layer, slug, slugs, options = {}) {
  const normalizedLayer = (layer || 'all').toLowerCase();
  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  const activeIndex = new Map();
  for (const entry of activeEntries) {
    const entryKey = entry.slug.toLowerCase();
    if (!activeIndex.has(entryKey)) {
      activeIndex.set(entryKey, entry);
    }
    for (const overridden of entry.overridesList) {
      const ovKey = String(overridden || '').trim().replace(/\.md$/i, '').toLowerCase();
      if (ovKey && !activeIndex.has(ovKey)) {
        activeIndex.set(ovKey, entry);
      }
    }
  }

  const opts = typeof slugs === 'object' && !Array.isArray(slugs) && slugs !== null ? slugs : options;
  const multiList = Array.isArray(slugs) ? slugs : (Array.isArray(slug) ? slug : null);
  if (multiList && multiList.length > 0) {
    const items = multiList.map((s) => resolveSingleMemoryContent(workspaceRoot, normalizedLayer, s, activeIndex, opts));
    return {
      layer: normalizedLayer,
      slugs: items.map((i) => i.slug),
      items,
      content: items.map((i) => i.content).join('\n\n===\n\n')
    };
  }

  return resolveSingleMemoryContent(workspaceRoot, normalizedLayer, slug, activeIndex, opts);
}


export function rewireMemoryReferences(workspaceRoot, oldSlug, newSlug) {
  if (!oldSlug || !newSlug) return 0;
  const oldKey = String(oldSlug).trim().replace(/\.md$/i, '').toLowerCase();
  const cleanNew = String(newSlug).trim().replace(/\.md$/i, '');
  if (!oldKey || !cleanNew || oldKey === cleanNew.toLowerCase()) return 0;
  const paths = resolveStoragePaths(workspaceRoot);
  const dirs = [paths.workspaceDir, paths.privateDir];
  let rewiredCount = 0;

  for (const dir of dirs) {
    const files = findMarkdownFiles(dir);
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = parseYamlFrontmatter(raw);
        let modified = false;

        if (Array.isArray(parsed.frontmatter.related)) {
          const hasOld = parsed.frontmatter.related.some(s => String(s).trim().replace(/\.md$/i, '').toLowerCase() === oldKey);
          if (hasOld) {
            const seen = new Set();
            const deduped = [];
            for (const s of parsed.frontmatter.related) {
              const mapped = String(s).trim().replace(/\.md$/i, '').toLowerCase() === oldKey ? cleanNew : String(s);
              const k = mapped.toLowerCase();
              if (!seen.has(k)) {
                seen.add(k);
                deduped.push(mapped);
              }
            }
            parsed.frontmatter.related = deduped;
            modified = true;
          }
        }

        if (parsed.frontmatter.overrides) {
          const overridesList = parseInlineArrayOrList(parsed.frontmatter.overrides);
          if (overridesList.some(s => String(s).trim().replace(/\.md$/i, '').toLowerCase() === oldKey)) {
            const seen = new Set();
            const updated = [];
            for (const s of overridesList) {
              const mapped = String(s).trim().replace(/\.md$/i, '').toLowerCase() === oldKey ? cleanNew : String(s);
              const k = mapped.toLowerCase();
              if (!seen.has(k)) {
                seen.add(k);
                updated.push(mapped);
              }
            }
            parsed.frontmatter.overrides = Array.isArray(parsed.frontmatter.overrides)
              ? updated
              : updated.join(', ');
            modified = true;
          }
        }

        if (modified) {
          const updatedRaw = serializeYamlFrontmatter(parsed.frontmatter, parsed.body);
          atomicWriteFileSync(file, updatedRaw, 'utf8');
          rewiredCount++;
        }
      } catch {}
    }
  }
  return rewiredCount;
}

export function cleanDanglingReferences(workspaceRoot, deletedSlug) {
  if (!deletedSlug) return 0;
  const deletedKey = String(deletedSlug).trim().replace(/\.md$/i, '').toLowerCase();
  if (!deletedKey) return 0;
  const paths = resolveStoragePaths(workspaceRoot);
  const dirs = [paths.workspaceDir, paths.privateDir];
  let cleanedCount = 0;

  for (const dir of dirs) {
    const files = findMarkdownFiles(dir);
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = parseYamlFrontmatter(raw);
        let modified = false;

        if (Array.isArray(parsed.frontmatter.related) &&
            parsed.frontmatter.related.some(s => String(s).trim().replace(/\.md$/i, '').toLowerCase() === deletedKey)) {
          parsed.frontmatter.related = parsed.frontmatter.related.filter(
            s => String(s).trim().replace(/\.md$/i, '').toLowerCase() !== deletedKey
          );
          modified = true;
        }

        if (parsed.frontmatter.overrides) {
          const overridesList = parseInlineArrayOrList(parsed.frontmatter.overrides);
          if (overridesList.some(s => String(s).trim().replace(/\.md$/i, '').toLowerCase() === deletedKey)) {
            const updated = overridesList.filter(
              s => String(s).trim().replace(/\.md$/i, '').toLowerCase() !== deletedKey
            );
            if (updated.length === 0) {
              delete parsed.frontmatter.overrides;
            } else {
              parsed.frontmatter.overrides = Array.isArray(parsed.frontmatter.overrides) ? updated : updated.join(', ');
            }
            modified = true;
          }
        }

        if (modified) {
          const updatedRaw = serializeYamlFrontmatter(parsed.frontmatter, parsed.body);
          atomicWriteFileSync(file, updatedRaw, 'utf8');
          cleanedCount++;
        }
      } catch {}
    }
  }
  return cleanedCount;
}

export function saveMemoryEntry(workspaceRoot, params = {}) {
  const {
    layer = 'private',
    slug,
    oldSlug,
    title,
    why,
    howToApply,
    body,
    type = 'convention',
    domain = 'general',
    description,
    trigger,
    verified,
    overrides,
    related = []
  } = params;

  if (!slug || typeof slug !== 'string') {
    throw new Error('A valid memory slug is required.');
  }

  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  if (!cleanSlug || cleanSlug !== slug.trim().replace(/\.md$/i, '') || cleanSlug.includes('..')) {
    throw new Error('Invalid memory slug. Directory traversal is prohibited.');
  }

  const normLayer = String(layer).toLowerCase();
  const paths = resolveStoragePaths(workspaceRoot);
  let targetDir = null;

  if (normLayer === 'workspace') {
    targetDir = paths.workspaceDir;
  } else if (normLayer === 'private') {
    targetDir = paths.privateDir;
  } else {
    throw new Error(`Direct writes are only permitted to 'workspace' or 'private' layer. Got '${layer}'.`);
  }

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  let markdownBody = body;
  if (!markdownBody) {
    const docTitle = title || cleanSlug.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    markdownBody = `# ${docTitle}\n\n`;
    if (why) markdownBody += `## Why\n${why.trim()}\n\n`;
    if (howToApply) markdownBody += `## How to apply\n${howToApply.trim()}\n`;
  }

  const normalizedType = type === 'personal-preference' ? 'preference' : (type || 'convention');
  const frontmatter = {
    name: cleanSlug,
    type: normalizedType,
    domain: String(domain || 'general').trim().toLowerCase() || 'general',
    description: description || trigger || 'Engineering guideline',
    verified: verified || new Date().toISOString().slice(0, 10),
    related: Array.isArray(related) ? related.map(r => String(r).replace(/\.md$/i, '').trim()).filter(Boolean) : []
  };

  if (overrides) {
    frontmatter.overrides = overrides;
  }

  const fileContent = serializeYamlFrontmatter(frontmatter, markdownBody);
  const targetFile = path.join(targetDir, `${cleanSlug}.md`);
  atomicWriteFileSync(targetFile, fileContent, 'utf8');

  let rewiredCount = 0;
  if (oldSlug && oldSlug !== cleanSlug) {
    const rawOld = oldSlug.trim().replace(/\.md$/i, '');
    const cleanOld = path.basename(rawOld);
    if (cleanOld && cleanOld === rawOld && !cleanOld.includes('..')) {
      const lp = createLayerProvider(workspaceRoot);
      const oldMatch = lp.findMemoryFile(cleanOld, normLayer);
      if (oldMatch && oldMatch.path !== targetFile && fs.existsSync(oldMatch.path)) {
        let sameFile = false;
        try {
          const oldStat = fs.statSync(oldMatch.path);
          const newStat = fs.statSync(targetFile);
          sameFile = oldStat.dev === newStat.dev && oldStat.ino === newStat.ino;
        } catch {}
        if (!sameFile) {
          fs.unlinkSync(oldMatch.path);
        }
      }
    }
    rewiredCount = rewireMemoryReferences(workspaceRoot, oldSlug, cleanSlug);
  }

  return {
    success: true,
    layer: normLayer,
    slug: cleanSlug,
    path: targetFile,
    rewiredReferences: rewiredCount
  };
}

export function mergeMemoryEntries(workspaceRoot, params = {}) {
  const {
    layer = 'private',
    targetSlug,
    sourceSlugs = [],
    title,
    why,
    howToApply,
    body,
    type = 'convention',
    domain = 'general',
    description,
    verified,
    related = [],
    overrides
  } = params;

  if (!targetSlug) {
    throw new Error('A target slug must be specified for merge.');
  }
  if (!Array.isArray(sourceSlugs) || sourceSlugs.length === 0) {
    throw new Error('sourceSlugs array must contain at least one slug to merge.');
  }

  const normLayer = String(layer).toLowerCase();
  if (normLayer !== 'workspace' && normLayer !== 'private') {
    throw new Error(`Direct writes are only permitted to 'workspace' or 'private' layer. Got '${layer}'.`);
  }

  const validatedSourceSlugs = [];
  for (const src of sourceSlugs) {
    const rawSrc = String(src || '').trim().replace(/\.md$/i, '');
    const cleanSrc = path.basename(rawSrc);
    if (!cleanSrc || cleanSrc !== rawSrc || cleanSrc.includes('..')) {
      throw new Error('Invalid source slug. Directory traversal is prohibited.');
    }
    validatedSourceSlugs.push(cleanSrc);
  }

  const saveRes = saveMemoryEntry(workspaceRoot, {
    layer: normLayer,
    slug: targetSlug,
    title,
    why,
    howToApply,
    body,
    type,
    domain,
    description,
    verified,
    related,
    overrides
  });

  const lp = createLayerProvider(workspaceRoot);
  let totalRewired = 0;
  for (const cleanSrc of validatedSourceSlugs) {
    if (cleanSrc.toLowerCase() === saveRes.slug.toLowerCase()) continue;

    const srcMatch = lp.findMemoryFile(cleanSrc, normLayer);
    if (srcMatch && srcMatch.path !== saveRes.path && fs.existsSync(srcMatch.path)) {
      fs.unlinkSync(srcMatch.path);
    }
    totalRewired += rewireMemoryReferences(workspaceRoot, cleanSrc, saveRes.slug);
  }

  return {
    success: true,
    layer: normLayer,
    targetSlug: saveRes.slug,
    mergedSlugs: sourceSlugs,
    rewiredCount: totalRewired,
    path: saveRes.path
  };
}

export function deleteMemoryEntry(workspaceRoot, params = {}) {
  const { layer = 'private', slug } = params;
  if (!slug) throw new Error('A memory slug is required for deletion.');

  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  if (!cleanSlug || cleanSlug !== slug.trim().replace(/\.md$/i, '') || cleanSlug.includes('..')) {
    throw new Error('Invalid memory slug. Directory traversal is prohibited.');
  }
  const normLayer = String(layer).toLowerCase();
  if (normLayer !== 'workspace' && normLayer !== 'private') {
    throw new Error(`Direct deletes are only permitted on 'workspace' or 'private' layer. Got '${layer}'.`);
  }

  const lp = createLayerProvider(workspaceRoot);
  const match = lp.findMemoryFile(cleanSlug, normLayer);

  if (!match || !fs.existsSync(match.path)) {
    return { success: false, message: `File '${cleanSlug}.md' not found in layer '${normLayer}'.` };
  }

  fs.unlinkSync(match.path);
  let cleanedReferences = cleanDanglingReferences(workspaceRoot, cleanSlug);
  if (match.slug && match.slug !== cleanSlug) {
    cleanedReferences += cleanDanglingReferences(workspaceRoot, match.slug);
  }

  return {
    success: true,
    layer: normLayer,
    deletedSlug: match.slug || cleanSlug,
    cleanedReferences
  };
}

export function syncMemoryLayer(workspaceRoot, params = {}) {
  const { layer = 'all' } = params;
  const paths = resolveStoragePaths(workspaceRoot);
  const results = {
    private: { attempted: false },
    team: { attempted: false }
  };

  const syncRepo = (dir) => {
    if (!fs.existsSync(path.join(dir, '.git'))) {
      return { success: false, status: 'not-a-git-repo' };
    }
    try {
      const dirty = execFileSync('git', ['status', '--porcelain', '-z'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 3000,
        env: GIT_EXEC_ENV
      });
      const dirtyEntries = parsePorcelainZ(dirty);
      if (dirtyEntries.length > 0) {
        return { success: false, status: 'dirty-working-copy', dirtyDetails: dirtyEntries.map(e => e.raw) };
      }
      const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 3000,
        env: GIT_EXEC_ENV
      }).trim();
      if (branch.startsWith('promote/') || branch.startsWith('adr/')) {
        return { success: false, status: 'on-promote-branch', branch };
      }
      try {
        execFileSync('git', ['branch', `--set-upstream-to=origin/${branch}`, branch], {
          cwd: dir,
          env: GIT_EXEC_ENV,
          stdio: 'ignore'
        });
      } catch {}
      const pullOut = execFileSync('git', ['pull', '--ff-only'], {
        cwd: dir,
        encoding: 'utf8',
        timeout: 5000,
        env: GIT_EXEC_ENV
      }).trim();
      return { success: true, status: 'synchronized', branch, output: pullOut };
    } catch (err) {
      return { success: false, status: 'error', error: err.message };
    }
  };

  const normLayer = String(layer || 'all').trim().toLowerCase() || 'all';
  const teamTargetSlug = normLayer.startsWith('team/') ? normLayer.slice(5) : normLayer;

  if (normLayer === 'all' || normLayer === 'private') {
    results.private = { attempted: true, ...syncRepo(paths.privateDir) };
  }
  const hasConfiguredTeamRepos = Array.isArray(paths.settings?.teamRepos) && paths.settings.teamRepos.length > 0;
  const specificTeam = paths.activeTeamDirs ? paths.activeTeamDirs.find(t => t.slug.toLowerCase() === teamTargetSlug) : null;
  if (normLayer === 'all' || normLayer === 'team' || specificTeam) {
    if (specificTeam) {
      const res = syncRepo(specificTeam.dir);
      results.team = {
        attempted: true,
        success: res.success,
        repos: [{ slug: specificTeam.slug, name: specificTeam.name, ...res }]
      };
    } else if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
      const repoResults = [];
      for (const tRepo of paths.activeTeamDirs) {
        repoResults.push({ slug: tRepo.slug, name: tRepo.name, ...syncRepo(tRepo.dir) });
      }
      results.team = {
        attempted: true,
        success: repoResults.every(r => r.success),
        repos: repoResults
      };
    } else if (!hasConfiguredTeamRepos) {
      results.team = { attempted: true, ...syncRepo(paths.teamDir) };
    } else {
      results.team = { attempted: true, success: true, status: 'no-active-team-repos', repos: [] };
    }
  }

  return results;
}

function detectTeamDefaultBranch(targetTeamDir) {
  try {
    const symRef = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
      cwd: targetTeamDir,
      env: GIT_EXEC_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (symRef.startsWith('refs/remotes/origin/')) {
      return symRef.slice('refs/remotes/origin/'.length);
    }
  } catch {}

  for (const candidate of ['main', 'master']) {
    try {
      execFileSync('git', ['show-ref', '--verify', '--quiet', `refs/heads/${candidate}`], {
        cwd: targetTeamDir,
        env: GIT_EXEC_ENV,
        stdio: 'ignore'
      });
      return candidate;
    } catch {}
  }

  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: targetTeamDir,
      env: GIT_EXEC_ENV,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim() || 'main';
  } catch {
    return 'main';
  }
}

export function prepareTeamPromotion(workspaceRoot, params = {}) {
  const { slug, content: customContent, frontmatter: customFm, teamSlug } = params;
  if (!slug || typeof slug !== 'string') throw new Error('A memory slug is required for promotion.');

  const rawSlug = slug.trim().replace(/\.md$/i, '');
  const cleanSlug = path.basename(rawSlug);
  if (!cleanSlug || cleanSlug !== rawSlug || cleanSlug.includes('..')) {
    throw new Error('Invalid memory slug. Directory traversal is prohibited.');
  }
  const paths = resolveStoragePaths(workspaceRoot);
  const lp = createLayerProvider(workspaceRoot);
  const privMatch = lp.findMemoryFile(cleanSlug, 'private');
  const privateFile = privMatch?.path || path.join(paths.privateDir, `${cleanSlug}.md`);

  if (!customContent && !fs.existsSync(privateFile)) {
    throw new Error(`Private memory file '${cleanSlug}.md' does not exist.`);
  }

  // Resolve target team directory with multi-team repository support
  let targetTeamDir = paths.teamDir;
  let targetTeamSlug = teamSlug || 'default';
  if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
    let matchedRepo = null;
    if (teamSlug) {
      matchedRepo = paths.activeTeamDirs.find(r => r.slug.toLowerCase() === teamSlug.toLowerCase());
      if (!matchedRepo) {
        throw new Error(`Team repository '${teamSlug}' was not found in settings or is not active.`);
      }
    } else {
      matchedRepo = paths.activeTeamDirs[0];
    }
    targetTeamDir = matchedRepo.dir;
    targetTeamSlug = matchedRepo.slug;
  } else if (teamSlug && teamSlug !== 'default') {
    throw new Error(`Team repository '${teamSlug}' was not found in settings or is not active.`);
  }

  const teamGit = path.join(targetTeamDir, '.git');
  if (!fs.existsSync(teamGit)) {
    throw new Error('Team memory clone is not initialized with Git. Run /kc-init first.');
  }

  const dirtyRaw = execFileSync('git', ['status', '--porcelain', '-z'], {
    cwd: targetTeamDir,
    env: GIT_EXEC_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const dirtyEntries = parsePorcelainZ(dirtyRaw);
  if (dirtyEntries.length > 0) {
    throw new Error(
      `Team repository '${targetTeamSlug}' has ${dirtyEntries.length} uncommitted change(s). Commit or stash them before promoting.`
    );
  }

  const defaultBranch = detectTeamDefaultBranch(targetTeamDir);
  execFileSync('git', ['checkout', defaultBranch], {
    cwd: targetTeamDir,
    env: GIT_EXEC_ENV,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let hasOrigin = false;
  try {
    execFileSync('git', ['remote', 'get-url', 'origin'], {
      cwd: targetTeamDir,
      env: GIT_EXEC_ENV,
      stdio: 'ignore'
    });
    hasOrigin = true;
  } catch {}

  if (hasOrigin) {
    try {
      execFileSync('git', ['branch', `--set-upstream-to=origin/${defaultBranch}`, defaultBranch], {
        cwd: targetTeamDir,
        env: GIT_EXEC_ENV,
        stdio: 'ignore'
      });
    } catch {}
    execFileSync('git', ['pull', '--ff-only'], {
      cwd: targetTeamDir,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  }

  const dateStr = new Date().toISOString().slice(0, 10);
  const branchName = `promote/${dateStr}-${cleanSlug}`;
  try {
    execFileSync('git', ['checkout', '-b', branchName], { cwd: targetTeamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
  } catch {
    execFileSync('git', ['checkout', branchName], { cwd: targetTeamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
  }

  let teamContent = '';
  if (customContent) {
    let bodyText = customContent;
    let fmData = { ...(customFm || {}) };

    if (customContent.trimStart().startsWith('---')) {
      const parsed = parseYamlFrontmatter(customContent);
      bodyText = parsed.body;
      fmData = { ...parsed.frontmatter, ...fmData };
    }

    const teamFm = {
      name: cleanSlug,
      type: fmData.type || 'convention',
      domain: (fmData.domain || 'general').toLowerCase(),
      description: fmData.description || 'Team engineering standard',
      verified: fmData.verified || dateStr,
      related: Array.isArray(fmData.related) ? fmData.related : []
    };

    teamContent = serializeYamlFrontmatter(teamFm, bodyText);
  } else {
    const rawContent = fs.readFileSync(privateFile, 'utf8');
    const parsed = parseYamlFrontmatter(rawContent);

    const home = os.homedir();
    let username = '';
    try {
      username = os.userInfo().username;
    } catch {}

    let scrubbedBody = parsed.body.replaceAll(home, '~');
    if (username && username.length > 1) {
      const escapedUser = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      scrubbedBody = scrubbedBody.replace(new RegExp(`\\b${escapedUser}\\b`, 'gi'), '<developer>');
    }
    scrubbedBody = scrubbedBody.replace(/[A-Za-z]:\\(?:Users|Documents)[^\s\n]+/gi, '<path>');

    const teamFm = {
      name: cleanSlug,
      type: parsed.frontmatter.type || 'convention',
      domain: (parsed.frontmatter.domain || 'general').toLowerCase(),
      description: parsed.frontmatter.description || 'Team engineering standard',
      verified: dateStr,
      related: parsed.frontmatter.related || []
    };

    teamContent = serializeYamlFrontmatter(teamFm, scrubbedBody);
  }

  const targetFile = path.join(targetTeamDir, `${cleanSlug}.md`);
  atomicWriteFileSync(targetFile, teamContent, 'utf8');

  return {
    success: true,
    slug: cleanSlug,
    teamSlug: targetTeamSlug,
    branch: branchName,
    stagedFile: targetFile,
    prCommand: `gh pr create --base ${defaultBranch} --head "${branchName}" --title "memory: promote ${cleanSlug}" --fill`
  };
}


/**
 * Applies a structured memory patch (such as exported from Bidirectional Memory Studio UI).
 * Updates node frontmatters and re-wires directional links (related, overrides) on disk.
 */
export function applyMemoryPatch(workspaceRoot = process.cwd(), patchData = {}) {
  const patch = patchData.patch || patchData;
  const modifiedNodes = Array.isArray(patch.modified_nodes) ? patch.modified_nodes : [];
  const addedLinks = Array.isArray(patch.added_links) ? patch.added_links : [];
  const removedLinks = Array.isArray(patch.removed_links) ? patch.removed_links : [];

  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  const entryMap = new Map();
  for (const entry of activeEntries) {
    entryMap.set(entry.slug, entry);
    entryMap.set(entry.slug.toLowerCase(), entry);
  }

  const results = {
    nodesUpdated: 0,
    linksAdded: 0,
    linksRemoved: 0,
    errors: []
  };

  // 1. Update modified nodes
  for (const mod of modifiedNodes) {
    const slug = mod.slug;
    const existing = entryMap.get(slug) || (slug ? entryMap.get(String(slug).toLowerCase()) : null);
    if (!existing) {
      results.errors.push(`Memory slug '${slug}' not found on disk.`);
      continue;
    }
    if (existing.layerKey === 'team') {
      results.errors.push(`Cannot directly modify read-only Team memory '${slug}'; create an override in Private/Workspace or promote via /kc-promote.`);
      continue;
    }
    const filePath = existing.file || existing.path;
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = parseYamlFrontmatter(raw);
      if (mod.domain) parsed.frontmatter.domain = String(mod.domain).trim().toLowerCase();
      if (mod.type) parsed.frontmatter.type = mod.type === 'personal-preference' ? 'preference' : mod.type;
      if (mod.description) {
        parsed.frontmatter.description = mod.description;
        delete parsed.frontmatter.trigger;
      }
      if (mod.verified) parsed.frontmatter.verified = mod.verified;

      const newContent = serializeYamlFrontmatter(parsed.frontmatter, parsed.body);
      atomicWriteFileSync(filePath, newContent, 'utf8');
      results.nodesUpdated++;
    } catch (err) {
      results.errors.push(`Failed to update node '${slug}': ${err.message}`);
    }
  }

  // 2. Add links (edges)
  for (const link of addedLinks) {
    const sourceSlug = typeof link.source === 'object' ? link.source.id || link.source.slug : link.source;
    const targetSlug = typeof link.target === 'object' ? link.target.id || link.target.slug : link.target;
    const relType = link.type || 'related';
    const targetClean = String(targetSlug || '').trim();
    if (!sourceSlug || !targetClean) continue;

    const sourceEntry = entryMap.get(sourceSlug) || entryMap.get(String(sourceSlug).toLowerCase());
    if (!sourceEntry) {
      results.errors.push(`Source memory '${sourceSlug}' not found.`);
      continue;
    }
    if (sourceEntry.layerKey === 'team') {
      results.errors.push(`Cannot add links from read-only Team memory '${sourceSlug}'; create an override in Private/Workspace or promote via /kc-promote.`);
      continue;
    }

    const sourceFilePath = sourceEntry.file || sourceEntry.path;
    try {
      const raw = fs.readFileSync(sourceFilePath, 'utf8');
      const parsed = parseYamlFrontmatter(raw);
      if (relType === 'overrides') {
        const existingOverrides = parseInlineArrayOrList(parsed.frontmatter.overrides);
        if (!existingOverrides.some(o => String(o).trim().toLowerCase() === targetClean.toLowerCase())) {
          existingOverrides.push(targetClean);
        }
        parsed.frontmatter.overrides = Array.isArray(parsed.frontmatter.overrides)
          ? existingOverrides
          : (existingOverrides.length === 1 ? existingOverrides[0] : existingOverrides.join(', '));
      } else {
        const related = Array.isArray(parsed.frontmatter.related) ? [...parsed.frontmatter.related] : [];
        if (!related.some(r => String(r).toLowerCase() === targetClean.toLowerCase())) {
          related.push(targetClean);
          parsed.frontmatter.related = related;
        }
      }
      const newContent = serializeYamlFrontmatter(parsed.frontmatter, parsed.body);
      atomicWriteFileSync(sourceFilePath, newContent, 'utf8');
      results.linksAdded++;
    } catch (err) {
      results.errors.push(`Failed to add link from '${sourceSlug}' to '${targetSlug}': ${err.message}`);
    }
  }

  // 3. Remove links
  for (const link of removedLinks) {
    const sourceSlug = typeof link.source === 'object' ? link.source.id || link.source.slug : link.source;
    const targetSlug = typeof link.target === 'object' ? link.target.id || link.target.slug : link.target;
    const relType = link.type || 'related';
    const targetClean = String(targetSlug || '').trim().toLowerCase();
    if (!sourceSlug || !targetClean) continue;

    const sourceEntry = entryMap.get(sourceSlug) || entryMap.get(String(sourceSlug).toLowerCase());
    if (!sourceEntry) continue;
    if (sourceEntry.layerKey === 'team') {
      results.errors.push(`Cannot remove links from read-only Team memory '${sourceSlug}'; Team layer is read-only locally.`);
      continue;
    }

    const sourceFilePath = sourceEntry.file || sourceEntry.path;
    try {
      const raw = fs.readFileSync(sourceFilePath, 'utf8');
      const parsed = parseYamlFrontmatter(raw);
      if (relType === 'overrides' && parsed.frontmatter.overrides) {
        const overridesList = parseInlineArrayOrList(parsed.frontmatter.overrides);
        const remaining = overridesList.filter(o => String(o).trim().toLowerCase() !== targetClean);
        if (remaining.length === 0) {
          delete parsed.frontmatter.overrides;
        } else {
          parsed.frontmatter.overrides = Array.isArray(parsed.frontmatter.overrides) ? remaining : remaining.join(', ');
        }
      } else if (Array.isArray(parsed.frontmatter.related)) {
        parsed.frontmatter.related = parsed.frontmatter.related.filter(s => String(s).trim().toLowerCase() !== targetClean);
      }
      const newContent = serializeYamlFrontmatter(parsed.frontmatter, parsed.body);
      atomicWriteFileSync(sourceFilePath, newContent, 'utf8');
      results.linksRemoved++;
    } catch (err) {
      results.errors.push(`Failed to remove link: ${err.message}`);
    }
  }

  return {
    ok: results.errors.length === 0,
    success: results.errors.length === 0,
    ...results
  };
}
