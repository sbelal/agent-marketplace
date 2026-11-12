#!/usr/bin/env node

/**
 * claude-rules.js
 *
 * Claude Code-only SessionStart hook (registered in hooks/hooks.json).
 *
 * Antigravity discovers rules/AGENTS.md automatically, but Claude Code does not
 * load plugin rules files. This hook prints the protocol as plain-text stdout,
 * which Claude Code adds to the model's context.
 *
 * It is deliberately a separate hook from session-start.js: Claude Code caps
 * each hook's stdout at 10,000 characters (longer output is replaced by a file
 * path and a 2,000-character preview). Emitting the status report and the
 * protocol from two hooks gives each its own budget.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getStdinPayload,
  detectHookPlatform,
  emitHookMessage
} from './hook-runtime.js';

const CLAUDE_HOOK_OUTPUT_LIMIT = 10000;

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.dirname(path.dirname(__filename));

async function main() {
  let payload = {};
  try {
    payload = await getStdinPayload();
  } catch {}

  const { isAntigravity } = detectHookPlatform(payload);

  if (isAntigravity) {
    // Antigravity discovers rules/AGENTS.md natively; return empty injectSteps to comply with Antigravity hook schema
    emitHookMessage('', { isAntigravity: true });
    return;
  }

  try {
    const rulesPath = path.join(pluginRoot, 'rules', 'AGENTS.md');
    const rules = fs.readFileSync(rulesPath, 'utf8').trim();
    if (rules.length > CLAUDE_HOOK_OUTPUT_LIMIT) {
      process.stderr.write(
        `[knowledge-capture] rules/AGENTS.md is ${rules.length} characters; Claude Code truncates hook output above ${CLAUDE_HOOK_OUTPUT_LIMIT}.\n`
      );
    }
    emitHookMessage(rules, { isAntigravity: false });
  } catch {
    // Never block session startup
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));

