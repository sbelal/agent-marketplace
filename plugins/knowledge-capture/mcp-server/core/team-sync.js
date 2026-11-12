import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { resolveStoragePaths, getStorageDir, getSettings, deriveTeamRepoSlug } from './storage-paths.js';

export { deriveTeamRepoSlug };

const GIT_EXEC_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=3'
};

function saveSettings(settings, storageDir = getStorageDir()) {
  const p = path.join(storageDir, 'settings.json');
  fs.writeFileSync(p, JSON.stringify(settings, null, 2), 'utf8');
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
        const status = execSync('git status --porcelain', {
          cwd: repoDir,
          encoding: 'utf8',
          timeout: 2000,
          env: GIT_EXEC_ENV,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (status) {
          isClean = false;
          uncommittedCount = status.split('\n').filter(Boolean).length;
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

  const paths = resolveStoragePaths(workspaceRoot);
  const settings = getSettings(paths.baseDir);
  const teamBaseDir = paths.teamDir;
  const targetDir = path.join(teamBaseDir, rawSlug);

  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const url = (options.url || '').trim();
  const name = options.name || rawSlug;
  const active = options.active !== false;

  // Clone or init git if url provided
  if (url) {
    const gitDir = path.join(targetDir, '.git');
    if (!fs.existsSync(gitDir)) {
      try {
        execSync(`git clone "${url}" .`, {
          cwd: targetDir,
          timeout: 15000,
          env: GIT_EXEC_ENV,
          stdio: ['ignore', 'ignore', 'ignore']
        });
      } catch {
        // Fallback: init empty repo with remote
        try {
          execSync('git init', { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          execSync(`git remote add origin "${url}"`, { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
        } catch {}
      }
    } else {
      try {
        execSync(`git remote set-url origin "${url}"`, { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
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
      execSync('git pull --ff-only', {
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
