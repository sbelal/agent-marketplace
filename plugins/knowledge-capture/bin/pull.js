#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveStoragePaths, GIT_EXEC_ENV } from '../mcp-server/core/storage-paths.js';

/**
 * CLI Utility: Pull latest memory updates from Git upstream (Cross-platform, Multi-Team Support)
 */

function pullSingleRepo(repoDir, label, repoUrl) {
  console.log(`=== Pulling ${label} (${repoDir}) ===`);
  if (!repoUrl) {
    console.log(`Notice: Repository URL is not configured for ${label}.`);
    return 0;
  }
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    console.log(`${label} clone not found. Initializing clone from ${repoUrl}...`);
    try {
      fs.mkdirSync(path.dirname(repoDir), { recursive: true });
      execFileSync('git', ['clone', repoUrl, repoDir], { stdio: 'inherit', env: GIT_EXEC_ENV });
      console.log(`${label} cloned successfully.`);
      return 0;
    } catch (err) {
      console.error(`Error cloning ${label}: ${err.message}`);
      return 1;
    }
  }

  try {
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: repoDir, encoding: 'utf8', env: GIT_EXEC_ENV }).trim();
    if (dirty) {
      console.error(`Error: ${label} working copy has uncommitted changes. Stash or commit before pulling:`);
      console.error(dirty);
      return 1;
    }

    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoDir, encoding: 'utf8', env: GIT_EXEC_ENV }).trim() || 'main';
    if (branch.startsWith('promote/')) {
      console.warn(`Warning: ${label} is currently on a promotion branch: '${branch}'.`);
      console.warn(`Run 'git -C "${repoDir}" checkout main' before pulling upstream updates.`);
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
  const settings = paths.settings;

  const args = process.argv.slice(2);
  const target = args[0] || 'team'; // 'team', 'private', 'all', or specific team slug
  const specificSlug = args[1] || (target !== 'team' && target !== 'private' && target !== 'all' ? target : null);

  let exitCode = 0;

  const shouldPullTeam = target === 'team' || target === 'all' || (specificSlug && paths.activeTeamDirs.some(t => t.slug === specificSlug));

  if (shouldPullTeam) {
    if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
      const targets = specificSlug 
        ? paths.activeTeamDirs.filter(t => t.slug === specificSlug)
        : paths.activeTeamDirs;

      if (targets.length === 0 && specificSlug) {
        console.error(`Error: Team repository with slug '${specificSlug}' not found in settings.`);
        exitCode = 1;
      } else {
        for (const tRepo of targets) {
          const res = pullSingleRepo(tRepo.dir, `Team Memory [${tRepo.slug}]`, tRepo.url);
          if (res !== 0) exitCode = res;
          console.log('');
        }
      }
    } else if (settings?.teamRepoUrl) {
      const res = pullSingleRepo(paths.teamDir, 'Team Memory Layer', settings.teamRepoUrl);
      if (res !== 0) exitCode = res;
      console.log('');
    } else {
      console.log('=== Team Memory Layer ===\nNotice: Team memory repository URL is not configured in settings.json.\n');
    }
  }

  if (target === 'private' || target === 'all') {
    const res = pullSingleRepo(paths.privateDir, 'Private Memory Layer', settings.privateRepoUrl);
    if (res !== 0) exitCode = res;
    console.log('');
  }

  process.exit(exitCode);
}

main();
