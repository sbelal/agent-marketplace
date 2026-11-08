#!/usr/bin/env node

import readline from 'node:readline';
import {
  getMemorySummary,
  getLayerStatistics,
  getMemoryContent
} from './memory-service.js';

/**
 * Standard Stdio JSON-RPC 2.0 Model Context Protocol (MCP) Server
 */

const TOOLS = [
  {
    name: 'get_memory_summary',
    description:
      'Scans persistent memory markdown files across layers (Workspace, Private, Team), parses YAML frontmatters (including domain and related links), and returns Markdown tables grouped by ### Domain: <domain>. Respects precedence hierarchy: Workspace > Private > Team and deterministic overrides shadowing.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['all', 'workspace', 'private', 'team'],
          description: "Optional filter for memory layer. Defaults to 'all'."
        },
        domain: {
          type: 'string',
          description:
            "Optional category filter (e.g., 'kubernetes', 'terraform', 'go', 'ci-cd', 'general')."
        },
        query: {
          type: 'string',
          description:
            'Optional keyword filter matched case-insensitively against slug, domain, type, overrides, related, or trigger description.'
        }
      }
    }
  },
  {
    name: 'get_layer_statistics',
    description:
      'Returns entry counts per layer (Workspace, Private, Team), per-domain breakdown across active layers, stale entry counts (verified > 180 days or missing), configuration status, and uncommitted Git changes warnings.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_memory_content',
    description:
      'Retrieves the full markdown content, YAML frontmatter, and resolved 1-hop related memory graph footer for one or more memory slugs from Workspace, Private, or Team storage.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['all', 'workspace', 'private', 'team'],
          description:
            "The memory layer containing the target file ('workspace', 'private', 'team'), or 'all' to resolve highest-precedence layer automatically."
        },
        slug: {
          type: 'string',
          description: 'A single memory slug (or filename) to retrieve.'
        },
        slugs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of memory slugs to retrieve in a single batch call.'
        }
      }
    }
  }
];

function sendJsonRpc(response) {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

function handleRequest(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  const { id, method, params } = message;

  // Notifications (no id)
  if (id === undefined || id === null) {
    return;
  }

  switch (method) {
    case 'initialize':
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'knowledge-capture',
            version: '1.1.0'
          }
        }
      });
      break;

    case 'ping':
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {}
      });
      break;

    case 'tools/list':
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS
        }
      });
      break;

    case 'tools/call': {
      const toolName = params?.name;
      const args = params?.arguments || {};
      const workspaceRoot = process.cwd();

      try {
        let resultText = '';

        if (toolName === 'get_memory_summary') {
          resultText = getMemorySummary(workspaceRoot, args.layer || 'all', {
            domain: args.domain,
            query: args.query
          });
        } else if (toolName === 'get_layer_statistics') {
          const stats = getLayerStatistics(workspaceRoot);
          resultText = JSON.stringify(stats, null, 2);
        } else if (toolName === 'get_memory_content') {
          const contentObj = getMemoryContent(
            workspaceRoot,
            args.layer || 'all',
            args.slug,
            args.slugs
          );
          resultText = contentObj.content;
        } else {
          sendJsonRpc({
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Unknown tool: '${toolName}'`
            }
          });
          return;
        }

        sendJsonRpc({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: resultText
              }
            ]
          }
        });
      } catch (err) {
        sendJsonRpc({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: `Error executing tool '${toolName}': ${err.message}`
              }
            ],
            isError: true
          }
        });
      }
      break;
    }

    default:
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method '${method}' not found.`
        }
      });
      break;
  }
}

function startServer() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    try {
      const parsed = JSON.parse(trimmed);
      handleRequest(parsed);
    } catch (err) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: `Parse error: ${err.message}`
        }
      });
    }
  });

  process.on('SIGINT', () => process.exit(0));
  process.on('SIGTERM', () => process.exit(0));
}

startServer();
