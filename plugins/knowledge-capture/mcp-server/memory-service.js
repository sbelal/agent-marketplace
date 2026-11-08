import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Pure Query Functions for Knowledge Capture Storage & Inspection (Strict CQS Compliance)
 */

export function getHomeDir() {
  return os.homedir();
}

export function resolveStoragePaths(workspaceRoot = process.cwd()) {
  const home = getHomeDir();
  const baseDir = path.join(home, '.gemini', 'knowledge-capture');
  return {
    baseDir,
    settingsPath: path.join(baseDir, 'settings.json'),
    privateDir: path.join(baseDir, 'private'),
    teamDir: path.join(baseDir, 'team'),
    workspaceDir: path.join(workspaceRoot, '.agents', 'rules', 'memory')
  };
}

const GIT_EXEC_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=3'
};

const STALE_THRESHOLD_DAYS = 180;

function stripQuotes(str) {
  const s = String(str || '').trim();
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseInlineArrayOrList(rawVal) {
  if (Array.isArray(rawVal)) {
    return rawVal
      .map((item) => stripQuotes(item).replace(/\.md$/i, ''))
      .filter(Boolean);
  }
  if (!rawVal || typeof rawVal !== 'string') {
    return [];
  }
  let inner = rawVal.trim();
  if (inner.startsWith('[') && inner.endsWith(']')) {
    inner = inner.slice(1, -1).trim();
  }
  if (!inner) {
    return [];
  }
  return inner
    .split(',')
    .map((item) => stripQuotes(item).replace(/\.md$/i, ''))
    .filter(Boolean);
}

export function parseYamlFrontmatter(fileContent) {
  if (!fileContent || typeof fileContent !== 'string') {
    return {
      frontmatter: {
        type: 'general',
        domain: 'general',
        related: []
      },
      body: ''
    };
  }

  const trimmed = fileContent.trimStart();
  if (!trimmed.startsWith('---')) {
    return {
      frontmatter: {
        type: 'general',
        domain: 'general',
        related: []
      },
      body: fileContent
    };
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return {
      frontmatter: {
        type: 'general',
        domain: 'general',
        related: []
      },
      body: fileContent
    };
  }

  const rawYaml = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 4).trimStart();
  const frontmatter = {};

  const lines = rawYaml.split(/\r?\n/);
  let currentKey = null;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }

    const colonIndex = line.indexOf(':');
    if (colonIndex > 0 && !line.startsWith(' ') && !line.startsWith('\t')) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      // Handle multiline indicators like > or |
      if (value === '>' || value === '|') {
        frontmatter[key] = '';
        currentKey = key;
        continue;
      }

      // Handle inline YAML array syntax: [item1, item2]
      if (value.startsWith('[') && value.endsWith(']')) {
        frontmatter[key] = parseInlineArrayOrList(value);
        currentKey = key;
        continue;
      }

      value = stripQuotes(value);
      frontmatter[key] = value;
      currentKey = key;
    } else if (currentKey) {
      if (trimmedLine.startsWith('-')) {
        // Handle list item
        if (!Array.isArray(frontmatter[currentKey])) {
          frontmatter[currentKey] = [];
        }
        const item = stripQuotes(trimmedLine.replace(/^-\s*/, '').trim());
        if (item) {
          frontmatter[currentKey].push(item);
        }
      } else {
        // Continuation of multiline string
        if (typeof frontmatter[currentKey] === 'string') {
          const sep = frontmatter[currentKey] ? ' ' : '';
          frontmatter[currentKey] += sep + trimmedLine;
        }
      }
    }
  }

  // Normalize aliases: slug <-> name, trigger <-> description
  if (!frontmatter.slug && frontmatter.name) {
    frontmatter.slug = frontmatter.name;
  }
  if (!frontmatter.name && frontmatter.slug) {
    frontmatter.name = frontmatter.slug;
  }
  if (!frontmatter.trigger && frontmatter.description) {
    frontmatter.trigger = frontmatter.description;
  }
  if (!frontmatter.description && frontmatter.trigger) {
    frontmatter.description = frontmatter.trigger;
  }
  if (!frontmatter.type) {
    frontmatter.type = 'general';
  }

  // Normalize domain (defaults to "general")
  if (typeof frontmatter.domain === 'string' && frontmatter.domain.trim()) {
    frontmatter.domain = frontmatter.domain.trim().toLowerCase();
  } else {
    frontmatter.domain = 'general';
  }

  // Normalize related (defaults to [])
  frontmatter.related = parseInlineArrayOrList(frontmatter.related);

  return { frontmatter, body };
}

