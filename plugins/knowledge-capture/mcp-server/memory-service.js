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

export function parseYamlFrontmatter(fileContent) {
  if (!fileContent || typeof fileContent !== 'string') {
    return { frontmatter: {}, body: '' };
  }

  const trimmed = fileContent.trimStart();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: fileContent };
  }

  const endIndex = trimmed.indexOf('\n---', 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: fileContent };
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

      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      frontmatter[key] = value;
      currentKey = key;
    } else if (currentKey) {
      if (trimmedLine.startsWith('-')) {
        // Handle list item
        if (!Array.isArray(frontmatter[currentKey])) {
          frontmatter[currentKey] = [];
        }
        const item = trimmedLine.replace(/^-\s*/, '').trim();
        frontmatter[currentKey].push(item);
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
      .map((entry) => path.join(dirPath, entry.name));
  } catch {
    return [];
  }
}

export function getMemorySummary(workspaceRoot, targetLayer = 'all') {
  const paths = resolveStoragePaths(workspaceRoot);
  const layersToScan = [];

  const normalized = (targetLayer || 'all').toLowerCase();
  // Maintain strict precedence: Workspace > Private > Team
  if (normalized === 'all' || normalized === 'workspace') {
    layersToScan.push({ name: 'Workspace', dir: paths.workspaceDir });
  }
  if (normalized === 'all' || normalized === 'private') {
    layersToScan.push({ name: 'Private', dir: paths.privateDir });
  }
  if (normalized === 'all' || normalized === 'team') {
    layersToScan.push({ name: 'Team', dir: paths.teamDir });
  }

  const rows = [];

  for (const layer of layersToScan) {
    const files = findMarkdownFiles(layer.dir);
    for (const file of files) {
      const base = path.basename(file, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const content = fs.readFileSync(file, 'utf8');
        const parsed = parseYamlFrontmatter(content);
        const slug = parsed.frontmatter.slug || base;
        const type = parsed.frontmatter.type || 'general';
        const overrides = parsed.frontmatter.overrides || '';
        const trigger =
          parsed.frontmatter.trigger ||
          parsed.frontmatter.description ||
          'General guideline';

        rows.push({
          layer: layer.name,
          slug,
          type,
          overrides: Array.isArray(overrides) ? overrides.join(', ') : overrides,
          trigger,
          file
        });
      } catch {
        // Skip unreadable files gracefully
      }
    }
  }

  if (rows.length === 0) {
    return 'No persistent memory entries found in the selected layer(s).';
  }

  // Format as a compact Markdown table
  let table = '| Layer | Slug | Type | Overrides | Trigger / Description |\n';
  table += '| :--- | :--- | :---: | :---: | :--- |\n';
  for (const row of rows) {
    const sanitizedTrigger = row.trigger.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
    const overridesCell = row.overrides ? `\`${row.overrides}\`` : '-';
    table += `| ${row.layer} | \`${row.slug}\` | \`${row.type}\` | ${overridesCell} | ${sanitizedTrigger} |\n`;
  }

  return table;
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
      timeout: 5000,
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
      // Invalids settings handled gracefully
    }
  }

  const privateGit = queryGitRepoStatus(paths.privateDir);
  const teamGit = queryGitRepoStatus(paths.teamDir);

  return {
    counts: {
      workspace: workspaceFiles.length,
      private: privateFiles.length,
      team: teamFiles.length,
      total: workspaceFiles.length + privateFiles.length + teamFiles.length
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

export function getMemoryContent(workspaceRoot, layer, slug) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('A valid memory slug must be specified.');
  }

  // Security guardrail: prevent directory traversal
  const cleanSlug = path.basename(slug.trim());
  if (cleanSlug !== slug.trim() || cleanSlug.includes('..')) {
    throw new Error('Invalid memory slug. Directory traversal is prohibited.');
  }

  const paths = resolveStoragePaths(workspaceRoot);
  const normalizedLayer = (layer || '').toLowerCase();

  let targetDir = null;
  if (normalizedLayer === 'workspace') {
    targetDir = paths.workspaceDir;
  } else if (normalizedLayer === 'private') {
    targetDir = paths.privateDir;
  } else if (normalizedLayer === 'team') {
    targetDir = paths.teamDir;
  } else {
    throw new Error(
      `Invalid layer specified: '${layer}'. Must be one of: 'workspace', 'private', or 'team'.`
    );
  }

  const fileName = cleanSlug.endsWith('.md') ? cleanSlug : `${cleanSlug}.md`;
  const filePath = path.join(targetDir, fileName);

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Memory slug '${cleanSlug}' was not found in layer '${normalizedLayer}'.`
    );
  }

  const rawContent = fs.readFileSync(filePath, 'utf8');
  const parsed = parseYamlFrontmatter(rawContent);

  return {
    layer: normalizedLayer,
    slug: cleanSlug.replace(/\.md$/, ''),
    path: filePath,
    frontmatter: parsed.frontmatter,
    content: rawContent
  };
}
