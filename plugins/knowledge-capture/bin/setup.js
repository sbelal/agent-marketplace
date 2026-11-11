#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { execSync } from 'node:child_process';

const GIT_EXEC_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=5'
};

/**
 * Setup & Initialization Utility for Knowledge Capture
 *
 * Supports:
 * 1. Headless CLI execution via --private-url and --team-url flags.
 * 2. Interactive step-by-step TUI wizard when run without flags in an interactive terminal.
 */

export function setupEnvironment(options = {}) {
  const home = os.homedir();
  const baseDir = path.join(home, '.gemini', 'knowledge-capture');
  const privateDir = path.join(baseDir, 'private');
  const teamDir = path.join(baseDir, 'team');
  const settingsPath = path.join(baseDir, 'settings.json');

  // Create directory structure
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
  }
  if (!fs.existsSync(privateDir)) {
    fs.mkdirSync(privateDir, { recursive: true });
  }
  if (!fs.existsSync(teamDir)) {
    fs.mkdirSync(teamDir, { recursive: true });
  }

  // Load or create settings.json
  let settings = {
    privateRepoUrl: '',
    teamRepoUrl: ''
  };

  if (fs.existsSync(settingsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings = { ...settings, ...existing };
    } catch {
      // Use defaults if corrupted
    }
  }

  if (options.privateRepoUrl !== undefined) {
    settings.privateRepoUrl = options.privateRepoUrl.trim();
  }
  if (options.teamRepoUrl !== undefined) {
    settings.teamRepoUrl = options.teamRepoUrl.trim();
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  // Helper to initialize or clone git repository cleanly
  function ensureRepoInitialized(targetDir, remoteUrl) {
    if (!remoteUrl) return;
    const gitDir = path.join(targetDir, '.git');
    if (fs.existsSync(gitDir)) {
      try {
        execSync(`git remote set-url origin "${remoteUrl}"`, { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
      } catch {
        try {
          execSync(`git remote add origin "${remoteUrl}"`, { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
        } catch {}
      }
      return;
    }

    let hasRemoteBranches = false;
    try {
      const lsOut = execSync(`git ls-remote --heads "${remoteUrl}"`, {
        encoding: 'utf8',
        timeout: 5000,
        env: GIT_EXEC_ENV,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      hasRemoteBranches = lsOut.length > 0;
    } catch {}

    if (hasRemoteBranches) {
      try {
        const hasExistingFiles = fs.existsSync(targetDir) && fs.readdirSync(targetDir).length > 0;
        if (hasExistingFiles) {
          execSync('git init -b main', { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          execSync(`git remote add origin "${remoteUrl}"`, { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          execSync('git fetch origin', { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          try {
            execSync('git branch --set-upstream-to=origin/main main', { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          } catch {}
        } else {
          fs.rmSync(targetDir, { recursive: true, force: true });
          execSync(`git clone "${remoteUrl}" "${targetDir}"`, { env: GIT_EXEC_ENV, stdio: 'ignore' });
        }
        return;
      } catch {}
    }

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      execSync('git init -b main', { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
      execSync(`git remote add origin "${remoteUrl}"`, { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
    } catch {}
  }

  // Initialize Private Git repository if configured
  if (settings.privateRepoUrl) {
    ensureRepoInitialized(privateDir, settings.privateRepoUrl);
  }

  // Initialize Team Git repository if configured
  if (settings.teamRepoUrl) {
    ensureRepoInitialized(teamDir, settings.teamRepoUrl);
  }

  return {
    baseDir,
    privateDir,
    teamDir,
    settingsPath,
    settings
  };
}

export function testRemoteConnectivity(url) {
  if (!url || typeof url !== 'string' || !url.trim()) {
    return { ok: false, error: 'Empty URL' };
  }
  try {
    execSync(`git ls-remote "${url.trim()}" HEAD`, {
      encoding: 'utf8',
      timeout: 5000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.stderr?.trim() || err.message };
  }
}

function promptQuestion(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function runInteractiveWizard() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('\n\x1b[36m============================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m       🧠 Knowledge Capture Setup & Initialization Wizard   \x1b[0m');
  console.log('\x1b[36m============================================================\x1b[0m');
  console.log('Configure your persistent memory storage and optional Git remotes.\n');

  const options = {
    privateRepoUrl: '',
    teamRepoUrl: ''
  };

  // Step 1: Private Memory
  console.log('\x1b[1m\x1b[34m[Step 1/2] Private Memory Layer (Personal Engineering Learnings)\x1b[0m');
  console.log('Where should personal preferences, patterns, and gotchas be stored?');
  console.log('  \x1b[32m[1] GitHub Private Repository (Recommended)\x1b[0m');
  console.log('      Syncs memories across your laptops and Antigravity remote agents.');
  console.log('  \x1b[90m[2] Local Machine Only (No remote sync)\x1b[0m');
  console.log('      Keeps memories strictly on this machine in ~/.gemini/knowledge-capture/private/');

  const privChoice = (await promptQuestion(rl, '\nSelect option [1-2] (default: 1): ')).trim() || '1';

  if (privChoice === '1') {
    console.log('\nEnter your Private Git Repository URL:');
    console.log('  \x1b[90mExamples:\x1b[0m');
    console.log('    SSH:   git@github.com:your-username/my-knowledge-memory.git');
    console.log('    HTTPS: https://github.com/your-username/my-knowledge-memory.git');

    while (true) {
      const url = (await promptQuestion(rl, '> ')).trim();
      if (!url) {
        console.log('\x1b[33mNo URL entered. Defaulting to Local Machine Only.\x1b[0m');
        break;
      }

      process.stdout.write('  Validating repository connectivity... ');
      const test = testRemoteConnectivity(url);
      if (test.ok) {
        console.log('\x1b[32m[SUCCESS]\x1b[0m');
        options.privateRepoUrl = url;
        break;
      } else {
        console.log('\x1b[31m[FAILED]\x1b[0m');
        console.log(`  \x1b[31mCould not reach repository: ${test.error}\x1b[0m`);
        console.log('  Please verify SSH keys / personal access token.');
        const retry = (await promptQuestion(rl, '  Retry entering URL? (y/n, default: y): ')).trim().toLowerCase();
        if (retry === 'n') {
          console.log('\x1b[33mContinuing with Local Machine Only.\x1b[0m');
          break;
        }
      }
    }
  } else {
    console.log('\x1b[90mPrivate memory configured for local storage only.\x1b[0m');
  }

  // Step 2: Team Memory
  console.log('\n\x1b[1m\x1b[34m[Step 2/2] Team Memory Layer (Shared Standards & Conventions)\x1b[0m');
  console.log('Do you have a shared repository for organization-wide engineering rules?');
  console.log('  \x1b[32m[1] Team Shared Git Repository\x1b[0m');
  console.log('      Pulls shared team standards and enables /kc-promote Pull Requests.');
  console.log('  \x1b[90m[2] Skip / Local-Only (Default)\x1b[0m');

  const teamChoice = (await promptQuestion(rl, '\nSelect option [1-2] (default: 2): ')).trim() || '2';

  if (teamChoice === '1') {
    console.log('\nEnter your Team Git Repository URL:');
    console.log('  \x1b[90mExample: git@github.com:your-org/shared-team-memory.git\x1b[0m');

    while (true) {
      const url = (await promptQuestion(rl, '> ')).trim();
      if (!url) {
        console.log('\x1b[33mNo URL entered. Skipping team repository configuration.\x1b[0m');
        break;
      }

      process.stdout.write('  Validating repository connectivity... ');
      const test = testRemoteConnectivity(url);
      if (test.ok) {
        console.log('\x1b[32m[SUCCESS]\x1b[0m');
        options.teamRepoUrl = url;
        break;
      } else {
        console.log('\x1b[31m[FAILED]\x1b[0m');
        console.log(`  \x1b[31mCould not reach repository: ${test.error}\x1b[0m`);
        const retry = (await promptQuestion(rl, '  Retry entering URL? (y/n, default: y): ')).trim().toLowerCase();
        if (retry === 'n') {
          console.log('\x1b[33mSkipping team repository configuration.\x1b[0m');
          break;
        }
      }
    }
  } else {
    console.log('\x1b[90mTeam memory skipped / unconfigured.\x1b[0m');
  }

  rl.close();

  // Execute persistence
  console.log('\n\x1b[36mPersisting configuration and scaffolding directories...\x1b[0m');
  const res = setupEnvironment(options);

  console.log(`\x1b[32m✔ Storage directories scaffolded:\x1b[0m`);
  console.log(`    Private: ${res.privateDir}`);
  console.log(`    Team:    ${res.teamDir}`);
  console.log(`\x1b[32m✔ Settings written to:\x1b[0m ${res.settingsPath}`);

  if (options.teamRepoUrl) {
    console.log('\n\x1b[36mPerforming initial Team memory clone/pull...\x1b[0m');
    try {
      execSync(`git clone "${options.teamRepoUrl}" "${res.teamDir}"`, {
        env: GIT_EXEC_ENV,
        stdio: 'inherit'
      });
      console.log('\x1b[32m✔ Team memory cloned successfully.\x1b[0m');
    } catch {
      console.log('\x1b[33mNotice: Initial clone will be retried on next session start or via /kc-pull.\x1b[0m');
    }
  }

  console.log('\n\x1b[1m\x1b[32m🎉 Knowledge Capture Initialization Complete!\x1b[0m');
  console.log('Commands to remember:');
  console.log('  • \x1b[36m/kc-status\x1b[0m   - Inspect memory layers, entry counts, and Git sync health');
  console.log('  • \x1b[36m/kc-commit\x1b[0m   - Review and push private memory updates to your remote');
  console.log('  • \x1b[36m/kc-recall\x1b[0m   - Consult persistent memory before complex tasks');
  console.log('  • \x1b[36m/kc-capture\x1b[0m  - Record reusable learnings at the end of a session\n');
}

// Entrypoint
const args = process.argv.slice(2);
const options = {};
let hasFlags = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--private-url' && args[i + 1]) {
    options.privateRepoUrl = args[++i];
    hasFlags = true;
  } else if (args[i] === '--team-url' && args[i + 1]) {
    options.teamRepoUrl = args[++i];
    hasFlags = true;
  }
}

if (hasFlags) {
  // Headless mode
  const result = setupEnvironment(options);
  console.log(JSON.stringify(result, null, 2));
} else if (process.stdin.isTTY) {
  // Interactive TUI mode
  runInteractiveWizard().catch((err) => {
    console.error(`\x1b[31mSetup failed: ${err.message}\x1b[0m`);
    process.exit(1);
  });
} else {
  // Non-interactive fallback without flags (e.g. piped or automated script)
  const result = setupEnvironment({});
  console.log(JSON.stringify(result, null, 2));
}
