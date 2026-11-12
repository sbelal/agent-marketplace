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
import path from 'node:path';
import fs from 'node:fs';
import { exec } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  generateKnowledgeGraphHtml,
  getKnowledgeGraphData
} from '../mcp-server/sqlite-index.js';
import { applyMemoryPatch } from '../mcp-server/memory-service.js';
import { syncSqliteIndex } from '../mcp-server/sqlite-index.js';

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

export function openBrowser(url) {
  if (process.env.CI || process.env.NODE_ENV === 'test') return;
  const platform = process.platform;
  let cmd = null;
  if (platform === 'darwin') {
    cmd = `open "${url}"`;
  } else if (platform === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (platform === 'linux') {
    if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
      cmd = `xdg-open "${url}"`;
    }
  }

  if (cmd) {
    exec(cmd, { stdio: 'ignore' }, () => {});
  }
}

export function startStudioServer(options = {}) {
  const host = options.host || '127.0.0.1';
  let initialPort = options.port || 4242;
  const workspaceRoot = options.workspaceRoot || options.workspace || process.cwd();
  const autoOpen = options.autoOpen ?? true;
  const strictPort = options.strictPort ?? false;

  return new Promise((resolve, reject) => {
    let portAttempt = initialPort;
    const maxPortAttempts = strictPort ? portAttempt : portAttempt + 20;

    function tryListen() {
      const server = http.createServer(async (req, res) => {
        // Handle CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url, `http://${host}:${portAttempt}`);
        const pathname = url.pathname;

        try {
          if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
            const html = generateKnowledgeGraphHtml(workspaceRoot);
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
            let body = '';
            req.on('data', chunk => { body += chunk; });
            req.on('end', async () => {
              try {
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
  startStudioServer(cliOptions).then(({ url, port, host }) => {
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
