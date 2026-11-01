#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

/**
 * SessionStart Lifecycle Hook Handler for Knowledge Capture
 *
 * Runs upon session startup to:
 * 1. Read ~/.gemini/knowledge-capture/settings.json
 * 2. Execute git pull on configured remote repositories (gracefully degraded if absent)
 * 3. Count memory entries across Workspace, Private, and Team layers
 * 4. Audit uncommitted changes in the Private layer
 * 5. Output injectSteps system message via stdout complying with the Antigravity hook schema
 */

function countMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return 0;
  }
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md')).length;
  } catch {
    return 0;
  }
}

function safeGitPull(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    return false;
  }
  try {
    execSync('git pull --ff-only', {
      cwd: repoDir,
      timeout: 8000,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function checkUncommittedChanges(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    return { hasChanges: false, count: 0 };
  }
  try {
    const status = execSync('git status --porcelain', {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    if (!status) {
      return { hasChanges: false, count: 0 };
    }

    const lines = status.split(/\r?\n/).filter(Boolean);
    return { hasChanges: true, count: lines.length };
  } catch {
    return { hasChanges: false, count: 0 };
  }
}

async function main() {
  // Read stdin context if available (non-blocking)
  let workspaceRoot = process.cwd();
  try {
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    const input = Buffer.concat(chunks).toString('utf8').trim();
    if (input) {
      const payload = JSON.parse(input);
      if (Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0) {
        workspaceRoot = payload.workspacePaths[0];
      }
    }
  } catch {
    // Stdin reading fallback to process.cwd()
  }

  const home = os.homedir();
  const baseDir = path.join(home, '.gemini', 'knowledge-capture');
  const settingsPath = path.join(baseDir, 'settings.json');
  const privateDir = path.join(baseDir, 'private');
  const teamDir = path.join(baseDir, 'team');
  const workspaceDir = path.join(workspaceRoot, '.agents', 'rules', 'memory');

  let settings = null;
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // Invalids settings handled gracefully
    }
  }

  // Pull remote repositories if configured
  let privateSyncStatus = 'Not configured (Local store active)';
  let teamSyncStatus = 'Not configured';

  if (settings?.privateRepoUrl) {
    const pullSuccess = safeGitPull(privateDir);
    privateSyncStatus = pullSuccess ? 'Synchronized (Git pull successful)' : 'Offline / Remote unavailable';
  }

  if (settings?.teamRepoUrl) {
    const pullSuccess = safeGitPull(teamDir);
    teamSyncStatus = pullSuccess ? 'Synchronized (Git pull successful)' : 'Offline / Remote unavailable';
  }

  // Count files per layer
  const workspaceCount = countMarkdownFiles(workspaceDir);
  const privateCount = countMarkdownFiles(privateDir);
  const teamCount = countMarkdownFiles(teamDir);

  // Check uncommitted private memories
  const uncommitted = checkUncommittedChanges(privateDir);

  // Construct summary message
  let report = `### 🧠 Knowledge Capture Status\n\n`;
  report += `* **Layer 1 (Workspace Scoped):** ${workspaceCount} entries (\`${workspaceDir}\`)\n`;
  report += `* **Layer 2 (Local Global Private):** ${privateCount} entries [${privateSyncStatus}]\n`;
  report += `* **Layer 3 (Team Global):** ${teamCount} entries [${teamSyncStatus}]\n`;

  if (uncommitted.hasChanges) {
    report += `\n> [!WARNING]\n`;
    report += `> You have **${uncommitted.count} uncommitted memory update(s)** in your Private layer.\n`;
    report += `> Use the \`/kc-commit\` command to review and commit your changes.\n`;
  }

  if (!settings) {
    report += `\n> [!NOTE]\n`;
    report += `> Knowledge Capture settings file not detected at \`~/.gemini/knowledge-capture/settings.json\`.\n`;
    report += `> The Private layer operates locally without Git sync. Run \`/kc-init\` to configure remote repositories.\n`;
  }

  // Format JSON payload matching Antigravity SessionStart hook contract
  const output = {
    injectSteps: [
      {
        systemMessage: {
          systemMessage: report
        }
      }
    ]
  };

  process.stdout.write(JSON.stringify(output) + '\n');
}

main().catch(() => {
  // Ensure hook never crashes the agent startup
  process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
});
