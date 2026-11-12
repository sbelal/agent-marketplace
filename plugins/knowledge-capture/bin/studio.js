#!/usr/bin/env node

/**
 * Knowledge Capture - Standalone Memory Studio CLI
 *
 * Launches a standalone, zero-dependency HTTP server (node:http) serving the interactive
 * Memory Studio UI with direct browser-to-disk persistence via /api/patch.
 *
 * Usage:
 *   node ./bin/studio.js [--port 4242] [--host 127.0.0.1] [--workspace <path>] [--no-open]
 */

import http from 'node:http';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  generateKnowledgeGraphHtml,
  getKnowledgeGraphData,
  syncSqliteIndex
} from '../mcp-server/sqlite-index.js';
import { applyMemoryPatch } from '../mcp-server/memory-service.js';

const MAX_PATCH_BODY_BYTES = 1024 * 1024; // 1 MB limit
const LOOPBACK_ORIGIN_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

function isLoopbackOrigin(origin) {
  return typeof origin === 'string' && LOOPBACK_ORIGIN_RE.test(origin);
}

function isAuthorizedRequest(req, studioToken) {
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite === 'cross-site') {
    return false;
  }

  const tokenHeader = req.headers['x-studio-token'];
  if (tokenHeader !== undefined) {
    if (typeof tokenHeader !== 'string' || !studioToken || tokenHeader !== studioToken) {
      return false;
    }
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (origin === 'null') {
      return typeof tokenHeader === 'string' && Boolean(studioToken) && tokenHeader === studioToken;
    }
    return isLoopbackOrigin(origin);
  }

  return true;
}

function parseCliArgs(args) {
  const options = {
    port: 4242,
    host: '127.0.0.1',
    workspace: process.cwd(),
    autoOpen: true,
    strictPort: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' || arg === '-p') {
      options.port = parseInt(args[++i], 10) || 4242;
    } else if (arg === '--host' || arg === '-h') {
      options.host = args[++i] || '127.0.0.1';
    } else if (arg === '--workspace' || arg === '-w') {
      options.workspace = path.resolve(args[++i]);
    } else if (arg === '--no-open') {
      options.autoOpen = false;
    } else if (arg === '--strict-port') {
      options.strictPort = true;
    } else if (arg === '--help') {
      console.log(`
Knowledge Capture Studio CLI

Options:
  --port, -p <number>       Port to listen on (default: 4242)
  --host, -h <string>       Host to bind (default: 127.0.0.1)
  --workspace, -w <path>    Workspace root directory (default: current directory)
  --no-open                 Do not automatically open the browser
  --strict-port             Fail if designated port is in use (do not auto-increment)
  --help                    Show this help message
`);
      process.exit(0);
    }
  }

  return options;
}

export function openBrowser(rawUrl) {
  if (process.env.CI || process.env.NODE_ENV === 'test') return;
  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return;
    }
  } catch {
    return;
  }

  const safeHref = parsedUrl.href;
  const platform = process.platform;
  if (platform === 'darwin') {
    execFile('open', [safeHref], { stdio: 'ignore' }, () => {});
  } else if (platform === 'win32') {
    execFile('cmd.exe', ['/c', 'start', '', safeHref], { stdio: 'ignore' }, () => {});
  } else if (platform === 'linux') {
    if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
      execFile('xdg-open', [safeHref], { stdio: 'ignore' }, () => {});
    }
  }
}

export function startStudioServer(options = {}) {
  const host = options.host || '127.0.0.1';
  const initialPort = options.port || 4242;
  const workspaceRoot = options.workspaceRoot || options.workspace || process.cwd();
  const autoOpen = options.autoOpen ?? true;
  const strictPort = options.strictPort ?? false;
  const studioToken = crypto.randomBytes(24).toString('hex');

  return new Promise((resolve, reject) => {
    let portAttempt = initialPort;
    const maxPortAttempts = strictPort ? portAttempt : portAttempt + 20;

    function tryListen() {
      const server = http.createServer(async (req, res) => {
        const origin = req.headers.origin;
        const hasValidToken = typeof req.headers['x-studio-token'] === 'string' && req.headers['x-studio-token'] === studioToken;
        if (origin && (isLoopbackOrigin(origin) || hasValidToken)) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Studio-Token');

        if (req.method === 'OPTIONS') {
          if (origin && !isLoopbackOrigin(origin) && !hasValidToken) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden origin' }));
            return;
          }
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://${host}:${portAttempt}`);
        const pathname = url.pathname;

        try {
          if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
            const html = generateKnowledgeGraphHtml(workspaceRoot, {
              serverUrl: `http://${host}:${portAttempt}`,
              studioToken
            });
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(html);
            return;
          }

          if (req.method === 'GET' && pathname === '/api/graph') {
            const graphData = getKnowledgeGraphData(workspaceRoot);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(graphData));
            return;
          }

          if (req.method === 'GET' && (pathname === '/api/health' || pathname === '/health')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              ok: true,
              status: 'running',
              workspace: workspaceRoot,
              port: portAttempt,
              host
            }));
            return;
          }

          if (req.method === 'POST' && pathname === '/api/patch') {
            if (!isAuthorizedRequest(req, studioToken)) {
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, success: false, errors: ['Forbidden: cross-site or unauthorized origin'] }));
              return;
            }

            const chunks = [];
            let totalBytes = 0;
            let abortedTooLarge = false;

            req.on('data', chunk => {
              totalBytes += chunk.length;
              if (totalBytes > MAX_PATCH_BODY_BYTES) {
                abortedTooLarge = true;
                res.writeHead(413, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, success: false, errors: ['Payload too large (max 1MB)'] }));
                req.destroy();
                return;
              }
              chunks.push(chunk);
            });

            req.on('end', async () => {
              if (abortedTooLarge) return;
              try {
                const body = Buffer.concat(chunks).toString('utf8');
                const patchData = JSON.parse(body || '{}');
                const patchResult = applyMemoryPatch(workspaceRoot, patchData);
                await syncSqliteIndex(workspaceRoot);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(patchResult));
              } catch (err) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false, success: false, errors: [err.message] }));
              }
            });
            return;
          }

          // 404 for other routes
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });

      server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && portAttempt < maxPortAttempts) {
          portAttempt++;
          tryListen();
        } else {
          reject(err);
        }
      });

      server.listen(portAttempt, host, () => {
        const boundUrl = `http://${host}:${portAttempt}`;
        if (autoOpen) {
          openBrowser(boundUrl);
        }
        resolve({
          server,
          port: portAttempt,
          host,
          url: boundUrl,
          studioToken,
          close: () => new Promise(r => server.close(r))
        });
      });
    }

    tryListen();
  });
}

// Auto-run if executed from CLI
const isDirectCli = process.argv[1] && (
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
);

if (isDirectCli) {
  const cliOptions = parseCliArgs(process.argv.slice(2));
  startStudioServer(cliOptions).then(({ url }) => {
    console.log(`
🧠 Knowledge Capture Studio
----------------------------------------
✔ Studio running at: ${url}
✔ Workspace: ${cliOptions.workspace}
✔ Persistence: DIRECT BROWSER SAVE ENABLED (/api/patch)

Press Ctrl+C to stop the studio server.
`);

    const shutdown = () => {
      console.log('\nStopping Knowledge Capture Studio...');
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch(err => {
    console.error(`Failed to start Knowledge Capture Studio: ${err.message}`);
    process.exit(1);
  });
}
