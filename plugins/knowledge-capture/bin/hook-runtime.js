import path from 'node:path';

/**
 * Canonical Hook Runtime Adapter for Knowledge Capture.
 * Unifies stdin payload parsing, workspace root discovery, dual-platform
 * detection (Antigravity vs. Claude Code), and stdout message emission
 * across SessionStart, SessionEnd, and claude-rules hooks.
 */

export async function getStdinPayload(timeoutMs = 150) {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      return resolve({});
    }
    let data = '';
    const timer = setTimeout(() => {
      process.stdin.pause();
      resolve({});
    }, timeoutMs);

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

export function resolveHookWorkspace(payload = {}) {
  if (process.env.WORKSPACE_DIR) {
    return path.resolve(process.env.WORKSPACE_DIR);
  }
  if (Array.isArray(payload?.workspacePaths) && payload.workspacePaths.length > 0) {
    return path.resolve(payload.workspacePaths[0]);
  }
  if (typeof payload?.cwd === 'string' && payload.cwd.trim()) {
    return path.resolve(payload.cwd);
  }
  return process.cwd();
}

export function detectHookPlatform(payload = {}) {
  const isClaudeCode = Boolean(process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDE_CODE);
  const isAntigravity = !isClaudeCode || Boolean(payload && payload.conversationId);
  return { isClaudeCode, isAntigravity };
}

export function emitHookMessage(message, { isAntigravity, stdout = process.stdout } = {}) {
  if (isAntigravity) {
    const injectSteps = message
      ? [{ systemMessage: { systemMessage: message } }]
      : [];
    stdout.write(JSON.stringify({ injectSteps }) + '\n');
  } else if (message) {
    stdout.write(message.endsWith('\n') ? message : `${message}\n`);
  }
}
