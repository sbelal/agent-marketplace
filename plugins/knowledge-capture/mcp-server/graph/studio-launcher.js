import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKnowledgeGraphHtml } from './memory-studio-html.js';
import { getKnowledgeGraphData } from './graph-service.js';
import { resolveStoragePaths } from '../core/storage-paths.js';
import { startStudioServer, openBrowser } from '../../bin/studio.js';

let activeStudioInstance = null;
let activeStudioWorkspace = null;

/**
 * Universal Visual Memory Studio Launcher.
 *
 * Provides native dual-platform dispatch:
 * - Google Antigravity: Generates self-contained Generative UI HTML artifact and returns <agent-embed> inline widget.
 * - Anthropic Claude Code: Launches background HTTP persistence server (127.0.0.1:4242), automatically opens browser,
 *   and provides clickable CLI fallbacks with direct browser-to-disk persistence (/api/patch).
 *
 * @param {string} [workspaceRoot=process.cwd()] Project root directory
 * @param {Object} [options={}] Options { mode: 'auto'|'in_chat'|'browser', compact: boolean, autoOpen: boolean, port: number }
 * @returns {Promise<Object>} Execution status and launch metadata
 */
export async function renderVisualMemoryStudio(workspaceRoot = process.cwd(), options = {}) {
  const isClaudeCode = Boolean(
    process.env.CLAUDE_PLUGIN_ROOT ||
    process.env.CLAUDE_CODE ||
    options.mode === 'browser' ||
    options.platform === 'claude'
  );

  const resolvedWorkspace = path.resolve(workspaceRoot);
  const mode = options.mode || (isClaudeCode ? 'browser' : 'in_chat');
  const graphData = getKnowledgeGraphData(resolvedWorkspace);
  const paths = resolveStoragePaths(resolvedWorkspace);

  // Determine artifact directory for HTML persistence
  let artifactDir = options.artifactDir || process.env.ARTIFACT_DIR;
  if (!artifactDir) {
    if (process.env.ANTIGRAVITY_CONVERSATION_ID) {
      artifactDir = path.join(os.homedir(), '.gemini', 'jetski', 'brain', process.env.ANTIGRAVITY_CONVERSATION_ID);
    } else if (process.env.GEMINI_HOME) {
      artifactDir = path.join(process.env.GEMINI_HOME, 'artifacts');
    } else {
      artifactDir = path.join(paths.baseDir, 'artifacts');
    }
  }

  const htmlFileName = options.fileName || 'memory-studio.html';
  const htmlPath = path.join(artifactDir, htmlFileName);

  // Start or reuse Studio HTTP server BEFORE rendering HTML in browser mode so the resolved port & token are embedded
  const requestedPort = options.port ?? 4242;
  let serverInfo = null;
  if (mode === 'browser' || (isClaudeCode && mode !== 'in_chat')) {
    serverInfo = activeStudioInstance;
    if (serverInfo && (activeStudioWorkspace !== resolvedWorkspace || serverInfo.server?.listening === false)) {
      await stopStudioService();
      serverInfo = null;
    }
    if (!serverInfo) {
      try {
        serverInfo = await startStudioServer({
          workspaceRoot: resolvedWorkspace,
          port: requestedPort,
          strictPort: options.strictPort ?? false,
          autoOpen: options.autoOpen ?? true
        });
        activeStudioInstance = serverInfo;
        activeStudioWorkspace = resolvedWorkspace;
      } catch (err) {
        serverInfo = { url: `http://127.0.0.1:${requestedPort}`, studioToken: '', serverStarted: false, error: err.message };
      }
    } else if (options.autoOpen !== false) {
      openBrowser(serverInfo.url);
    }
  } else if (
    activeStudioInstance &&
    activeStudioWorkspace === resolvedWorkspace &&
    activeStudioInstance.server?.listening !== false
  ) {
    serverInfo = activeStudioInstance;
  }

  const resolvedServerUrl = serverInfo?.url || `http://127.0.0.1:${requestedPort}`;
  const htmlContent = generateKnowledgeGraphHtml(resolvedWorkspace, {
    compact: options.compact ?? (mode === 'in_chat'),
    serverUrl: resolvedServerUrl,
    studioToken: serverInfo?.studioToken || ''
  });

  try {
    fs.mkdirSync(artifactDir, { recursive: true });
    fs.writeFileSync(htmlPath, htmlContent, 'utf8');
  } catch {}

  // 1. Claude Code Fallback: Local HTTP persistence daemon + automatic browser open
  if (mode === 'browser' || (isClaudeCode && mode !== 'in_chat')) {
    const serverStarted = Boolean(serverInfo?.server);
    return {
      status: serverStarted ? 'ready' : 'offline_fallback',
      serverStarted,
      platform: 'claude_code',
      mode: 'browser',
      workspace: resolvedWorkspace,
      serverUrl: serverInfo.url,
      offlineHtmlPath: htmlPath,
      ...(serverInfo?.error ? { error: serverInfo.error } : {}),
      stats: {
        nodes: graphData.nodes.length,
        links: graphData.links.length,
        staleCount: graphData.summary.staleNodesCount,
        domains: graphData.summary.domains
      },
      message: serverStarted
        ? `Visual Memory Studio active at ${serverInfo.url}. Browser launched with direct browser-to-disk persistence via /api/patch.`
        : `Visual Memory Studio HTTP server could not start (${serverInfo?.error || 'unknown error'}). Generated offline HTML at ${htmlPath}.`
    };
  }

  // 2. Antigravity In-Chat Generative UI: Flush, compact interactive widget embed
  const embedCode = `<agent-embed src="file://${htmlPath}"></agent-embed>`;
  return {
    status: 'ready',
    platform: 'antigravity',
    mode: 'in_chat',
    artifactPath: htmlPath,
    embedTag: embedCode,
    stats: {
      nodes: graphData.nodes.length,
      links: graphData.links.length,
      staleCount: graphData.summary.staleNodesCount,
      domains: graphData.summary.domains
    },
    message: `Visual Memory Studio artifact generated for in-chat Generative UI rendering. Embed with ${embedCode}`
  };
}

/**
 * Cleanly stops any active Studio HTTP server instance.
 */
export async function stopStudioService() {
  if (activeStudioInstance && typeof activeStudioInstance.close === 'function') {
    await activeStudioInstance.close();
  }
  activeStudioInstance = null;
  activeStudioWorkspace = null;
}
