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
      'Scans persistent memory markdown files across layers (Workspace, Private, Team), parses YAML frontmatters, and returns a compact markdown table of [Layer | Slug | Type | Overrides | Trigger / Description]. Respects precedence hierarchy: Workspace > Private > Team.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['all', 'workspace', 'private', 'team'],
          description: "Optional filter for memory layer. Defaults to 'all'."
        }
      }
    }
  },
  {
    name: 'get_layer_statistics',
    description:
      'Returns entry counts per layer (Workspace, Private, Team), configuration status, and uncommitted Git changes warnings.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'get_memory_content',
    description:
      'Retrieves the full markdown content and YAML frontmatter of a designated memory slug from Workspace, Private, or Team storage.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['workspace', 'private', 'team'],
          description: 'The memory layer containing the target file.'
        },
        slug: {
          type: 'string',
          description: 'The slug or file name of the memory.'
        }
      },
      required: ['layer', 'slug']
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
            version: '1.0.0'
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
          resultText = getMemorySummary(workspaceRoot, args.layer || 'all');
        } else if (toolName === 'get_layer_statistics') {
          const stats = getLayerStatistics(workspaceRoot);
          resultText = JSON.stringify(stats, null, 2);
        } else if (toolName === 'get_memory_content') {
          const contentObj = getMemoryContent(workspaceRoot, args.layer, args.slug);
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
