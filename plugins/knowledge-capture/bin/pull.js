#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { resolveStoragePaths, GIT_EXEC_ENV } from '../mcp-server/core/storage-paths.js';

/**
 * CLI Utility: Pull latest memory updates from Git upstream (Cross-platform, Multi-Team Support)
 */

export function validateSafeGitUrl(url) {
  if (url && String(url).trim().startsWith('-')) {
    throw new Error('Invalid repository URL: must not start with "-".');
  }
}

function detectDefaultBranch(repoDir) {
  try {
    const sym = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'], {
      cwd: repoDir,
      encoding: 'utf8',
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
    if (sym) return sym.replace(/^origin\//, '');
  } catch {}
  try {
    const branches = execFileSync('git', ['branch', '--list', 'main', 'master'], {
      cwd: repoDir,
      encoding: 'utf8',
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    if (branches.includes('master') && !branches.includes('main')) {
      return 'master';
    }
  } catch {}
  return 'main';
}

export function pullSingleRepo(repoDir, label, repoUrl) {
  console.log(`=== Pulling ${label} (${repoDir}) ===`);
  if (!repoUrl) {
    console.log(`Notice: Repository URL is not configured for ${label}.`);
    return 0;
  }
  const cleanUrl = String(repoUrl).trim();
  try {
    validateSafeGitUrl(cleanUrl);
  } catch (err) {
    console.error(`Error pulling ${label}: ${err.message}`);
    return 1;
  }

  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    console.log(`${label} clone not found. Initializing clone from ${cleanUrl}...`);
    try {
      fs.mkdirSync(path.dirname(repoDir), { recursive: true });
      execFileSync('git', ['clone', '--', cleanUrl, repoDir], { stdio: 'inherit', env: GIT_EXEC_ENV });
      console.log(`${label} cloned successfully.`);
      return 0;
    } catch (err) {
      console.error(`Error cloning ${label}: ${err.message}`);
      return 1;
    }
  }

  try {
    const dirtyRaw = execFileSync('git', ['status', '--porcelain', '-z'], {
      cwd: repoDir,
      encoding: 'utf8',
      env: GIT_EXEC_ENV
    });
    const dirtyEntries = dirtyRaw ? dirtyRaw.split('\0').filter(Boolean) : [];
    if (dirtyEntries.length > 0) {
      console.error(`Error: ${label} working copy has uncommitted changes. Stash or commit before pulling:`);
      console.error(dirtyEntries.join('\n'));
      return 1;
    }

    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: repoDir,
      encoding: 'utf8',
      env: GIT_EXEC_ENV
    }).trim() || detectDefaultBranch(repoDir);
    if (branch.startsWith('promote/') || branch.startsWith('adr/')) {
      const baseBranch = detectDefaultBranch(repoDir);
      console.warn(`Warning: ${label} is currently on a promotion branch: '${branch}'.`);
      console.warn(`Run 'git -C "${repoDir}" checkout ${baseBranch}' before pulling upstream updates.`);
      return 1;
    }

    try {
      execFileSync('git', ['branch', `--set-upstream-to=origin/${branch}`, branch], { cwd: repoDir, stdio: 'ignore', env: GIT_EXEC_ENV });
    } catch {}

    console.log(`Executing git pull --ff-only on branch '${branch}'...`);
    const out = execFileSync('git', ['pull', '--ff-only'], { cwd: repoDir, encoding: 'utf8', env: GIT_EXEC_ENV });
    console.log(out.trim());
    return 0;
  } catch (err) {
    console.error(`Error pulling ${label}: ${err.message}`);
    return 1;
  }
}

function main() {
  const workspaceRoot = process.cwd();
  const paths = resolveStoragePaths(workspaceRoot);
  const settings = paths.settings || {};

  const args = process.argv.slice(2);
  const target = args[0] || 'team'; // 'team', 'private', 'all', or specific team slug
  const specificSlug = target === 'team'
    ? (args[1] || null)
    : (target !== 'private' && target !== 'all' ? target : null);

  let exitCode = 0;

  const shouldPullTeam = target === 'team' || target === 'all' || Boolean(specificSlug);

  if (shouldPullTeam) {
    if (specificSlug) {
      const targets = (paths.activeTeamDirs || []).filter(t => t.slug.toLowerCase() === specificSlug.toLowerCase());
      if (targets.length === 0) {
        const inactiveRepo = (settings.teamRepos || []).find(r => r.slug.toLowerCase() === specificSlug.toLowerCase());
        if (inactiveRepo) {
          if (!/^[a-z0-9_-]+$/i.test(inactiveRepo.slug)) {
            console.error(`Error: Invalid team repository slug '${inactiveRepo.slug}'.`);
            exitCode = 1;
          } else {
            const resolvedTeamRoot = path.resolve(paths.teamDir);
            const inactiveDir = path.resolve(resolvedTeamRoot, inactiveRepo.slug);
            const rel = path.relative(resolvedTeamRoot, inactiveDir);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
              console.error(`Error: Team repository path '${inactiveDir}' escapes team directory.`);
              exitCode = 1;
            } else {
              console.log(`Notice: Team repository '${specificSlug}' is configured but currently inactive in settings. Pulling updates...`);
              const res = pullSingleRepo(inactiveDir, `Team Memory [${inactiveRepo.slug}]`, inactiveRepo.url);
              if (res !== 0) exitCode = res;
            }
          }
        } else {
          console.error(`Error: Team repository with slug '${specificSlug}' not found in settings.`);
          exitCode = 1;
        }
      } else {
        for (const tRepo of targets) {
          const res = pullSingleRepo(tRepo.dir, `Team Memory [${tRepo.slug}]`, tRepo.url);
          if (res !== 0) exitCode = res;
          console.log('');
        }
      }
    } else if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
      for (const tRepo of paths.activeTeamDirs) {
        const res = pullSingleRepo(tRepo.dir, `Team Memory [${tRepo.slug}]`, tRepo.url);
        if (res !== 0) exitCode = res;
        console.log('');
      }
    } else if (settings.teamRepoUrl) {
      const res = pullSingleRepo(paths.teamDir, 'Team Memory Layer', settings.teamRepoUrl);
      if (res !== 0) exitCode = res;
      console.log('');
    } else {
      console.log('=== Team Memory Layer ===\nNotice: Team memory repository URL is not configured in settings.json.\n');
    }
  }

  if (target === 'private' || target === 'all') {
    const res = pullSingleRepo(paths.privateDir, 'Private Memory Layer', settings?.privateRepoUrl);
    if (res !== 0) exitCode = res;
    console.log('');
  }

  process.exit(exitCode);
}

const isDirectCli = process.argv[1] && (
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
);

if (isDirectCli) {
  main();
}
