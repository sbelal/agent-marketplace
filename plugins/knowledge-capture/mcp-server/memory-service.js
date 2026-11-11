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

// ==========================================
// CQS COMMAND PROCEDURES & LINK INTEGRITY
// ==========================================

/**
 * Serializes frontmatter and markdown body into standard string.
 */
export function serializeYamlFrontmatter(frontmatter, body) {
  const lines = ['---'];
  const keys = ['name', 'type', 'domain', 'description', 'verified', 'overrides', 'related', 'applies_to'];

  for (const k of keys) {
    if (frontmatter[k] !== undefined && frontmatter[k] !== null && frontmatter[k] !== '') {
      const val = frontmatter[k];
      if (Array.isArray(val)) {
        if (val.length === 0) {
          lines.push(`${k}: []`);
        } else {
          lines.push(`${k}: [${val.map(v => String(v).trim()).join(', ')}]`);
        }
      } else if (typeof val === 'object') {
        lines.push(`${k}:`);
        for (const [subk, subv] of Object.entries(val)) {
          if (Array.isArray(subv)) {
            lines.push(`  ${subk}: [${subv.map(v => JSON.stringify(v)).join(', ')}]`);
          } else {
            lines.push(`  ${subk}: ${JSON.stringify(subv)}`);
          }
        }
      } else {
        lines.push(`${k}: ${val}`);
      }
    }
  }

  // Include any extra custom keys
  for (const [k, v] of Object.entries(frontmatter)) {
    if (!keys.includes(k) && v !== undefined && v !== null) {
      if (typeof v === 'object') {
        lines.push(`${k}: ${JSON.stringify(v)}`);
      } else {
        lines.push(`${k}: ${v}`);
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(body ? body.trimStart() : '');
  return lines.join('\n') + '\n';
}

/**
 * Re-wires all incoming related: and overrides: references across Workspace and Private layers.
 */
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

        // Check related
        if (Array.isArray(parsed.frontmatter.related) && parsed.frontmatter.related.includes(oldSlug)) {
          parsed.frontmatter.related = parsed.frontmatter.related.map(s => (s === oldSlug ? newSlug : s));
          parsed.frontmatter.related = [...new Set(parsed.frontmatter.related)];
          modified = true;
        }

        // Check overrides
        if (parsed.frontmatter.overrides === oldSlug) {
          parsed.frontmatter.overrides = newSlug;
          modified = true;
        } else if (Array.isArray(parsed.frontmatter.overrides) && parsed.frontmatter.overrides.includes(oldSlug)) {
          parsed.frontmatter.overrides = parsed.frontmatter.overrides.map(s => (s === oldSlug ? newSlug : s));
          parsed.frontmatter.overrides = [...new Set(parsed.frontmatter.overrides)];
          modified = true;
        }

        if (modified) {
          const updatedRaw = serializeYamlFrontmatter(parsed.frontmatter, parsed.body);
          fs.writeFileSync(file, updatedRaw, 'utf8');
          rewiredCount++;
        }
      } catch {}
    }
  }
  return rewiredCount;
}

/**
 * Cleans dangling references pointing to a deleted slug.
 */
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

        if (parsed.frontmatter.overrides === deletedSlug) {
          delete parsed.frontmatter.overrides;
          modified = true;
        } else if (Array.isArray(parsed.frontmatter.overrides) && parsed.frontmatter.overrides.includes(deletedSlug)) {
          parsed.frontmatter.overrides = parsed.frontmatter.overrides.filter(s => s !== deletedSlug);
          if (parsed.frontmatter.overrides.length === 0) delete parsed.frontmatter.overrides;
          modified = true;
        }

        if (modified) {
          const updatedRaw = serializeYamlFrontmatter(parsed.frontmatter, parsed.body);
          fs.writeFileSync(file, updatedRaw, 'utf8');
          cleanedCount++;
        }
      } catch {}
    }
  }
  return cleanedCount;
}

/**
 * Explicit command: Saves, creates, or updates a memory entry with frontmatter schema validation.
 */
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
    related = [],
    applies_to
  } = params;

  if (!slug || typeof slug !== 'string') {
    throw new Error('A valid memory slug is required.');
  }

  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  if (!cleanSlug || cleanSlug.includes('..')) {
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

  // Construct Markdown body
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
  if (applies_to) {
    frontmatter.applies_to = applies_to;
  }

  const fileContent = serializeYamlFrontmatter(frontmatter, markdownBody);
  const targetFile = path.join(targetDir, `${cleanSlug}.md`);
  fs.writeFileSync(targetFile, fileContent, 'utf8');

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

/**
 * Explicit command: Merges multiple memory entries into a single cohesive target slug.
 */
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
    overrides,
    applies_to
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

  // 1. Save merged target entry
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
    overrides,
    applies_to
  });

  // 2. Remove source files and rewire references to targetSlug
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

/**
 * Explicit command: Deletes a memory entry and cleans dangling graph references.
 */
