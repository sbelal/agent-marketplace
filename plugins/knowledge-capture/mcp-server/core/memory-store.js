import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync, execFileSync } from 'node:child_process';
import { resolveStoragePaths } from './storage-paths.js';
import { parseYamlFrontmatter, serializeYamlFrontmatter, parseInlineArrayOrList } from './yaml-parser.js';
import { findMarkdownFiles, scanLayerEntries } from '../retrieval/shadow-resolver.js';

const GIT_EXEC_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=3'
};

const STALE_THRESHOLD_DAYS = 180;

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
    return { isGit: false };
  }
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 2000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    const isPromoteBranch = branch.startsWith('promote/');

    const porcelain = execSync('git status --porcelain', {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 2000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    const isClean = porcelain === '';
    const uncommittedCount = isClean ? 0 : porcelain.split('\n').filter(Boolean).length;

    let upstreamBehind = 0;
    try {
      const counts = execSync('git rev-list --left-right --count HEAD...@{u}', {
        cwd: repoDir,
        encoding: 'utf8',
        timeout: 2000,
        env: GIT_EXEC_ENV,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      const parts = counts.split(/\s+/);
      if (parts.length >= 2) {
        upstreamBehind = parseInt(parts[1], 10) || 0;
      }
    } catch {}

    return {
      isGit: true,
      branch,
      isClean,
      isPromoteBranch,
      uncommittedCount,
      upstreamBehind
    };
  } catch {
    return { isGit: true, branch: 'unknown', isClean: true, isPromoteBranch: false, uncommittedCount: 0, upstreamBehind: 0 };
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
  if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
    for (const tRepo of paths.activeTeamDirs) {
      teamFiles.push(...findMarkdownFiles(tRepo.dir).filter(f => path.basename(f, '.md').toUpperCase() !== 'README'));
    }
  } else {
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
  const teamGit = queryGitRepoStatus(paths.teamDir);

  return {
    counts: {
      workspace: workspaceFiles.length,
      private: privateFiles.length,
      team: teamFiles.length,
      totalActive: activeEntries.length
    },
    paths: {
      workspace: paths.workspaceDir,
      private: paths.privateDir,
      team: paths.teamDir
    },
    domains,
    domainSummary,
    staleCount: staleEntries.length,
    staleEntries,
    syncStatus: {
      privateGit,
      teamGit
    }
  };
}

export function resolveSingleMemoryContent(workspaceRoot, layer, slug, activeIndex) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('A memory slug string is required.');
  }

  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  const slugKey = cleanSlug.toLowerCase();
  const normalizedLayer = (layer || 'all').toLowerCase();
  const paths = resolveStoragePaths(workspaceRoot);

  let filePath = null;
  let resolvedLayer = normalizedLayer;

  if (normalizedLayer === 'all') {
    const active = activeIndex.get(slugKey);
    if (active && fs.existsSync(active.file)) {
      filePath = active.file;
      resolvedLayer = active.layerKey;
    } else {
      const candidates = [
        { key: 'workspace', p: path.join(paths.workspaceDir, `${cleanSlug}.md`) },
        { key: 'private', p: path.join(paths.privateDir, `${cleanSlug}.md`) },
        { key: 'team', p: path.join(paths.teamDir, `${cleanSlug}.md`) }
      ];
      for (const cand of candidates) {
        if (fs.existsSync(cand.p)) {
          filePath = cand.p;
          resolvedLayer = cand.key;
          break;
        }
      }
    }
    if (!filePath) {
      throw new Error(`Memory slug '${cleanSlug}' was not found in any active layer.`);
    }
  } else {
    let layerDir = paths.workspaceDir;
    if (normalizedLayer === 'private') layerDir = paths.privateDir;
    if (normalizedLayer === 'team') layerDir = paths.teamDir;
    filePath = path.join(layerDir, `${cleanSlug}.md`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Memory slug '${cleanSlug}' was not found in layer '${normalizedLayer}'.`);
    }
  }

  const rawContent = fs.readFileSync(filePath, 'utf8');
  const parsed = parseYamlFrontmatter(rawContent);
  const relatedList = Array.isArray(parsed.frontmatter.related) ? parsed.frontmatter.related : [];

  let enrichedContent = rawContent;
  const resolvedRelated = [];

  if (relatedList.length > 0) {
    const graphLines = [];
    for (const relSlug of relatedList) {
      const target = activeIndex.get(relSlug);
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
  for (const [entrySlug, entry] of activeIndex.entries()) {
    if (entrySlug === slugKey || !entry || seenBacklinks.has(entry.slug)) continue;
    const isRelated = Array.isArray(entry.related) && entry.related.includes(slugKey);
    const isOverridden = Array.isArray(entry.overridesList) && entry.overridesList.includes(slugKey);
    if (isRelated || isOverridden) {
      seenBacklinks.add(entry.slug);
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

  if (backlinkLines.length > 0) {
    enrichedContent = enrichedContent.trimEnd() + '\n\n---\n### Incoming Backlinks (Referenced By)\n' + backlinkLines.join('\n') + '\n';
  }

  return {
    layer: resolvedLayer,
    slug: slugKey,
    path: filePath,
    frontmatter: parsed.frontmatter,
    relatedMemories: resolvedRelated,
    backlinks,
    content: enrichedContent
  };
}

export function getMemoryContent(workspaceRoot, layer, slug, slugs) {
  const normalizedLayer = (layer || 'all').toLowerCase();
  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  const activeIndex = new Map();
  for (const entry of activeEntries) {
    if (!activeIndex.has(entry.slug)) {
      activeIndex.set(entry.slug, entry);
    }
    for (const overridden of entry.overridesList) {
      if (!activeIndex.has(overridden)) {
        activeIndex.set(overridden, entry);
      }
    }
  }

  const multiList = Array.isArray(slugs) ? slugs : (Array.isArray(slug) ? slug : null);
  if (multiList && multiList.length > 0) {
    const items = multiList.map((s) => resolveSingleMemoryContent(workspaceRoot, normalizedLayer, s, activeIndex));
    return {
      layer: normalizedLayer,
      slugs: items.map((i) => i.slug),
      items,
      content: items.map((i) => i.content).join('\n\n===\n\n')
    };
  }

  return resolveSingleMemoryContent(workspaceRoot, normalizedLayer, slug, activeIndex);
}

export function rewireMemoryReferences(workspaceRoot, oldSlug, newSlug) {
  if (!oldSlug || !newSlug || oldSlug === newSlug) return 0;
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

        if (Array.isArray(parsed.frontmatter.related) && parsed.frontmatter.related.includes(oldSlug)) {
          parsed.frontmatter.related = parsed.frontmatter.related.map(s => (s === oldSlug ? newSlug : s));
          parsed.frontmatter.related = [...new Set(parsed.frontmatter.related)];
          modified = true;
        }

        if (parsed.frontmatter.overrides) {
          const overridesList = parseInlineArrayOrList(parsed.frontmatter.overrides);
          if (overridesList.includes(oldSlug)) {
            const updated = overridesList.map(s => (s === oldSlug ? newSlug : s));
            parsed.frontmatter.overrides = Array.isArray(parsed.frontmatter.overrides)
              ? [...new Set(updated)]
              : [...new Set(updated)].join(', ');
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

        if (Array.isArray(parsed.frontmatter.related) && parsed.frontmatter.related.includes(deletedSlug)) {
          parsed.frontmatter.related = parsed.frontmatter.related.filter(s => s !== deletedSlug);
          modified = true;
        }

        if (parsed.frontmatter.overrides) {
          const overridesList = parseInlineArrayOrList(parsed.frontmatter.overrides);
          if (overridesList.includes(deletedSlug)) {
            const updated = overridesList.filter(s => s !== deletedSlug);
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

  const frontmatter = {
    name: cleanSlug,
    type,
    domain: domain.toLowerCase(),
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
    const oldFile = path.join(targetDir, `${oldSlug.replace(/\.md$/i, '')}.md`);
    if (fs.existsSync(oldFile)) {
      fs.unlinkSync(oldFile);
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
  const paths = resolveStoragePaths(workspaceRoot);
  const targetDir = normLayer === 'workspace' ? paths.workspaceDir : paths.privateDir;

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

  let totalRewired = 0;
  for (const src of sourceSlugs) {
    const cleanSrc = src.replace(/\.md$/i, '').trim();
    if (cleanSrc === saveRes.slug) continue;

    const srcPath = path.join(targetDir, `${cleanSrc}.md`);
    if (fs.existsSync(srcPath)) {
      fs.unlinkSync(srcPath);
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
  const paths = resolveStoragePaths(workspaceRoot);

  const targetDir = normLayer === 'workspace' ? paths.workspaceDir : paths.privateDir;
  const filePath = path.join(targetDir, `${cleanSlug}.md`);

  if (!fs.existsSync(filePath)) {
    return { success: false, message: `File '${cleanSlug}.md' not found in layer '${normLayer}'.` };
  }

  fs.unlinkSync(filePath);
  const cleanedReferences = cleanDanglingReferences(workspaceRoot, cleanSlug);

  return {
    success: true,
    layer: normLayer,
    deletedSlug: cleanSlug,
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
      const dirty = execSync('git status --porcelain', { cwd: dir, encoding: 'utf8', timeout: 3000, env: GIT_EXEC_ENV }).trim();
      if (dirty) {
        return { success: false, status: 'dirty-working-copy', dirtyDetails: dirty.split('\n') };
      }
      const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: dir, encoding: 'utf8', timeout: 3000, env: GIT_EXEC_ENV }).trim();
      if (branch.startsWith('promote/')) {
        return { success: false, status: 'on-promote-branch', branch };
      }
      try {
        execSync(`git branch --set-upstream-to=origin/${branch} "${branch}"`, { cwd: dir, stdio: 'ignore' });
      } catch {}
      const pullOut = execSync('git pull --ff-only', { cwd: dir, encoding: 'utf8', timeout: 5000, env: GIT_EXEC_ENV }).trim();
      return { success: true, status: 'synchronized', branch, output: pullOut };
    } catch (err) {
      return { success: false, status: 'error', error: err.message };
    }
  };

  if (layer === 'all' || layer === 'private') {
    results.private = { attempted: true, ...syncRepo(paths.privateDir) };
  }
  if (layer === 'all' || layer === 'team') {
    results.team = { attempted: true, ...syncRepo(paths.teamDir) };
  }

  return results;
}

export function prepareTeamPromotion(workspaceRoot, params = {}) {
  const { slug, content: customContent, frontmatter: customFm } = params;
  if (!slug) throw new Error('A memory slug is required for promotion.');

  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  const paths = resolveStoragePaths(workspaceRoot);
  const privateFile = path.join(paths.privateDir, `${cleanSlug}.md`);

  if (!customContent && !fs.existsSync(privateFile)) {
    throw new Error(`Private memory file '${cleanSlug}.md' does not exist.`);
  }

  const teamGit = path.join(paths.teamDir, '.git');
  if (!fs.existsSync(teamGit)) {
    throw new Error('Team memory clone is not initialized with Git. Run /kc-init first.');
  }

  let defaultBranch = 'main';
  try {
    const branchList = execFileSync('git', ['branch', '-a'], { cwd: paths.teamDir, env: GIT_EXEC_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    if (branchList.includes('master') && !branchList.includes('main')) {
      defaultBranch = 'master';
    }
  } catch {}

  try {
    execFileSync('git', ['checkout', defaultBranch], { cwd: paths.teamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
    execFileSync('git', ['pull', '--ff-only'], { cwd: paths.teamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
  } catch {}

  const dateStr = new Date().toISOString().slice(0, 10);
  const branchName = `promote/${dateStr}-${cleanSlug}`;
  try {
    execFileSync('git', ['checkout', '-b', branchName], { cwd: paths.teamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
  } catch {
    execFileSync('git', ['checkout', branchName], { cwd: paths.teamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
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

  const targetFile = path.join(paths.teamDir, `${cleanSlug}.md`);
  atomicWriteFileSync(targetFile, teamContent, 'utf8');

  return {
    success: true,
    slug: cleanSlug,
    branch: branchName,
    stagedFile: targetFile,
    prCommand: `gh pr create --base ${defaultBranch} --head "${branchName}" --title "memory: promote ${cleanSlug}" --fill`
  };
}
