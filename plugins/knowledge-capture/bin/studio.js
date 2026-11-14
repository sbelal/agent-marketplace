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
  if (typeof tokenHeader !== 'string' || !studioToken || tokenHeader !== studioToken) {
    return false;
  }

  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (origin === 'null') {
      return true;
    }
    return isLoopbackOrigin(origin);
  }

  return true;
}

function formatUrlHost(host) {
  if (!host || typeof host !== 'string') return '127.0.0.1';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function parseCliArgs(args) {
  const options = {
    port: 4242,
    host: '127.0.0.1',
    workspace: process.cwd(),
    autoOpen: true,
    strictPort: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eqIdx = arg.indexOf('=');
    const flag = eqIdx !== -1 ? arg.slice(0, eqIdx) : arg;
    const inlineVal = eqIdx !== -1 ? arg.slice(eqIdx + 1) : null;

    if (flag === '--port' || flag === '-p') {
      let rawPort;
      if (inlineVal !== null) {
        if (!inlineVal) throw new Error(`Missing value for ${flag}`);
        rawPort = inlineVal;
      } else {
        if (i + 1 >= args.length || !args[i + 1]) {
          throw new Error(`Missing value for ${arg}`);
        }
        rawPort = args[++i];
      }
      if (!/^\d+$/.test(rawPort)) {
        throw new Error(`Invalid port number '${rawPort}'. Must be an integer between 0 and 65535.`);
      }
      const parsedPort = Number(rawPort);
      if (!Number.isInteger(parsedPort) || parsedPort < 0 || parsedPort > 65535) {
        throw new Error(`Invalid port number '${rawPort}'. Must be between 0 and 65535.`);
      }
      options.port = parsedPort;
    } else if (flag === '--host' || flag === '-h') {
      let hostVal;
      if (inlineVal !== null) {
        hostVal = inlineVal;
      } else {
        if (i + 1 >= args.length) {
          throw new Error(`Missing value for ${arg}`);
        }
        hostVal = args[++i];
      }
      options.host = hostVal || '127.0.0.1';
    } else if (flag === '--workspace' || flag === '-w') {
      let wsVal;
      if (inlineVal !== null) {
        if (!inlineVal) throw new Error(`Missing path for ${flag}`);
        wsVal = inlineVal;
      } else {
        if (i + 1 >= args.length || !args[i + 1]) {
          throw new Error(`Missing path for ${arg}`);
        }
        wsVal = args[++i];
      }
      options.workspace = path.resolve(wsVal);
    } else if (arg === '--no-open') {
      options.autoOpen = false;
    } else if (arg === '--strict-port') {
      options.strictPort = true;
    } else if (arg === '--help') {
      console.log(`
Knowledge Capture Studio CLI

Options:
  --port, -p <number>       Port to listen on (default: 4242, 0 for ephemeral)
  --host, -h <string>       Host to bind (default: 127.0.0.1)
  --workspace, -w <path>    Workspace root directory (default: current directory)
  --no-open                 Do not automatically open the browser
  --strict-port             Fail if designated port is in use (do not auto-increment)
  --help                    Show this help message
`);
      process.exit(0);
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown flag: ${arg}`);
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
  const urlHost = formatUrlHost(host);
  const initialPort = options.port ?? 4242;
  const workspaceRoot = options.workspaceRoot || options.workspace || process.cwd();
  const autoOpen = options.autoOpen ?? true;
  const strictPort = options.strictPort ?? false;
  const studioToken = crypto.randomBytes(24).toString('hex');

  return new Promise((resolve, reject) => {
    let portAttempt = initialPort;
    const maxPortAttempts = (strictPort || initialPort === 0) ? portAttempt : portAttempt + 20;

    function tryListen() {
      const server = http.createServer(async (req, res) => {
        const origin = req.headers.origin;
        const secFetchSite = req.headers['sec-fetch-site'];
        const isAllowedOrigin = origin ? (isLoopbackOrigin(origin) || origin === 'null') : false;

        if (origin && secFetchSite !== 'cross-site' && isAllowedOrigin) {
          res.setHeader('Access-Control-Allow-Origin', origin);
          res.setHeader('Vary', 'Origin');
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Studio-Token');

        if (req.method === 'OPTIONS') {
          if (secFetchSite === 'cross-site' || (origin && !isAllowedOrigin)) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Forbidden origin' }));
            return;
          }
          res.writeHead(204);
          res.end();
          return;
        }

        try {
          let url;
          try {
            url = new URL(req.url || '/', `http://${urlHost}:${portAttempt}`);
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid request URL' }));
            return;
          }
          const pathname = url.pathname;

          if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
            const html = generateKnowledgeGraphHtml(workspaceRoot, {
              serverUrl: `http://${urlHost}:${portAttempt}`,
              studioToken
            });
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-store'
            });
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
                if (!res.headersSent) {
                  res.writeHead(413, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: false, success: false, errors: ['Payload too large (max 1MB)'] }));
                }
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
                if (!res.headersSent) {
                  res.writeHead(400, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ ok: false, success: false, errors: [err.message] }));
                }
              }
            });
            return;
          }

          // 404 for other routes
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Not found' }));
        } catch (err) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
          }
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
        const addr = server.address();
        if (addr && typeof addr === 'object' && typeof addr.port === 'number') {
          portAttempt = addr.port;
        }
        const boundUrl = `http://${urlHost}:${portAttempt}`;
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
  let cliOptions;
  try {
    cliOptions = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Invalid arguments: ${err.message}`);
    process.exit(1);
  }
  startStudioServer(cliOptions).then((instance) => {
    console.log(`
🧠 Knowledge Capture Studio
----------------------------------------
✔ Studio running at: ${instance.url}
✔ Workspace: ${cliOptions.workspace}
✔ Persistence: DIRECT BROWSER SAVE ENABLED (/api/patch)

Press Ctrl+C to stop the studio server.
`);

    const shutdown = async () => {
      console.log('\nStopping Knowledge Capture Studio...');
      const timer = setTimeout(() => process.exit(0), 500);
      if (typeof timer.unref === 'function') timer.unref();
      try {
        await instance.close();
      } catch {}
      process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  }).catch(err => {
    console.error(`Failed to start Knowledge Capture Studio: ${err.message}`);
    process.exit(1);
  });
}
