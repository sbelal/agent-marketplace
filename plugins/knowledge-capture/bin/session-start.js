#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { getLayerStatistics } from '../mcp-server/memory-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.dirname(__dirname);

/**
 * SessionStart Lifecycle Hook Handler for Knowledge Capture
 *
 * Runs upon session startup to:
 * 1. Read ~/.gemini/knowledge-capture/settings.json
 * 2. Execute git pull on configured remote repositories (gracefully degraded if absent)
 * 3. Count memory entries across Workspace, Private, and Team layers
 * 4. Audit uncommitted changes, active branches, and upstream divergence
 * 5. Output injectSteps system message via stdout complying with the Antigravity hook schema
 */

const GIT_EXEC_ENV = {
  ...process.env,
  GIT_TERMINAL_PROMPT: '0',
  GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=3'
};

function safeGitPull(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    return false;
  }
  try {
    // Only pull if on main/master and working tree is clean
    const branch = execSync('git rev-parse --abbrev-ref HEAD', {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 3000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    if (branch.startsWith('promote/')) {
      return 'on-promote-branch';
    }

    const dirty = execSync('git status --porcelain', {
      cwd: repoDir,
      encoding: 'utf8',
      timeout: 3000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();

    if (dirty) {
      return 'dirty';
    }

    execSync('git pull --ff-only', {
      cwd: repoDir,
      timeout: 3000,
      env: GIT_EXEC_ENV,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return 'success';
  } catch {
    return 'failed';
  }
}

function checkPluginUpdateNotice(pluginRoot, pluginName, homeDir) {
  try {
    const cacheFile = path.join(homeDir, '.gemini', 'config', `.update_check_${pluginName}.json`);
    const now = Date.now();
    let cache = null;
    if (fs.existsSync(cacheFile)) {
      try {
        cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      } catch {}
    }

    // Check at most once per 60 minutes
    if (cache && (now - cache.timestamp < 3600 * 1000)) {
      return cache.hasUpdate ? cache.notice : null;
    }

    let hasUpdate = false;
    let notice = '';

    // Check if plugin is inside a git clone (monorepo source mode)
    const repoGit = path.join(pluginRoot, '..', '..', '.git');
    if (fs.existsSync(repoGit)) {
      try {
        const repoDir = path.dirname(repoGit);
        execSync('git fetch --dry-run origin', {
          cwd: repoDir,
          timeout: 2000,
          env: GIT_EXEC_ENV,
          stdio: ['ignore', 'pipe', 'ignore']
        });
        const behind = execSync('git rev-list HEAD..origin/main --count', {
          cwd: repoDir,
          timeout: 1000,
          encoding: 'utf8',
          env: GIT_EXEC_ENV,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const count = parseInt(behind, 10) || 0;
        if (count > 0) {
          hasUpdate = true;
          notice = `\n> [!NOTE]\n> 🚀 **Plugin Update Available:** ${count} new update(s) available for \`${pluginName}\` (and marketplace plugins).\n> Instruct me: **"Update ${pluginName}"** or **"Update all plugins"** to pull the latest changes.\n`;
        }
      } catch {}
    } else {
      // Check copy deployment against permanent cache or manifest
      const manifestPath = path.join(pluginRoot, 'plugin.json');
      if (fs.existsSync(manifestPath)) {
        try {
          const currentVersion = JSON.parse(fs.readFileSync(manifestPath, 'utf8')).version || '1.0.0';
          const permManifest = path.join(homeDir, '.gemini', 'sources', 'agent-marketplace', 'plugins', pluginName, 'plugin.json');
          if (fs.existsSync(permManifest)) {
            const availVersion = JSON.parse(fs.readFileSync(permManifest, 'utf8')).version || currentVersion;
            if (availVersion !== currentVersion) {
              hasUpdate = true;
              notice = `\n> [!NOTE]\n> 🚀 **Plugin Update Available:** Version v${availVersion} is available for \`${pluginName}\` (installed: v${currentVersion}).\n> Instruct me: **"Update ${pluginName}"** or **"Update all plugins"** to upgrade.\n`;
            }
          }
        } catch {}
      }
    }

    try {
      const parentDir = path.dirname(cacheFile);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(cacheFile, JSON.stringify({ timestamp: now, hasUpdate, notice }));
    } catch {}

    return hasUpdate ? notice : null;
  } catch {
    return null;
  }
}

async function getStdinPayload() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      return resolve({});
    }
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.pause();
      resolve({});
    }, 150);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      process.stdin.pause();
      try {
        resolve(data.trim() ? JSON.parse(data.trim()) : {});
      } catch {
        resolve({});
      }
    });
    process.stdin.resume();
  });
}

