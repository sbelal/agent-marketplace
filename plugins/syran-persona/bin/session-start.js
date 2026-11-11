#!/usr/bin/env node

/**
 * session-start.js
 * 
 * SessionStart Lifecycle Hook Handler for Syran Persona.
 * Provides dual-platform compatibility:
 * - Antigravity: Injects JSON systemMessage steps via stdout.
 * - Claude Code: Injects full markdown rules/directives to stdout so the model
 *   adopts the Syran Logic Officer persona upon startup.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.dirname(__dirname);

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

    if (cache && (now - cache.timestamp < 3600 * 1000)) {
      return cache.hasUpdate ? cache.notice : null;
    }

    let hasUpdate = false;
    let notice = '';

    const repoGit = path.join(pluginRoot, '..', '..', '.git');
    if (fs.existsSync(repoGit)) {
      try {
        const repoDir = path.dirname(repoGit);
        execSync('git fetch --dry-run origin', {
          cwd: repoDir,
          timeout: 2000,
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=2' },
          stdio: ['ignore', 'pipe', 'ignore']
        });
        const behind = execSync('git rev-list HEAD..origin/main --count', {
          cwd: repoDir,
          timeout: 1000,
          encoding: 'utf8',
          env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        const count = parseInt(behind, 10) || 0;
        if (count > 0) {
          hasUpdate = true;
          notice = `\n> [!NOTE]\n> 🚀 **Plugin Update Available:** ${count} new update(s) available for \`${pluginName}\` (and marketplace plugins).\n> Instruct me: **"Update ${pluginName}"** or **"Update all plugins"** to pull the latest changes.\n`;
        }
      } catch {}
    } else {
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
  let payload = {};
  try {
    payload = await getStdinPayload();
  } catch {
    payload = {};
  }

  // Load persona rules
  let personaRules = '';
  const agentsPath = path.join(pluginRoot, 'rules', 'AGENTS.md');
  if (fs.existsSync(agentsPath)) {
    try {
      personaRules = fs.readFileSync(agentsPath, 'utf8');
    } catch {
      // Fallback
    }
  }

  const isClaudeCode = Boolean(process.env.CLAUDE_PLUGIN_ROOT);
  const isAntigravity = !isClaudeCode || Boolean(payload && payload.conversationId);
  const home = os.homedir();
  const updateNotice = checkPluginUpdateNotice(pluginRoot, 'syran-persona', home);

  if (isAntigravity) {
    // Antigravity discovers rules/AGENTS.md automatically. Hook outputs status notice.
    let notice = `> [!NOTE]\n> Syran Logic Officer persona active. Operational directives and formal logic analysis protocols engaged.\n`;
    if (updateNotice) {
      notice += updateNotice;
    }
    const output = {
      injectSteps: [
        {
          systemMessage: {
            systemMessage: notice
          }
        }
      ]
    };
    process.stdout.write(JSON.stringify(output) + '\n');
  } else {
    // Under Claude Code, rules/AGENTS.md is not loaded automatically by the plugin engine.
    // Injecting the complete persona rules here guarantees 100% persona adoption.
    let claudeContext = `\n# Syran Persona Activated\n\n`;
    claudeContext += `You are now operating under the Syran Logic Officer persona.\n\n`;
    claudeContext += `---\n\n`;
    claudeContext += personaRules ? personaRules : `# Persona: Syran, The Logic Officer\n\nOperate with pure logic, formal precision, and no contractions.\n`;
    if (updateNotice) {
      claudeContext += updateNotice;
    }
    
    process.stdout.write(claudeContext + '\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => {
    // Failsafe exit so agent startup is never blocked
    process.exit(0);
  });
