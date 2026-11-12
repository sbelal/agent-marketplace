import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveStoragePaths, getStorageDir, getSettings, deriveTeamRepoSlug, GIT_EXEC_ENV } from './storage-paths.js';
import { findMarkdownFiles } from '../retrieval/shadow-resolver.js';
import { parseYamlFrontmatter, serializeYamlFrontmatter } from './yaml-parser.js';
import { atomicWriteFileSync, cleanDanglingReferences } from './memory-store.js';

export { deriveTeamRepoSlug };

function saveSettings(settings, storageDir = getStorageDir()) {
  const p = path.join(storageDir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf8');
}

function validateSafeGitUrl(url) {
  if (url && url.trim().startsWith('-')) {
    throw new Error('Invalid repository URL: must not start with "-".');
  }
}

/**
 * Returns all configured team repositories with active states, entry counts, and git health.
 */
export function getTeamRepositories(workspaceRoot = process.cwd()) {
  const paths = resolveStoragePaths(workspaceRoot);
  const settings = getSettings(paths.baseDir);
  const teamBaseDir = paths.teamDir;

  const results = [];

  for (const repo of settings.teamRepos) {
    const repoDir = path.join(teamBaseDir, repo.slug);
    const gitDir = path.join(repoDir, '.git');
    const isGit = fs.existsSync(gitDir);

    let entriesCount = 0;
    if (fs.existsSync(repoDir)) {
      try {
        const files = fs.readdirSync(repoDir);
        entriesCount = files.filter(f => f.endsWith('.md') && f.toUpperCase() !== 'README.MD').length;
      } catch {}
    }

    let isClean = true;
    let uncommittedCount = 0;
    if (isGit) {
      try {
        const status = execFileSync('git', ['status', '--porcelain', '-z'], {
          cwd: repoDir,
          encoding: 'utf8',
          timeout: 2000,
          env: GIT_EXEC_ENV,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        if (status) {
          const entries = status.split('\0').filter(Boolean);
          if (entries.length > 0) {
            isClean = false;
            uncommittedCount = entries.length;
          }
        }
      } catch {}
    }

    results.push({
      slug: repo.slug,
      name: repo.name || repo.slug,
      url: repo.url || '',
      active: repo.active !== false,
      path: repoDir,
      isGit,
      isClean,
      uncommittedCount,
      entriesCount
    });
  }

  return results;
}

/**
 * Adds or updates a team repository by slug.
 * Flexible signature:
 * - addTeamRepository(slug, url, name, workspaceRoot)
 * - addTeamRepository(workspaceRoot, { slug, url, name, active })
 */
export function addTeamRepository(arg1 = process.cwd(), arg2 = {}, arg3 = null, arg4 = null) {
  let workspaceRoot = process.cwd();
  let options = {};

  if (typeof arg1 === 'string' && typeof arg2 === 'object' && arg2 !== null) {
    workspaceRoot = arg1;
    options = arg2;
  } else if (typeof arg1 === 'object' && arg1 !== null) {
    options = arg1;
    if (typeof arg2 === 'string') workspaceRoot = arg2;
  } else if (typeof arg1 === 'string') {
    // If arg1 looks like a URL, auto-derive slug
    if (arg1.startsWith('http://') || arg1.startsWith('https://') || arg1.startsWith('git@') || arg1.startsWith('ssh://')) {
      options.url = arg1;
      options.slug = deriveTeamRepoSlug(arg1);
      if (typeof arg2 === 'string') options.name = arg2;
      if (typeof arg3 === 'string') workspaceRoot = arg3;
    } else {
      options.slug = arg1;
      if (typeof arg2 === 'string') options.url = arg2;
      if (typeof arg3 === 'string') options.name = arg3;
      if (typeof arg4 === 'string') workspaceRoot = arg4;
    }
  }

  // If slug was not provided but url was, derive slug from URL (<org_id>-<repo_slug>)
  if (!options.slug && options.url) {
    options.slug = deriveTeamRepoSlug(options.url);
  }

  const rawSlug = String(options.slug || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  if (!rawSlug) {
    throw new Error('Team repository slug is required or must be derivable from Git URL (<org_id>-<repo_slug>).');
  }

  const url = (options.url || '').trim();
  validateSafeGitUrl(url);

  const paths = resolveStoragePaths(workspaceRoot);
  const settings = getSettings(paths.baseDir);
  const teamBaseDir = paths.teamDir;
  const targetDir = path.join(teamBaseDir, rawSlug);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const name = options.name || rawSlug;
  const active = options.active !== false;

  // Clone or init git if url provided
  if (url) {
    const gitDir = path.join(targetDir, '.git');
    if (!fs.existsSync(gitDir)) {
      try {
        execFileSync('git', ['clone', '--', url, '.'], {
          cwd: targetDir,
          timeout: 15000,
          env: GIT_EXEC_ENV,
          stdio: ['ignore', 'ignore', 'ignore']
        });
      } catch {
        // Fallback: init empty repo with remote
        try {
          execFileSync('git', ['init'], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          execFileSync('git', ['remote', 'add', 'origin', url], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
        } catch {}
      }
    } else {
      try {
        execFileSync('git', ['remote', 'set-url', 'origin', url], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
      } catch {}
    }
  }

  // Update settings.json
  const existingIdx = settings.teamRepos.findIndex(r => r.slug === rawSlug);
  const record = { slug: rawSlug, name, url, active };
  if (existingIdx >= 0) {
    settings.teamRepos[existingIdx] = record;
  } else {
    settings.teamRepos.push(record);
  }

  saveSettings(settings, paths.baseDir);

  return {
    ok: true,
    success: true,
    action: existingIdx >= 0 ? 'updated' : 'added',
    slug: rawSlug,
    targetDir,
    dir: targetDir,
    active
  };
}

/**
 * Toggles a team repository active status.
 * Flexible signature:
 * - setTeamRepositoryActive(slug, active, workspaceRoot)
 * - setTeamRepositoryActive(workspaceRoot, { slug, active })
 */
export function setTeamRepositoryActive(arg1 = process.cwd(), arg2 = {}, arg3 = null) {
  let workspaceRoot = process.cwd();
  let slug = '';
  let active = true;

  if (typeof arg1 === 'string' && typeof arg2 === 'object' && arg2 !== null) {
    workspaceRoot = arg1;
    slug = arg2.slug;
    active = arg2.active !== false;
  } else if (typeof arg1 === 'string' && typeof arg2 === 'boolean') {
    slug = arg1;
    active = arg2;
    if (typeof arg3 === 'string') workspaceRoot = arg3;
  } else if (typeof arg1 === 'string' && typeof arg2 === 'string' && typeof arg3 === 'boolean') {
    workspaceRoot = arg1;
    slug = arg2;
    active = arg3;
  }

  slug = String(slug || '').trim().toLowerCase();
  if (!slug) throw new Error('Slug is required');

  const paths = resolveStoragePaths(workspaceRoot);
  const settings = getSettings(paths.baseDir);

  const repo = settings.teamRepos.find(r => r.slug === slug);
  if (!repo) {
    throw new Error(`Team repository with slug "${slug}" not found.`);
  }

  repo.active = Boolean(active);
  saveSettings(settings, paths.baseDir);

  return {
    ok: true,
    success: true,
    slug,
    active: repo.active
  };
}

/**
 * Removes a team repository from settings and optionally purges files.
 * Flexible signature:
 * - removeTeamRepository(slug, deleteFiles, workspaceRoot)
 * - removeTeamRepository(workspaceRoot, { slug, deleteFiles })
 */
export function removeTeamRepository(arg1 = process.cwd(), arg2 = {}, arg3 = null) {
  let workspaceRoot = process.cwd();
  let slug = '';
  let deleteFiles = false;

  if (typeof arg1 === 'string' && typeof arg2 === 'object' && arg2 !== null) {
    workspaceRoot = arg1;
    slug = arg2.slug;
    deleteFiles = Boolean(arg2.deleteFiles || arg2.cleanDisk);
  } else if (typeof arg1 === 'string' && typeof arg2 === 'boolean') {
    slug = arg1;
    deleteFiles = arg2;
    if (typeof arg3 === 'string') workspaceRoot = arg3;
  } else if (typeof arg1 === 'string' && typeof arg2 === 'string') {
    workspaceRoot = arg1;
    slug = arg2;
    if (typeof arg3 === 'boolean') deleteFiles = arg3;
  }

  slug = String(slug || '').trim().toLowerCase();
  if (!slug) throw new Error('Slug is required');

  const paths = resolveStoragePaths(workspaceRoot);
  const settings = getSettings(paths.baseDir);

  const idx = settings.teamRepos.findIndex(r => r.slug === slug);
  if (idx === -1) {
    throw new Error(`Team repository with slug "${slug}" not found.`);
  }

  settings.teamRepos.splice(idx, 1);
  saveSettings(settings, paths.baseDir);

  if (deleteFiles) {
    const targetDir = path.join(paths.teamDir, slug);
    try {
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
    } catch {}
  }

  return {
    ok: true,
    success: true,
    slug,
    removed: true
  };
}

/**
 * Pulls latest changes from remote for specific or all active team repos.
 */
export function syncTeamRepositories(arg1 = process.cwd(), arg2 = {}) {
  let workspaceRoot = process.cwd();
  let options = {};

  if (typeof arg1 === 'string') {
    workspaceRoot = arg1;
    if (typeof arg2 === 'object' && arg2 !== null) options = arg2;
  } else if (typeof arg1 === 'object' && arg1 !== null) {
    options = arg1;
  }

  const targetSlug = options.slug ? String(options.slug).trim().toLowerCase() : null;
  const repos = getTeamRepositories(workspaceRoot);

  const syncResults = [];
  for (const repo of repos) {
    if (targetSlug && repo.slug !== targetSlug) continue;
    if (!repo.active || !repo.isGit || !repo.url) continue;

    try {
      execFileSync('git', ['pull', '--ff-only'], {
        cwd: repo.path,
        timeout: 8000,
        env: GIT_EXEC_ENV,
        stdio: ['ignore', 'ignore', 'ignore']
      });
      syncResults.push({ slug: repo.slug, status: 'success' });
    } catch (err) {
      syncResults.push({ slug: repo.slug, status: 'failed', error: err.message });
    }
  }

  return {
    ok: true,
    success: true,
    synced: syncResults
  };
}

/**
 * 3-Way Team Conflict & Divergence Auditor.
 * Audits active Team repositories against local Private overrides and detects diverged or stale rules.
 */
export function auditTeamConflicts(workspaceRoot = process.cwd()) {
  const paths = resolveStoragePaths(workspaceRoot);
  const conflicts = [];

  const privateFiles = findMarkdownFiles(paths.privateDir);
  const privateMap = new Map();

  for (const pf of privateFiles) {
    const base = path.basename(pf, '.md');
    if (base.toUpperCase() === 'README') continue;
    try {
      const raw = fs.readFileSync(pf, 'utf8');
      const parsed = parseYamlFrontmatter(raw);
      const slug = parsed.frontmatter.name || base;
      const data = {
        slug,
        filePath: pf,
        frontmatter: parsed.frontmatter,
        body: parsed.body,
        overrides: parsed.frontmatter.overrides || null
      };
      privateMap.set(slug.toLowerCase(), data);
      if (parsed.frontmatter.overrides) {
        const ovs = Array.isArray(parsed.frontmatter.overrides) ? parsed.frontmatter.overrides : [parsed.frontmatter.overrides];
        for (const ov of ovs) {
          privateMap.set(String(ov).toLowerCase(), data);
        }
      }
    } catch {}
  }

  const teamRepos = paths.activeTeamDirs && paths.activeTeamDirs.length > 0
    ? paths.activeTeamDirs
    : [{ slug: 'default', name: 'Default Team', dir: paths.teamDir }];

  for (const tRepo of teamRepos) {
    const teamFiles = findMarkdownFiles(tRepo.dir);
    for (const tf of teamFiles) {
      const base = path.basename(tf, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const raw = fs.readFileSync(tf, 'utf8');
        const parsed = parseYamlFrontmatter(raw);
        const slug = parsed.frontmatter.name || base;
        const slugKey = slug.toLowerCase();

        const privateMatch = privateMap.get(slugKey);
        if (privateMatch) {
          const teamBody = parsed.body.trim();
          const privBody = privateMatch.body.trim();
          const teamFm = parsed.frontmatter;
          const privFm = privateMatch.frontmatter;

          const isBodyIdentical = teamBody === privBody;
          const isTriggerIdentical = (teamFm.description || teamFm.trigger) === (privFm.description || privFm.trigger);

          if (!isBodyIdentical || !isTriggerIdentical) {
            let divergenceType = 'content_divergence';
            let recommendedResolution = 'keep_private';

            const teamVerified = Date.parse(teamFm.verified || '') || 0;
            const privVerified = Date.parse(privFm.verified || '') || 0;

            if (teamVerified > privVerified && (teamVerified - privVerified) > 14 * 24 * 3600 * 1000) {
              divergenceType = 'upstream_updated_ahead';
              recommendedResolution = 'adopt_team';
            } else if (privFm.overrides === slug) {
              divergenceType = 'intentional_private_override';
              recommendedResolution = 'keep_private';
            } else {
              divergenceType = 'diverged_edits';
              recommendedResolution = 'merge_both';
            }

            conflicts.push({
              slug,
              privateSlug: privateMatch.slug,
              teamSlug: tRepo.slug,
              teamRepoName: tRepo.name,
              teamPath: tf,
              privatePath: privateMatch.filePath,
              teamFrontmatter: teamFm,
              privateFrontmatter: privFm,
              divergenceType,
              recommendedResolution,
              diffSummary: {
                triggerChanged: !isTriggerIdentical,
                bodyLengthDelta: privBody.length - teamBody.length,
                teamVerified: teamFm.verified || 'unverified',
                privateVerified: privFm.verified || 'unverified'
              }
            });
          }
        }
      } catch {}
    }
  }

  return {
    workspace: workspaceRoot,
    conflictsCount: conflicts.length,
    status: conflicts.length === 0 ? 'SYNCHRONIZED' : 'CONFLICTS_DETECTED',
    conflicts
  };
}

/**
 * 3-Way Team Conflict Resolver.
 */
export function resolveTeamConflict(workspaceRoot = process.cwd(), options = {}) {
  const { slug, resolution, mergedContent, mergedFrontmatter } = options;
  if (!slug) throw new Error('slug is required to resolve conflict.');
  if (!['adopt_team', 'keep_private', 'merge_both'].includes(resolution)) {
    throw new Error(`Invalid resolution: '${resolution}'. Must be 'adopt_team', 'keep_private', or 'merge_both'.`);
  }

  const paths = resolveStoragePaths(workspaceRoot);
  const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
  let resolvedPrivateSlug = cleanSlug;
  let privateFile = path.join(paths.privateDir, `${cleanSlug}.md`);

  if (!fs.existsSync(privateFile) && options.privateSlug) {
    const cleanPriv = path.basename(options.privateSlug.trim()).replace(/\.md$/i, '');
    const altFile = path.join(paths.privateDir, `${cleanPriv}.md`);
    if (fs.existsSync(altFile)) {
      privateFile = altFile;
      resolvedPrivateSlug = cleanPriv;
    }
  }

  if (!fs.existsSync(privateFile) && options.privatePath && fs.existsSync(options.privatePath)) {
    privateFile = options.privatePath;
    resolvedPrivateSlug = path.basename(privateFile, '.md');
  }

  if (!fs.existsSync(privateFile)) {
    // Scan private directory for any entry overriding or matching cleanSlug
    const pFiles = findMarkdownFiles(paths.privateDir);
    for (const pf of pFiles) {
      try {
        const raw = fs.readFileSync(pf, 'utf8');
        const parsed = parseYamlFrontmatter(raw);
        const pSlug = parsed.frontmatter.name || path.basename(pf, '.md');
        if (pSlug.toLowerCase() === cleanSlug.toLowerCase()) {
          privateFile = pf;
          resolvedPrivateSlug = pSlug;
          break;
        }
        if (parsed.frontmatter.overrides) {
          const ovs = Array.isArray(parsed.frontmatter.overrides)
            ? parsed.frontmatter.overrides
            : String(parsed.frontmatter.overrides).split(',').map(s => s.trim());
          if (ovs.map(s => s.toLowerCase()).includes(cleanSlug.toLowerCase())) {
            privateFile = pf;
            resolvedPrivateSlug = pSlug;
            break;
          }
        }
      } catch {}
    }
  }

  if (!fs.existsSync(privateFile)) {
    throw new Error(`Private memory file not found: ${privateFile}`);
  }

  if (resolution === 'adopt_team') {
    fs.unlinkSync(privateFile);
    let cleanedReferences = 0;
    if (resolvedPrivateSlug.toLowerCase() !== cleanSlug.toLowerCase()) {
      cleanedReferences = cleanDanglingReferences(workspaceRoot, resolvedPrivateSlug);
    }
    return {
      ok: true,
      success: true,
      slug: cleanSlug,
      resolvedPrivateSlug,
      action: 'adopted_team_standard',
      removedPrivateFile: privateFile,
      cleanedReferences
    };
  }


  if (resolution === 'keep_private') {
    const raw = fs.readFileSync(privateFile, 'utf8');
    const parsed = parseYamlFrontmatter(raw);
    parsed.frontmatter.verified = new Date().toISOString().slice(0, 10);
    const updated = serializeYamlFrontmatter(parsed.frontmatter, parsed.body);
    atomicWriteFileSync(privateFile, updated, 'utf8');
    return {
      ok: true,
      success: true,
      slug: cleanSlug,
      action: 'kept_private_override',
      verified: parsed.frontmatter.verified
    };
  }

  if (resolution === 'merge_both') {
    if (!mergedContent) {
      throw new Error('mergedContent is required when resolution is "merge_both".');
    }
    const raw = fs.readFileSync(privateFile, 'utf8');
    const parsed = parseYamlFrontmatter(raw);
    let contentFm = {};
    let body = mergedContent;
    if (mergedContent.trimStart().startsWith('---')) {
      const parsedContent = parseYamlFrontmatter(mergedContent);
      contentFm = parsedContent.frontmatter || {};
      body = parsedContent.body || '';
    }

    const fm = {
      ...parsed.frontmatter,
      ...contentFm,
      ...(mergedFrontmatter || {}),
      verified: new Date().toISOString().slice(0, 10)
    };

    const serialized = serializeYamlFrontmatter(fm, body);
    atomicWriteFileSync(privateFile, serialized, 'utf8');
    return {
      ok: true,
      success: true,
      slug: cleanSlug,
      action: 'merged_both_versions',
      filePath: privateFile
    };
  }
}
