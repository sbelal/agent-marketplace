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
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.dirname(__dirname);

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

  const isAntigravity = Boolean(payload && payload.conversationId);

  if (isAntigravity) {
    // Antigravity discovers rules/AGENTS.md automatically. Hook outputs status notice.
    const notice = `> [!NOTE]\n> Syran Logic Officer persona active. Operational directives and formal logic analysis protocols engaged.\n`;
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
    
    process.stdout.write(claudeContext + '\n');
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => {
    // Failsafe exit so agent startup is never blocked
    process.exit(0);
  });
