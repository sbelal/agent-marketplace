#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

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

import { deriveTeamRepoSlug, getStorageDir } from '../mcp-server/core/storage-paths.js';

export { deriveTeamRepoSlug };

export function setupEnvironment(options = {}) {
  const baseDir = getStorageDir();
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
    teamRepoUrl: '',
    embeddingEngine: 'onnx',
    teamRepos: []
  };

  if (fs.existsSync(settingsPath)) {
    try {
      const existing = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      settings = { ...settings, ...existing };
      if (!Array.isArray(settings.teamRepos)) {
        settings.teamRepos = [];
      }
    } catch {
      // Use defaults if corrupted
    }
  }

  function validateSafeGitUrl(url) {
    if (url && String(url).trim().startsWith('-')) {
      throw new Error('Invalid repository URL: must not start with "-".');
    }
  }

  function assertSafeSlug(slug) {
    const clean = String(slug || '').trim();
    if (!clean || !/^[a-z0-9_-]+$/i.test(clean)) {
      throw new Error(`Invalid team repository slug "${slug}". Only alphanumeric, "-", and "_" characters are permitted.`);
    }
    return clean;
  }

  if (options.privateRepoUrl !== undefined) {
    const cleanPriv = options.privateRepoUrl.trim();
    validateSafeGitUrl(cleanPriv);
    settings.privateRepoUrl = cleanPriv;
  }
  if (options.teamRepoUrl !== undefined) {
    const cleanTeam = options.teamRepoUrl.trim();
    validateSafeGitUrl(cleanTeam);
    settings.teamRepoUrl = cleanTeam;
  }
  if (options.embeddingEngine !== undefined) {
    settings.embeddingEngine = options.embeddingEngine.toLowerCase().trim() === 'heuristic' ? 'heuristic' : 'onnx';
  }

  // Multi-Team Repositories by Slug (Explicit or Auto-Derived from URL)
  const teamUrl = (options.teamRepoUrl || options.teamUrl || '').trim();
  if (teamUrl) {
    validateSafeGitUrl(teamUrl);
    const slug = options.teamRepoSlug ? assertSafeSlug(options.teamRepoSlug) : deriveTeamRepoSlug(teamUrl);
    const existingIdx = settings.teamRepos.findIndex(r => r.slug === slug);
    if (existingIdx >= 0) {
      settings.teamRepos[existingIdx].url = teamUrl;
      settings.teamRepos[existingIdx].active = true;
      if (options.teamRepoName) settings.teamRepos[existingIdx].name = options.teamRepoName;
    } else {
      settings.teamRepos.push({
        slug,
        url: teamUrl,
        active: true,
        name: options.teamRepoName || slug
      });
    }
    if (!settings.teamRepoUrl || slug === 'default') {
      settings.teamRepoUrl = teamUrl;
    }
  }

  if (options.activateTeamSlug) {
    const slug = options.activateTeamSlug.trim();
    const r = settings.teamRepos.find(item => item.slug === slug);
    if (r) r.active = true;
  }

  if (options.deactivateTeamSlug) {
    const slug = options.deactivateTeamSlug.trim();
    const r = settings.teamRepos.find(item => item.slug === slug);
    if (r) r.active = false;
  }

  if (options.removeTeamSlug) {
    const slug = options.removeTeamSlug.trim();
    const removed = settings.teamRepos.find(item => item.slug === slug);
    settings.teamRepos = settings.teamRepos.filter(item => item.slug !== slug);
    if (
      slug === 'default' ||
      removed?._legacyRoot ||
      (settings.teamRepos.length === 0 && settings.teamRepoUrl && (!removed || removed.url === settings.teamRepoUrl))
    ) {
      settings.teamRepoUrl = '';
    }
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');

  // If ONNX engine chosen and installation requested, ensure @xenova/transformers is ready
  if (settings.embeddingEngine === 'onnx' && options.installDependencies !== false) {
    try {
      const currentDir = path.dirname(fileURLToPath(import.meta.url));
      const mcpServerDir = path.resolve(currentDir, '..', 'mcp-server');
      const nodeModulesDir = path.join(mcpServerDir, 'node_modules', '@xenova', 'transformers');
      if (!fs.existsSync(nodeModulesDir)) {
        if (!options.silent) {
          console.log('\n\x1b[36mInstalling @xenova/transformers in MCP server for Local ONNX...\x1b[0m');
        }
        execFileSync('npm', ['install', '--no-audit', '--no-fund', '@xenova/transformers'], {
          cwd: mcpServerDir,
          stdio: options.silent ? 'ignore' : 'inherit'
        });
      }
    } catch (err) {
      if (!options.silent) {
        console.warn(`\x1b[33mNotice: Could not automatically install @xenova/transformers: ${err.message}\x1b[0m`);
        console.warn('\x1b[33mKnowledge Capture will use the fast Heuristic Vector Engine fallback.\x1b[0m');
      }
    }
  }

  // Helper to initialize or clone git repository cleanly
  function ensureRepoInitialized(targetDir, remoteUrl) {
    if (!remoteUrl) return;
    const cleanUrl = String(remoteUrl).trim();
    validateSafeGitUrl(cleanUrl);
    const gitDir = path.join(targetDir, '.git');
    if (fs.existsSync(gitDir)) {
      try {
        execFileSync('git', ['remote', 'set-url', '--', 'origin', cleanUrl], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
      } catch {
        try {
          execFileSync('git', ['remote', 'add', '--', 'origin', cleanUrl], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
        } catch {}
      }
      return;
    }

    let hasRemoteBranches = false;
    try {
      const lsOut = execFileSync('git', ['ls-remote', '--heads', '--', cleanUrl], {
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
          execFileSync('git', ['init', '-b', 'main'], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          execFileSync('git', ['remote', 'add', '--', 'origin', cleanUrl], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          execFileSync('git', ['fetch', 'origin'], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          try {
            execFileSync('git', ['branch', '--set-upstream-to=origin/main', 'main'], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
          } catch {}
        } else {
          fs.rmSync(targetDir, { recursive: true, force: true });
          execFileSync('git', ['clone', '--', cleanUrl, targetDir], { env: GIT_EXEC_ENV, stdio: 'ignore' });
        }
        return;
      } catch {}
    }

    try {
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      execFileSync('git', ['init', '-b', 'main'], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
      execFileSync('git', ['remote', 'add', '--', 'origin', cleanUrl], { cwd: targetDir, env: GIT_EXEC_ENV, stdio: 'ignore' });
    } catch {}
  }

  // Initialize Private Git repository if configured
  if (settings.privateRepoUrl) {
    ensureRepoInitialized(privateDir, settings.privateRepoUrl);
  }

  // Initialize Team Git repositories if configured
  if (Array.isArray(settings.teamRepos) && settings.teamRepos.length > 0) {
    for (const repo of settings.teamRepos) {
      if (repo && repo.slug && repo.url && repo.active !== false) {
        const safeSlug = assertSafeSlug(repo.slug);
        const resolvedTeamRoot = path.resolve(teamDir);
        const repoTargetDir = path.resolve(resolvedTeamRoot, safeSlug);
        const rel = path.relative(resolvedTeamRoot, repoTargetDir);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
          ensureRepoInitialized(repoTargetDir, repo.url);
        }
      }
    }
  } else if (settings.teamRepoUrl) {
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
  const cleanUrl = url.trim();
  if (cleanUrl.startsWith('-')) {
    return { ok: false, error: 'Invalid repository URL: must not start with "-".' };
  }
  try {
    execFileSync('git', ['ls-remote', '--', cleanUrl, 'HEAD'], {
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
  console.log('\n\x1b[1m\x1b[34m[Step 2/3] Team Memory Layer (Shared Standards & Conventions)\x1b[0m');
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

  // Step 3: Semantic Embedding Engine
  console.log('\n\x1b[1m\x1b[34m[Step 3/3] Semantic Embedding Engine\x1b[0m');
  console.log('Choose how Knowledge Capture indexes and searches memories:');
  console.log('  \x1b[32m[1] Local ONNX Transformer (all-MiniLM-L6-v2) (Recommended)\x1b[0m');
  console.log('      True semantic search & synonym matching (100% local CPU inference, 384-d).');
  console.log('  \x1b[90m[2] Heuristic Vector Engine (Built-in)\x1b[0m');
  console.log('      Subword n-gram & bigram hash. Zero downloads, zero dependencies (128-d).');

  const engineChoice = (await promptQuestion(rl, '\nSelect option [1-2] (default: 1): ')).trim() || '1';
  options.embeddingEngine = (engineChoice === '2') ? 'heuristic' : 'onnx';
  if (options.embeddingEngine === 'onnx') {
    console.log('\x1b[32mSelected Local ONNX Transformer (all-MiniLM-L6-v2).\x1b[0m');
  } else {
    console.log('\x1b[90mSelected Heuristic Vector Engine.\x1b[0m');
  }

  rl.close();

  // Execute persistence
  console.log('\n\x1b[36mPersisting configuration and scaffolding directories...\x1b[0m');
  const res = setupEnvironment(options);

  console.log(`\x1b[32m✔ Storage directories scaffolded:\x1b[0m`);
  console.log(`    Private: ${res.privateDir}`);
  console.log(`    Team:    ${res.teamDir}`);
  console.log(`\x1b[32m✔ Settings written to:\x1b[0m ${res.settingsPath}`);
  console.log(`\x1b[32m✔ Embedding Engine:\x1b[0m ${res.settings.embeddingEngine}`);

  console.log('\n\x1b[1m\x1b[32m🎉 Knowledge Capture Initialization Complete!\x1b[0m');
  console.log('Commands to remember:');
  console.log('  • \x1b[36m/kc-status\x1b[0m   - Inspect memory layers, entry counts, and Git sync health');
  console.log('  • \x1b[36m/kc-commit\x1b[0m   - Review and push private memory updates to your remote');
  console.log('  • \x1b[36m/kc-recall\x1b[0m   - Consult persistent memory before complex tasks');
  console.log('  • \x1b[36m/kc-elicit\x1b[0m   - Elicit and record reusable learnings at the end of a session\n');
}

function runSetupCli() {
  const args = process.argv.slice(2);
  const options = {};
  let hasFlags = false;
  let parseError = null;

  const valueFlags = new Map([
    ['--private-url', 'privateRepoUrl'],
    ['--team-url', 'teamRepoUrl'],
    ['--embedding-engine', 'embeddingEngine'],
    ['--team-repo-slug', 'teamRepoSlug'],
    ['--team-repo-url', 'teamRepoUrl'],
    ['--activate-team', 'activateTeamSlug'],
    ['--deactivate-team', 'deactivateTeamSlug'],
    ['--remove-team', 'removeTeamSlug']
  ]);

  try {
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--no-install') {
        options.installDependencies = false;
        hasFlags = true;
        continue;
      }

      const eqIdx = arg.indexOf('=');
      const flagName = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
      const optionKey = valueFlags.get(flagName);
      if (optionKey) {
        if (eqIdx !== -1) {
          options[optionKey] = arg.slice(eqIdx + 1);
        } else {
          if (i + 1 >= args.length) {
            throw new Error(`Missing value for flag ${flagName}`);
          }
          options[optionKey] = args[++i];
        }
        hasFlags = true;
      }
    }
  } catch (err) {
    parseError = err;
  }

  try {
    if (parseError) {
      throw parseError;
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
  } catch (err) {
    console.error(`\x1b[31mSetup failed: ${err.message}\x1b[0m`);
    process.exit(1);
  }
}

const isDirectCli = process.argv[1] && (
  fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))
);

if (isDirectCli) {
  runSetupCli();
}
