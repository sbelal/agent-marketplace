#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * Setup & Initialization Utility for Knowledge Capture
 */

function setupEnvironment(options = {}) {
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

  // Initialize Git repositories if configured and missing .git
  if (settings.privateRepoUrl && !fs.existsSync(path.join(privateDir, '.git'))) {
    try {
      execSync('git init -b main', { cwd: privateDir, stdio: 'ignore' });
      execSync(`git remote add origin "${settings.privateRepoUrl}"`, { cwd: privateDir, stdio: 'ignore' });
    } catch {
      // Suppress git init errors
    }
  }

  if (settings.teamRepoUrl && !fs.existsSync(path.join(teamDir, '.git'))) {
    try {
      execSync('git init -b main', { cwd: teamDir, stdio: 'ignore' });
      execSync(`git remote add origin "${settings.teamRepoUrl}"`, { cwd: teamDir, stdio: 'ignore' });
    } catch {
      // Suppress git init errors
    }
  }

  return {
    baseDir,
    privateDir,
    teamDir,
    settingsPath,
    settings
  };
}

// Parse CLI flags if invoked from command line
const args = process.argv.slice(2);
const options = {};

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--private-url' && args[i + 1]) {
    options.privateRepoUrl = args[++i];
  } else if (args[i] === '--team-url' && args[i + 1]) {
    options.teamRepoUrl = args[++i];
  }
}

const result = setupEnvironment(options);
console.log(JSON.stringify(result, null, 2));