async function main() {
  // Read stdin context if piped (with 150ms fallback to prevent hangs)
  let workspaceRoot = process.cwd();
  let payload = {};
  try {
    payload = await getStdinPayload();
    if (Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0) {
      workspaceRoot = payload.workspacePaths[0];
    }
  } catch {
    // Stdin reading fallback to process.cwd()
  }

  const home = os.homedir();
  const baseDir = path.join(home, '.gemini', 'knowledge-capture');
  const settingsPath = path.join(baseDir, 'settings.json');
  const privateDir = path.join(baseDir, 'private');
  const teamDir = path.join(baseDir, 'team');

  let settings = null;
  if (fs.existsSync(settingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch {
      // Invalid settings handled gracefully
    }
  }

  // Pull remote repositories if configured
  let privateSyncStatus = 'Not configured (Local store active)';
  let teamSyncStatus = 'Not configured';

  if (settings?.privateRepoUrl) {
    const res = safeGitPull(privateDir);
    if (res === 'success') privateSyncStatus = 'Synchronized (Git pull successful)';
    else if (res === 'dirty') privateSyncStatus = 'Uncommitted changes present (skipped pull)';
    else privateSyncStatus = 'Offline / Remote unavailable';
  }

  if (settings?.teamRepoUrl) {
    const res = safeGitPull(teamDir);
    if (res === 'success') teamSyncStatus = 'Synchronized (Git pull successful)';
    else if (res === 'on-promote-branch') teamSyncStatus = 'On promotion branch (manual pull required)';
    else if (res === 'dirty') teamSyncStatus = 'Uncommitted changes present in team clone';
    else teamSyncStatus = 'Offline / Remote unavailable';
  }

  // Retrieve comprehensive layer statistics using pure query service
  const stats = getLayerStatistics(workspaceRoot);
  const priv = stats.syncStatus.privateGit;
  const team = stats.syncStatus.teamGit;

  // Construct summary message
  let report = `### 🧠 Knowledge Capture Active\n\n`;
  report += `* **Workspace Layer:** ${stats.counts.workspace} entries (\`${stats.paths.workspace}\`)\n`;
  report += `* **Private Layer:** ${stats.counts.private} entries [${privateSyncStatus}]\n`;
  report += `* **Team Layer:** ${stats.counts.team} entries [${teamSyncStatus}]\n`;
  report += `* **Active Domains:** ${stats.domainSummary}\n`;
  report += `* **Stale Entries (>180d or unverified):** ${stats.staleCount}\n\n`;
  report += `*Precedence Hierarchy:* **Workspace** overrides **Private**, which overrides **Team**. Recall guidelines on demand via MCP tool \`get_memory_summary\` or \`get_memory_content\`.\n\n`;

  report += `#### Operational Recall & Capture Directive\n`;
  report += `1. **Pre-Task Recall (\`kc-recall\`):** Before executing complex architectural, implementation, or debugging tasks, call \`get_memory_summary\` (using \`domain\` / \`query\` filters as needed) and inspect matching memories via \`get_memory_content\` (including the 1-hop \`Related Memories Available\` graph).\n`;
  report += `2. **Post-Task Elicitation, Full-Envelope Repurposing & Fragmentation Detection (\`kc-capture\`):** At task completion (including deep root-cause investigations or architectural analyses that required zero code changes), evaluate learnings via \`kc-capture\`. Always run \`get_memory_summary(layer="all")\` first during candidate determination to: (a) prioritize **Full-Envelope Repurposing** (\`EXTEND\` / \`REPURPOSE-SLUG\`: evolving narrow slugs, expanding \`description\` triggers, and synthesizing body content together) over creating fragmented sibling files, and (b) detect **co-triggered memory fragmentation** when 2+ memories from the same domain were recalled together (or overlap in the summary index) and propose a \`MERGE\` candidate.\n`;

  // Warnings & Notices
  if (stats.staleCount > 0) {
    report += `\n> [!NOTE]\n`;
    report += `> **${stats.staleCount} memory entry/entries** have a \`verified\` date older than 180 days (or missing). Run \`/kc-consolidate\` to audit and refresh stale rules.\n`;
  }

  if (!priv.isClean) {
    report += `\n> [!WARNING]\n`;
    report += `> You have **${priv.uncommittedCount} uncommitted memory update(s)** in your Private layer.\n`;
    report += `> Run \`/kc-commit\` to review, audit, and push your changes.\n`;
  }

  if (team.isGit && !team.isClean) {
    report += `\n> [!CAUTION]\n`;
    report += `> The Team memory clone has **${team.uncommittedCount} uncommitted change(s)**.\n`;
    report += `> Team memory should not be edited directly. Run \`/kc-status\` to inspect or \`/kc-promote\` to open a review branch.\n`;
  }

  if (team.isGit && team.isPromoteBranch) {
    report += `\n> [!NOTE]\n`;
    report += `> Team clone is currently on promotion branch \`${team.branch}\`.\n`;
    report += `> Once your Pull Request is merged, check out \`main\` via \`git checkout main\` and run \`/kc-pull\`.\n`;
  }

  if (team.isGit && team.upstreamBehind > 0) {
    report += `\n> [!NOTE]\n`;
    report += `> Team memory clone is **${team.upstreamBehind} commit(s) behind** upstream. Run \`/kc-pull\` to fast-forward.\n`;
  }

  if (!settings) {
    report += `\n> [!NOTE]\n`;
    report += `> Settings file not detected at \`~/.gemini/knowledge-capture/settings.json\`.\n`;
    report += `> The Private layer operates locally without Git sync. Run \`/kc-init\` to configure remotes.\n`;
  }

  // Check for plugin updates and inject notice if available
  const updateNotice = checkPluginUpdateNotice(pluginRoot, 'knowledge-capture', home);
  if (updateNotice) {
    report += updateNotice;
  }


  // Dual-platform output formatting:
  // Antigravity passes stdin payload with conversationId and expects JSON injectSteps.
  // Claude Code executes the hook command and injects raw stdout plain text.
  const isAntigravity = Boolean(payload && payload.conversationId);

  if (isAntigravity) {
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
  } else {
    // Under Claude Code, rules/AGENTS.md is not loaded automatically by the plugin runtime.
    // It is injected by the separate bin/claude-rules.js SessionStart hook, because Claude Code
    // caps each hook's stdout at 10,000 characters and report + rules together exceed that.
    process.stdout.write(report + '\n');
  }
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    // Ensure hook never crashes the agent startup
    if (process.env.CLAUDE_PLUGIN_ROOT) {
      process.stdout.write(`[knowledge-capture] Startup check completed.\n`);
    } else {
      process.stdout.write(JSON.stringify({ injectSteps: [] }) + '\n');
    }
    process.exit(0);
  });