export function deleteMemoryEntry(workspaceRoot, params = {}) {
  const { layer = 'private', slug } = params;
  if (!slug) throw new Error('A memory slug is required for deletion.');

  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
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

/**
 * Explicit command: Synchronizes Git remotes for Private and Team layers safely.
 */
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

/**
 * Explicit command: Prepares an isolated promotion branch in the Team memory repository.
 */
export function prepareTeamPromotion(workspaceRoot, params = {}) {
  const { slug } = params;
  if (!slug) throw new Error('A memory slug is required for promotion.');

  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  const paths = resolveStoragePaths(workspaceRoot);
  const privateFile = path.join(paths.privateDir, `${cleanSlug}.md`);

  if (!fs.existsSync(privateFile)) {
    throw new Error(`Private memory file '${cleanSlug}.md' does not exist.`);
  }

  const teamGit = path.join(paths.teamDir, '.git');
  if (!fs.existsSync(teamGit)) {
    throw new Error('Team memory clone is not initialized with Git. Run /kc-init first.');
  }

  // 1. Check out main and pull latest
  try {
    execSync('git checkout main', { cwd: paths.teamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
    execSync('git pull --ff-only', { cwd: paths.teamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
  } catch {}

  // 2. Create promotion branch
  const dateStr = new Date().toISOString().slice(0, 10);
  const branchName = `promote/${dateStr}-${cleanSlug}`;
  try {
    execSync(`git checkout -b "${branchName}"`, { cwd: paths.teamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
  } catch {
    execSync(`git checkout "${branchName}"`, { cwd: paths.teamDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
  }

  // 3. Scrub and write team memory
  const rawContent = fs.readFileSync(privateFile, 'utf8');
  const parsed = parseYamlFrontmatter(rawContent);

  // Scrub personal usernames and machine paths
  const home = os.homedir();
  const username = os.userInfo().username;
  let scrubbedBody = parsed.body
    .replaceAll(home, '~')
    .replaceAll(username, '<developer>')
    .replace(/[A-Za-z]:\\[Users|Documents][^\s\n]+/gi, '<path>');

  const teamFm = {
    name: cleanSlug,
    type: parsed.frontmatter.type || 'convention',
    domain: parsed.frontmatter.domain || 'general',
    description: parsed.frontmatter.description || 'Team engineering standard',
    verified: dateStr,
    related: parsed.frontmatter.related || []
  };

  const teamContent = serializeYamlFrontmatter(teamFm, scrubbedBody);
  const targetFile = path.join(paths.teamDir, `${cleanSlug}.md`);
  fs.writeFileSync(targetFile, teamContent, 'utf8');

  return {
    success: true,
    slug: cleanSlug,
    branch: branchName,
    stagedFile: targetFile,
    prCommand: `gh pr create --base main --head "${branchName}" --title "memory: promote ${cleanSlug}" --fill`
  };
}

/**
 * Pure query: Checks pending tool calls against memory guardrails (JIT Interception).
 */
export function checkToolGuardrails(workspaceRoot, commandString, toolName = 'run_command') {
  if (!commandString || typeof commandString !== 'string') return [];
  const paths = resolveStoragePaths(workspaceRoot);
  const dirs = [paths.workspaceDir, paths.privateDir, paths.teamDir];
  const alerts = [];
  const lowerCmd = commandString.toLowerCase();

  for (const dir of dirs) {
    const files = findMarkdownFiles(dir);
    for (const file of files) {
      try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = parseYamlFrontmatter(raw);
        const appliesTo = parsed.frontmatter.applies_to;
        if (!appliesTo) continue;

        let matched = false;
        if (Array.isArray(appliesTo.tools) && !appliesTo.tools.includes(toolName)) {
          continue;
        }

        if (Array.isArray(appliesTo.command_patterns)) {
          for (const pat of appliesTo.command_patterns) {
            const cleanPat = pat.replace(/\*/g, '').toLowerCase().trim();
            if (cleanPat && lowerCmd.includes(cleanPat)) {
              matched = true;
              break;
            }
          }
        }

        if (matched) {
          alerts.push({
            slug: parsed.frontmatter.name || path.basename(file, '.md'),
            domain: parsed.frontmatter.domain || 'general',
            description: parsed.frontmatter.description || 'Execution Guardrail',
            message: `⚠️ Guardrail Alert [${parsed.frontmatter.name || path.basename(file, '.md')}]: ${parsed.frontmatter.description || ''}`
          });
        }
      } catch {}
    }
  }

  return alerts;
}

/**
 * Ingests an Architectural Decision Record (ADR) file into Team memory.
 */
export function ingestTeamAdr(workspaceRoot, adrFilePath) {
  if (!fs.existsSync(adrFilePath)) {
    throw new Error(`ADR file not found at ${adrFilePath}`);
  }

  const content = fs.readFileSync(adrFilePath, 'utf8');
  const baseName = path.basename(adrFilePath, path.extname(adrFilePath));
  const slug = `adr-${baseName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.replace(/^-|-$/g, '');

  const paths = resolveStoragePaths(workspaceRoot);
  const targetFile = path.join(paths.teamDir, `${slug}.md`);

  // Extract title
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : `ADR: ${baseName}`;

  const frontmatter = {
    name: slug,
    type: 'convention',
    domain: 'architecture',
    description: `When architectural decisions relating to ${title} apply`,
    verified: new Date().toISOString().slice(0, 10),
    related: []
  };

  const serialized = serializeYamlFrontmatter(frontmatter, content);
  fs.writeFileSync(targetFile, serialized, 'utf8');

  return {
    success: true,
    slug,
    title,
    path: targetFile
  };
}