export function findMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

function scanLayerEntries(workspaceRoot, targetLayer = 'all') {
  const paths = resolveStoragePaths(workspaceRoot);
  const layersToScan = [];

  const normalized = (targetLayer || 'all').toLowerCase();
  // Maintain strict precedence: Workspace > Private > Team
  if (normalized === 'all' || normalized === 'workspace') {
    layersToScan.push({ name: 'Workspace', key: 'workspace', dir: paths.workspaceDir });
  }
  if (normalized === 'all' || normalized === 'private') {
    layersToScan.push({ name: 'Private', key: 'private', dir: paths.privateDir });
  }
  if (normalized === 'all' || normalized === 'team') {
    layersToScan.push({ name: 'Team', key: 'team', dir: paths.teamDir });
  }

  const allEntries = [];
  const activeEntries = [];
  const shadowedEntries = [];

  const seenSlugs = new Map(); // slug -> { layer, slug }
  const overriddenSlugs = new Map(); // targetSlug -> { byLayer, bySlug }

  for (const layer of layersToScan) {
    const files = findMarkdownFiles(layer.dir);
    const layerParsed = [];

    for (const file of files) {
      const base = path.basename(file, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const content = fs.readFileSync(file, 'utf8');
        const parsed = parseYamlFrontmatter(content);
        const slug = (parsed.frontmatter.slug || base).replace(/\.md$/i, '');
        const type = parsed.frontmatter.type || 'general';
        const domain = parsed.frontmatter.domain || 'general';
        const overridesRaw = parsed.frontmatter.overrides || '';
        const overridesList = parseInlineArrayOrList(overridesRaw);
        const related = Array.isArray(parsed.frontmatter.related)
          ? parsed.frontmatter.related
          : [];
        const verified = parsed.frontmatter.verified || '';
        const trigger =
          parsed.frontmatter.trigger ||
          parsed.frontmatter.description ||
          'General guideline';

        const entry = {
          layer: layer.name,
          layerKey: layer.key,
          slug,
          type,
          domain,
          overrides: overridesList.join(', '),
          overridesList,
          related,
          verified,
          trigger,
          file,
          frontmatter: parsed.frontmatter
        };

        allEntries.push(entry);
        layerParsed.push(entry);
      } catch {
        // Skip unreadable files gracefully
      }
    }

    for (const entry of layerParsed) {
      const directShadow = seenSlugs.get(entry.slug);
      const overrideShadow = overriddenSlugs.get(entry.slug);

      if (directShadow || overrideShadow) {
        const shadowedBy = directShadow || overrideShadow;
        shadowedEntries.push({
          ...entry,
          shadowedByLayer: shadowedBy.byLayer,
          shadowedBySlug: shadowedBy.bySlug
        });
        continue;
      }

      activeEntries.push(entry);
      seenSlugs.set(entry.slug, { byLayer: entry.layer, bySlug: entry.slug });
      for (const target of entry.overridesList) {
        if (!overriddenSlugs.has(target)) {
          overriddenSlugs.set(target, { byLayer: entry.layer, bySlug: entry.slug });
        }
      }
    }
  }

  return { allEntries, activeEntries, shadowedEntries };
}

