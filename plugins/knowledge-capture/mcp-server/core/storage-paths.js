import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const GIT_EXEC_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=3'
};

/**
 * Returns user home directory with multi-platform environment support.
 */
export function getHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

/**
 * Resolves the root directory for Knowledge Capture data.
 */
export function getStorageDir() {
  if (process.env.KC_STORAGE_DIR) {
    return process.env.KC_STORAGE_DIR;
  }
  if (process.env.GEMINI_HOME) {
    return path.join(process.env.GEMINI_HOME, 'knowledge-capture');
  }
  return path.join(getHomeDir(), '.gemini', 'knowledge-capture');
}

/**
 * Resolves path to SQLite database.
 */
export function getDbPath() {
  return path.join(getStorageDir(), 'cache.sqlite');
}

/**
 * Resolves path to JSON telemetry file (used if SQLite is unavailable).
 */
export function getTelemetryJsonPath() {
  return path.join(getStorageDir(), 'telemetry.json');
}

/**
 * Normalizes a workspace directory into a stable partition key.
 */
export function normalizeWorkspaceId(workspaceRoot = process.cwd()) {
  try {
    return path.resolve(workspaceRoot).replace(/\\/g, '/').toLowerCase();
  } catch {
    return 'default';
  }
}

/**
 * Reads settings.json safely.
 */
export function getSettings(storageDir = getStorageDir()) {
  const settingsPath = path.join(storageDir, 'settings.json');
  if (!fs.existsSync(settingsPath)) {
    return {
      privateRepoUrl: '',
      teamRepoUrl: '',
      embeddingEngine: '',
      teamRepos: []
    };
  }
  try {
    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw);
    const settings = {
      privateRepoUrl: parsed.privateRepoUrl || '',
      teamRepoUrl: parsed.teamRepoUrl || '',
      embeddingEngine: parsed.embeddingEngine || '',
      teamRepos: Array.isArray(parsed.teamRepos) ? parsed.teamRepos : []
    };
    // Backward compatibility: If teamRepoUrl exists and teamRepos is empty, wrap it
    if (settings.teamRepoUrl && settings.teamRepos.length === 0) {
      settings.teamRepos.push({
        slug: 'default',
        url: settings.teamRepoUrl,
        active: true,
        name: 'Default Team Memory'
      });
    }
    return settings;
  } catch {
    return {
      privateRepoUrl: '',
      teamRepoUrl: '',
      embeddingEngine: '',
      teamRepos: []
    };
  }
}

/**
 * Auto-derives a unique team repository slug in the format <org_id>-<repo_slug> or <account_id>-<repo_slug>.
 * E.g., 'git@github.com:acme-corp/platform-rules.git' -> 'acme-corp-platform-rules'
 *       'https://github.com/my-org/backend-memory' -> 'my-org-backend-memory'
 */
export function deriveTeamRepoSlug(url) {
  if (!url || typeof url !== 'string') return 'team-repo';
  const clean = url.trim().replace(/\.git$/i, '').replace(/\/+$/, '');

  // Handle scp-like syntax: git@github.com:org/repo or URL path
  const scpMatch = clean.match(/[:/]([^/:]+)\/([^/:]+)$/);
  if (scpMatch) {
    const org = scpMatch[1].replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const repo = scpMatch[2].replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    return `${org}-${repo}`.replace(/--+/g, '-').replace(/^-|-$/g, '');
  }

  const parts = clean.split(/[/:\\\\]/).filter(Boolean);
  if (parts.length >= 2) {
    const org = parts[parts.length - 2].replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    const repo = parts[parts.length - 1].replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    return `${org}-${repo}`.replace(/--+/g, '-').replace(/^-|-$/g, '');
  }

  return clean.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase() || 'team-repo';
}

/**
 * Resolves storage directories for workspace, private, and all team repositories.
 */
export function resolveStoragePaths(workspaceRoot = process.cwd()) {
  const baseDir = getStorageDir();
  const settings = getSettings(baseDir);

  const teamBaseDir = path.join(baseDir, 'team');
  const activeTeamDirs = [];

  // 1. Scan configured teamRepos
  if (Array.isArray(settings.teamRepos) && settings.teamRepos.length > 0) {
    for (const repo of settings.teamRepos) {
      if (repo && repo.slug && repo.active !== false) {
        activeTeamDirs.push({
          slug: repo.slug,
          name: repo.name || repo.slug,
          dir: path.join(teamBaseDir, repo.slug),
          url: repo.url || ''
        });
      }
    }
  }

  // 2. Fallback / legacy support: ONLY if teamRepos is unconfigured or empty, AND flat teamDir exists
  if (activeTeamDirs.length === 0 && (!settings.teamRepos || settings.teamRepos.length === 0)) {
    activeTeamDirs.push({
      slug: 'default',
      name: 'Default Team Memory',
      dir: teamBaseDir,
      url: settings.teamRepoUrl || ''
    });
  }

  return {
    baseDir,
    settingsPath: path.join(baseDir, 'settings.json'),
    privateDir: path.join(baseDir, 'private'),
    teamDir: teamBaseDir,
    activeTeamDirs,
    workspaceDir: path.join(workspaceRoot, '.agents', 'rules', 'memory'),
    settings
  };
}
