#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { autoElicitSessionKnowledge } from '../mcp-server/memory-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const pluginRoot = path.dirname(__dirname);

/**
 * SessionEnd / Stop Lifecycle Hook Handler for Knowledge Capture
 *
 * Runs upon session termination, turn stop, or compaction warning to:
 * 1. Audit uncommitted changes in the workspace
 * 2. Check if knowledge was captured during this session
 * 3. Proactively prompt the agent or developer to capture tacit knowledge before context loss
 * 4. Outputs injectSteps system message (Antigravity) or plaintext (Claude Code)
 */

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
  let workspaceRoot = process.cwd();
  let payload = {};
  try {
    payload = await getStdinPayload();
    if (Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0) {
      workspaceRoot = payload.workspacePaths[0];
    }
  } catch {}
  if (process.env.WORKSPACE_DIR) {
    workspaceRoot = process.env.WORKSPACE_DIR;
  }

  const audit = autoElicitSessionKnowledge(workspaceRoot, payload);

  if (!audit.elicitation_needed) {
    // Nothing to prompt; exit cleanly without polluting output
    return;
  }

  const modifiedCount = audit.modified_files.length;
  const topFiles = audit.modified_files.slice(0, 5).map(m => `\`${m.file}\``).join(', ');
  const more = modifiedCount > 5 ? ` and ${modifiedCount - 5} more` : '';

  let report = `> [!TIP]\n`;
  report += `> **Knowledge Capture Session-End Sentinel**\n`;
  if (modifiedCount > 0) {
    report += `> You have **${modifiedCount} uncommitted or modified file(s)** (${topFiles}${more}), but no new knowledge was recorded in this session.\n`;
  } else {
    report += `> Tacit insights (debugging breakthroughs or user working preferences) were identified in this session without code modifications.\n`;
  }
  report += `>\n`;
  report += `> Before closing this session or compacting context, consider capturing critical decisions:\n`;
  report += `> - Run \`/kc-elicit\` to review automated memory candidate proposals based on your diffs.\n`;
  report += `> - Ask the agent to capture workspace conventions (\`save_memory_entry\` to \`workspace\`) or personal gotchas/workarounds (\`private\`).\n`;

  if (audit.suggested_candidates.length > 0) {
    report += `>\n> **Suggested Session Memories:**\n`;
    for (const c of audit.suggested_candidates) {
      report += `> - **${c.title}** (\`${c.slug}\`): ${c.description}\n`;
    }
  }

  const isClaudeCode = Boolean(process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDE_CODE);
  if (isClaudeCode) {
    process.stdout.write(report + '\n');
  } else {
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
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0)); // Fail-safe: never block session exit