export function getMemorySummary(workspaceRoot, targetLayer = 'all', filterOptions = {}) {
  let layerArg = targetLayer;
  let opts = filterOptions || {};

  if (targetLayer && typeof targetLayer === 'object') {
    opts = targetLayer;
    layerArg = opts.layer || 'all';
  }

  const domainFilter =
    typeof opts.domain === 'string' && opts.domain.trim()
      ? opts.domain.trim().toLowerCase()
      : null;
  const queryFilter =
    typeof opts.query === 'string' && opts.query.trim()
      ? opts.query.trim().toLowerCase()
      : null;

  const { activeEntries, shadowedEntries } = scanLayerEntries(workspaceRoot, layerArg);

  if (activeEntries.length === 0) {
    return 'No persistent memory entries found in the selected layer(s).';
  }

  const filtered = activeEntries.filter((row) => {
    if (domainFilter && row.domain.toLowerCase() !== domainFilter) {
      return false;
    }
    if (queryFilter) {
      const searchable = [
        row.slug,
        row.domain,
        row.type,
        row.trigger,
        row.overrides,
        row.related.join(' ')
      ]
        .join(' ')
        .toLowerCase();

      const tokens = queryFilter.split(/\s+/).filter(Boolean);
      const matchesAllTokens = tokens.every((tok) => searchable.includes(tok));
      if (!matchesAllTokens) {
        return false;
      }
    }
    return true;
  });

  if (filtered.length === 0) {
    return 'No persistent memory entries matched the specified filter criteria.';
  }

  // Group by domain
  const domainGroups = new Map();
  for (const row of filtered) {
    const dom = row.domain || 'general';
    if (!domainGroups.has(dom)) {
      domainGroups.set(dom, []);
    }
    domainGroups.get(dom).push(row);
  }

  const sortedDomains = Array.from(domainGroups.keys()).sort((a, b) => {
    if (a === 'general' && b !== 'general') return 1;
    if (b === 'general' && a !== 'general') return -1;
    return a.localeCompare(b);
  });

  let output = '';
  for (const dom of sortedDomains) {
    const groupRows = domainGroups.get(dom);
    output += `### Domain: ${dom}\n\n`;
    output += '| Layer | Slug | Type | Overrides | Related | Trigger / Description |\n';
    output += '| :--- | :--- | :---: | :---: | :---: | :--- |\n';
    for (const row of groupRows) {
      const sanitizedTrigger = row.trigger.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      const overridesCell = row.overrides ? `\`${row.overrides}\`` : '-';
      const relatedCell =
        row.related && row.related.length > 0
          ? row.related.map((r) => `\`${r}\``).join(', ')
          : '-';
      output += `| ${row.layer} | \`${row.slug}\` | \`${row.type}\` | ${overridesCell} | ${relatedCell} | ${sanitizedTrigger} |\n`;
    }
    output += '\n';
  }

  if (shadowedEntries.length > 0) {
    const shadowedNotes = shadowedEntries.map(
      (s) =>
        `\`${s.layer}/${s.slug}\` (shadowed by \`${s.shadowedByLayer}/${s.shadowedBySlug}\`)`
    );
    output += `> *Shadowed lower-tier entries hidden by precedence: ${shadowedNotes.join(', ')}*\n`;
  }

  return output.trimEnd() + '\n';
}

