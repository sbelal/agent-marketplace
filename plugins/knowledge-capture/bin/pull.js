#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * CLI Utility: Pull latest memory updates from Git upstream (Cross-platform)
 */

function main() {
  const home = os.homedir();
  const baseDir = path.join(home, '.gemini', 'knowledge-capture');
  const teamDir = path.join(baseDir, 'team');
  const privateDir = path.join(baseDir, 'private');
  const settingsPath = path.join(baseDir, 'settings.json');

  let settings = {};
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // Ignore
    }
  }

  const args = process.argv.slice(2);
  const target = args[0] || 'team'; // 'team', 'private', or 'all'

  let exitCode = 0;

  if (target === 'team' || target === 'all') {
    console.log(`=== Pulling Team Memory Layer (${teamDir}) ===`);
    if (!settings.teamRepoUrl) {
      console.log('Notice: Team memory repository URL is not configured in settings.json.');
    } else if (!fs.existsSync(path.join(teamDir, '.git'))) {
      console.log(`Team clone not found. Initializing clone from ${settings.teamRepoUrl}...`);
      try {
        fs.mkdirSync(path.dirname(teamDir), { recursive: true });
        execSync(`git clone "${settings.teamRepoUrl}" "${teamDir}"`, { stdio: 'inherit' });
        console.log('Team memory cloned successfully.');
      } catch (err) {
        console.error(`Error cloning team repository: ${err.message}`);
        exitCode = 1;
      }
    } else {
      // Check for uncommitted changes
      try {
        const dirty = execSync('git status --porcelain', { cwd: teamDir, encoding: 'utf8' }).trim();
        if (dirty) {
          console.error('Error: Team working copy has uncommitted changes. Stash or commit before pulling:');
          console.error(dirty);
          exitCode = 1;
        } else {
          const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: teamDir, encoding: 'utf8' }).trim();
          if (branch.startsWith('promote/')) {
            console.warn(`Warning: Team clone is currently on a promotion branch: '${branch}'.`);
            console.warn(`Run 'git -C "${teamDir}" checkout main' before pulling upstream updates.`);
            exitCode = 1;
          } else {
            try {
              execSync(`git branch --set-upstream-to=origin/${branch} "${branch}"`, { cwd: teamDir, stdio: 'ignore' });
            } catch {}
            console.log(`Executing git pull --ff-only on branch '${branch}'...`);
            const out = execSync('git pull --ff-only', { cwd: teamDir, encoding: 'utf8' });
            console.log(out.trim());
          }
        }
      } catch (err) {
        console.error(`Error pulling team memory: ${err.message}`);
        exitCode = 1;
      }
    }
    console.log('');
  }

  if (target === 'private' || target === 'all') {
    console.log(`=== Pulling Private Memory Layer (${privateDir}) ===`);
    if (!settings.privateRepoUrl) {
      console.log('Notice: Private memory repository URL is not configured in settings.json.');
    } else if (!fs.existsSync(path.join(privateDir, '.git'))) {
      console.log(`Private clone not found. Initializing clone from ${settings.privateRepoUrl}...`);
      try {
        fs.mkdirSync(path.dirname(privateDir), { recursive: true });
        execSync(`git clone "${settings.privateRepoUrl}" "${privateDir}"`, { stdio: 'inherit' });
        console.log('Private memory cloned successfully.');
      } catch (err) {
        console.error(`Error cloning private repository: ${err.message}`);
        exitCode = 1;
      }
    } else {
      try {
        const dirty = execSync('git status --porcelain', { cwd: privateDir, encoding: 'utf8' }).trim();
        if (dirty) {
          console.error('Error: Private working copy has uncommitted changes. Run /kc-commit before pulling.');
          exitCode = 1;
        } else {
          try {
            const privBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: privateDir, encoding: 'utf8' }).trim() || 'main';
            execSync(`git branch --set-upstream-to=origin/${privBranch} "${privBranch}"`, { cwd: privateDir, stdio: 'ignore' });
          } catch {}
          console.log('Executing git pull --ff-only...');
          const out = execSync('git pull --ff-only', { cwd: privateDir, encoding: 'utf8' });
          console.log(out.trim());
        }
      } catch (err) {
        console.error(`Error pulling private memory: ${err.message}`);
        exitCode = 1;
      }
    }
  }

  process.exit(exitCode);
}

main();