function queryGitRepoStatus(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    return {
      isGit: false,
      branch: 'none',
      isClean: true,
      uncommittedCount: 0,
      uncommittedList: [],
      upstreamAhead: 0,
      upstreamBehind: 0,
      isPromoteBranch: false
    };
  }

  let branch = 'unknown';
  try {
    branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 3000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    branch = 'unknown';
  }

  let isClean = true;
  let uncommittedList = [];
  try {
    const statusOutput = execSync('git status --porcelain', {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 3000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    if (statusOutput.length > 0) {
      isClean = false;
      uncommittedList = statusOutput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore git error
  }

  let upstreamAhead = 0;
  let upstreamBehind = 0;
  try {
    const aheadBehind = execSync('git rev-list --count --left-right HEAD...@{u}', {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 3000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (aheadBehind) {
      const parts = aheadBehind.split(/\s+/);
      upstreamAhead = parseInt(parts[0], 10) || 0;
      upstreamBehind = parseInt(parts[1], 10) || 0;
    }
  } catch {
    // Upstream tracking not set or offline
  }

  return {
    isGit: true,
    branch,
    isClean,
    uncommittedCount: uncommittedList.length,
    uncommittedList,
    upstreamAhead,
    upstreamBehind,
    isPromoteBranch: branch.startsWith('promote/')
  };
}

function evaluateEntryStaleness(verifiedStr, nowMs = Date.now()) {
  if (!verifiedStr || typeof verifiedStr !== 'string' || !verifiedStr.trim()) {
    return { isStale: true, reason: 'missing', daysOld: null };
  }
  const parsedMs = Date.parse(verifiedStr.trim());
  if (Number.isNaN(parsedMs)) {
    return { isStale: true, reason: 'invalid', daysOld: null };
  }
  const daysOld = Math.floor((nowMs - parsedMs) / (1000 * 60 * 60 * 24));
  return {
    isStale: daysOld > STALE_THRESHOLD_DAYS,
    reason: daysOld > STALE_THRESHOLD_DAYS ? 'expired' : 'fresh',
    daysOld
  };
}

export function getLayerStatistics(workspaceRoot) {
  const paths = resolveStoragePaths(workspaceRoot);

  const workspaceFiles = findMarkdownFiles(paths.workspaceDir).filter(
    (f) => path.basename(f, '.md').toUpperCase() !== 'README'
  );
  const privateFiles = findMarkdownFiles(paths.privateDir).filter(
    (f) => path.basename(f, '.md').toUpperCase() !== 'README'
  );
  const teamFiles = findMarkdownFiles(paths.teamDir).filter(
    (f) => path.basename(f, '.md').toUpperCase() !== 'README'
  );

  const { allEntries, activeEntries } = scanLayerEntries(workspaceRoot, 'all');

  // Compute domain breakdown across active entries
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
  const domainSummary =
    sortedDomains.length > 0
      ? sortedDomains.map(([dom, count]) => `${dom} (${count})`).join(', ')
      : 'none';

  // Compute stale entries (verified > 180 days or missing) across active layers
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

  let hasSettings = fs.existsSync(paths.settingsPath);
  let privateRepoConfigured = false;
  let teamRepoConfigured = false;
  let settings = {};

  if (hasSettings) {
    try {
      const raw = fs.readFileSync(paths.settingsPath, 'utf8');
      settings = JSON.parse(raw);
      if (settings.privateRepoUrl && typeof settings.privateRepoUrl === 'string') {
        privateRepoConfigured = true;
      }
      if (settings.teamRepoUrl && typeof settings.teamRepoUrl === 'string') {
        teamRepoConfigured = true;
      }
    } catch {
      // Invalid settings handled gracefully
    }
  }

  const privateGit = queryGitRepoStatus(paths.privateDir);
  const teamGit = queryGitRepoStatus(paths.teamDir);

  return {
    counts: {
      workspace: workspaceFiles.length,
      private: privateFiles.length,
      team: teamFiles.length,
      total: workspaceFiles.length + privateFiles.length + teamFiles.length,
      active: activeEntries.length,
      stale: staleEntries.length
    },
    domains,
    domainSummary,
    staleCount: staleEntries.length,
    staleness: {
      staleCount: staleEntries.length,
      thresholdDays: STALE_THRESHOLD_DAYS,
      staleEntries
    },
    paths: {
      workspace: paths.workspaceDir,
      private: paths.privateDir,
      team: paths.teamDir,
      settings: paths.settingsPath
    },
    syncStatus: {
      hasSettings,
      privateRepoConfigured,
      teamRepoConfigured,
      privateGit,
      teamGit,
      uncommittedPrivateChanges: !privateGit.isClean,
      uncommittedCount: privateGit.uncommittedCount,
      uncommittedDetails: privateGit.uncommittedList
    }
  };
}

function resolveSingleMemoryContent(workspaceRoot, normalizedLayer, rawSlug, activeIndex) {
  if (!rawSlug || typeof rawSlug !== 'string') {
    throw new Error('A valid memory slug must be specified.');
  }

  // Security guardrail: prevent directory traversal
  const cleanSlug = path.basename(rawSlug.trim());
  if (cleanSlug !== rawSlug.trim() || cleanSlug.includes('..')) {
    throw new Error('Invalid memory slug. Directory traversal is prohibited.');
  }

  const slugKey = cleanSlug.replace(/\.md$/i, '');
  const paths = resolveStoragePaths(workspaceRoot);
  const fileName = cleanSlug.endsWith('.md') ? cleanSlug : `${cleanSlug}.md`;

  let resolvedLayer = normalizedLayer;
  let filePath = null;

  if (!normalizedLayer || normalizedLayer === 'all') {
    // Resolve using Workspace > Private > Team precedence
    const candidates = [
      { key: 'workspace', dir: paths.workspaceDir },
      { key: 'private', dir: paths.privateDir },
      { key: 'team', dir: paths.teamDir }
    ];
    for (const cand of candidates) {
      const p = path.join(cand.dir, fileName);
      if (fs.existsSync(p)) {
        resolvedLayer = cand.key;
        filePath = p;
        break;
      }
    }
    if (!filePath) {
      throw new Error(
        `Memory slug '${slugKey}' was not found in any active layer (workspace, private, team).`
      );
    }
  } else {
    let targetDir = null;
    if (normalizedLayer === 'workspace') {
      targetDir = paths.workspaceDir;
    } else if (normalizedLayer === 'private') {
      targetDir = paths.privateDir;
    } else if (normalizedLayer === 'team') {
      targetDir = paths.teamDir;
    } else {
      throw new Error(
        `Invalid layer specified: '${normalizedLayer}'. Must be one of: 'workspace', 'private', 'team', or 'all'.`
      );
    }

    filePath = path.join(targetDir, fileName);
    if (!fs.existsSync(filePath)) {
      throw new Error(
        `Memory slug '${cleanSlug}' was not found in layer '${normalizedLayer}'.`
      );
    }
  }

  const rawContent = fs.readFileSync(filePath, 'utf8');
  const parsed = parseYamlFrontmatter(rawContent);
  const relatedList = Array.isArray(parsed.frontmatter.related)
    ? parsed.frontmatter.related
    : [];

  let enrichedContent = rawContent;
  const resolvedRelated = [];

  if (relatedList.length > 0) {
    const graphLines = [];
    for (const relSlug of relatedList) {
      const target = activeIndex.get(relSlug);
      if (target) {
        graphLines.push(
          `- \`[${target.layerKey}] ${target.slug}\` (${target.type}): ${target.trigger}`
        );
        resolvedRelated.push({
          slug: target.slug,
          layer: target.layerKey,
          type: target.type,
          description: target.trigger,
          resolved: true
        });
      } else {
        graphLines.push(`- \`[unresolved/broken reference] ${relSlug}\``);
        resolvedRelated.push({
          slug: relSlug,
          layer: null,
          resolved: false
        });
      }
    }

    enrichedContent =
      rawContent.trimEnd() +
      '\n\n---\n### Related Memories Available (1-Hop Graph)\n' +
      graphLines.join('\n') +
      '\n';
  }

  return {
    layer: resolvedLayer,
    slug: slugKey,
    path: filePath,
    frontmatter: parsed.frontmatter,
    relatedMemories: resolvedRelated,
    content: enrichedContent
  };
}

export function getMemoryContent(workspaceRoot, layer, slug, slugs) {
  const normalizedLayer = (layer || 'all').toLowerCase();

  // Build active lookup index across Workspace > Private > Team (respecting precedence & overrides)
  const { activeEntries } = scanLayerEntries(workspaceRoot, 'all');
  const activeIndex = new Map();
  for (const entry of activeEntries) {
    if (!activeIndex.has(entry.slug)) {
      activeIndex.set(entry.slug, entry);
    }
    // If a higher-tier entry overrides a lower-tier slug, point the old slug to the active overriding entry
    for (const overridden of entry.overridesList) {
      if (!activeIndex.has(overridden)) {
        activeIndex.set(overridden, entry);
      }
    }
  }

  // Support array of slugs via `slugs` param or `Array.isArray(slug)`
  const multiList = Array.isArray(slugs)
    ? slugs
    : Array.isArray(slug)
      ? slug
      : null;

  if (multiList && multiList.length > 0) {
    const items = multiList.map((s) =>
      resolveSingleMemoryContent(workspaceRoot, normalizedLayer, s, activeIndex)
    );
    return {
      layer: normalizedLayer,
      slugs: items.map((i) => i.slug),
      items,
      content: items.map((i) => i.content).join('\n\n===\n\n')
    };
  }

  return resolveSingleMemoryContent(workspaceRoot, normalizedLayer, slug, activeIndex);
}

