#!/usr/bin/env node

import readline from 'node:readline';
import {
  getMemorySummary,
  getLayerStatistics,
  getMemoryContent,
  saveMemoryEntry,
  mergeMemoryEntries,
  deleteMemoryEntry,
  syncMemoryLayer,
  prepareTeamPromotion,
  mineGitHistoryMemories,
  ingestTeamAdr,
  bootstrapRepoMemories,
  autoElicitSessionKnowledge
} from './memory-service.js';

import {
  syncSqliteIndex,
  searchMemoriesHybrid,
  getKnowledgeGraphData,
  recordTelemetryEvent,
  generateKnowledgeGraphHtml,
  detectContradictionsAndDrift,
  proactiveMemoryProbe,
  recordMemoryEfficacy
} from './sqlite-index.js';

/**
 * Standard Stdio JSON-RPC 2.0 Model Context Protocol (MCP) Server
 * Full CQS Compliance (Queries + Commands)
 */

const TOOLS = [
  // ==========================================
  // QUERIES
  // ==========================================
  {
    name: 'get_memory_summary',
    description:
      'Scans persistent memory markdown files across layers (Workspace, Private, Team), parses YAML frontmatters, and returns Markdown tables grouped by ### Domain: <domain>. Respects precedence hierarchy: Workspace > Private > Team and deterministic overrides shadowing.',
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
    name: 'search_memories',
    description:
      'High-performance Multi-Vector Hybrid Semantic Retrieval combining local SQLite FTS5 BM25 with multi-facet dense embeddings (trigger intent, content rule, entity) fused via Reciprocal Rank Fusion (RRF). Returns ranked memory cards with match confidence percentages.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query (e.g., "how to prevent container oom kills" or "terraform lock timeout").'
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default: 5).'
        },
        mode: {
          type: 'string',
          enum: ['hybrid', 'multi_vector', 'lexical'],
          description: "Search retrieval strategy ('hybrid' via RRF, 'multi_vector' semantic only, or 'lexical' BM25 only). Defaults to 'hybrid'."
        }
      },
      required: ['query']
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
      'Retrieves full markdown content, YAML frontmatter, and resolved 1-hop related memory graph footer for one or more memory slugs from Workspace, Private, or Team storage.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['all', 'workspace', 'private', 'team'],
          description:
            "The memory layer containing the target file, or 'all' to resolve highest-precedence layer automatically."
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
  },
  {
    name: 'get_memory_graph',
    description:
      'Returns complete node-and-link graph dataset (nodes with domain, layer, staleness, and applied counts; edges with related and overrides connections) for D3/SVG canvas rendering.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'proactive_memory_probe',
    description:
      'Zero-turn proactive recall probe. Quickly checks natural language user prompt or context against indexed memory triggers in < 5ms and returns high-confidence advisory cards.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The user query, prompt, or task context to probe against memory triggers.'
        },
        threshold: {
          type: 'number',
          description: 'Confidence threshold (0.0 to 1.0, default: 0.55).'
        },
        limit: {
          type: 'number',
          description: 'Maximum recommendations to return (default: 3).'
        },
        workspaceRoot: {
          type: 'string',
          description: 'Workspace root path.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'mine_git_history_memories',
    description:
      'Historical tacit knowledge archeology. Mines git commits, fix messages, and revert history to automatically surface undocumented workarounds, bug fixes, and gotchas.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: {
          type: 'string',
          description: 'Workspace root directory.'
        },
        maxCommits: {
          type: 'number',
          description: 'Maximum commits to scan (default: 100).'
        }
      }
    }
  },

  // ==========================================
  // COMMANDS (State Mutations)
  // ==========================================
  {
    name: 'save_memory_entry',
    description:
      'Creates or updates a memory entry with YAML frontmatter schema validation and automatic reference re-wiring if renamed.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['workspace', 'private'],
          description: "Target layer ('workspace' or 'private')."
        },
        slug: {
          type: 'string',
          description: 'Canonical kebab-case slug for the memory.'
        },
        oldSlug: {
          type: 'string',
          description: 'If renaming an existing memory, provide the old slug so references are cleanly re-wired.'
        },
        title: {
          type: 'string',
          description: 'Human-readable title for the guideline (# Title).'
        },
        why: {
          type: 'string',
          description: 'Root cause or architectural rationale (## Why).'
        },
        howToApply: {
          type: 'string',
          description: 'Actionable instructions, code snippets, or commands (## How to apply).'
        },
        body: {
          type: 'string',
          description: 'Alternative full raw Markdown body (if not using title/why/howToApply).'
        },
        type: {
          type: 'string',
          enum: ['convention', 'platform-fact', 'tool-gotcha', 'preference'],
          description: 'Classification type.'
        },
        domain: {
          type: 'string',
          description: "Taxonomic domain (e.g., 'kubernetes', 'terraform', 'go', 'ci-cd', 'general')."
        },
        description: {
          type: 'string',
          description: 'One-line trigger condition describing WHEN this memory must be recalled.'
        },
        verified: {
          type: 'string',
          description: 'Verification date in YYYY-MM-DD format (defaults to today).'
        },
        related: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of related memory slugs.'
        },
        overrides: {
          type: 'string',
          description: 'Lower-tier slug superseded by this entry.'
        }
      },
      required: ['layer', 'slug', 'description']
    }
  },
  {
    name: 'merge_memory_entries',
    description:
      'Merges 2 or more memory entries into a single cohesive target slug, deleting the source files and re-wiring all incoming links.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['workspace', 'private'],
          description: "Target layer ('workspace' or 'private')."
        },
        targetSlug: {
          type: 'string',
          description: 'The new consolidated target slug.'
        },
        sourceSlugs: {
          type: 'array',
          items: { type: 'string' },
          description: 'List of obsolete slugs being merged into targetSlug.'
        },
        title: { type: 'string', description: 'Title of the merged guideline.' },
        why: { type: 'string', description: 'Consolidated rationale.' },
        howToApply: { type: 'string', description: 'Consolidated instructions.' },
        body: { type: 'string', description: 'Alternative full body.' },
        type: { type: 'string', description: 'Guideline type.' },
        domain: { type: 'string', description: 'Taxonomic category.' },
        description: { type: 'string', description: 'Expanded trigger description covering both scenarios.' },
        verified: { type: 'string', description: 'Verification date (YYYY-MM-DD).' },
        related: { type: 'array', items: { type: 'string' } }
      },
      required: ['layer', 'targetSlug', 'sourceSlugs', 'description']
    }
  },
  {
    name: 'delete_memory_entry',
    description:
      'Deletes a memory file and cleans dangling references across remaining files in the layer.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['workspace', 'private'],
          description: "Layer containing the target file ('workspace' or 'private')."
        },
        slug: {
          type: 'string',
          description: 'Slug of the memory file to delete.'
        }
      },
      required: ['layer', 'slug']
    }
  },
  {
    name: 'sync_memory_layer',
    description:
      'Safely synchronizes Git remotes for Private and Team layers using fast-forward git pull.',
    inputSchema: {
      type: 'object',
      properties: {
        layer: {
          type: 'string',
          enum: ['all', 'private', 'team'],
          description: "Layer to synchronize ('all', 'private', or 'team'). Defaults to 'all'."
        }
      }
    }
  },
  {
    name: 'prepare_team_promotion',
    description:
      'Prepares an isolated promotion branch in the Team memory repository, scrubs personal machine paths/usernames, and generates the PR command.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Slug in Private memory to promote to Team layer.'
        }
      },
      required: ['slug']
    }
  },
  {
    name: 'ingest_team_adr',
    description:
      'Ingests an Architectural Decision Record (ADR) markdown file directly into the Team memory layer.',
    inputSchema: {
      type: 'object',
      properties: {
        adrPath: {
          type: 'string',
          description: 'Path to the local ADR file.'
        },
        targetLayer: {
          type: 'string',
          enum: ['workspace', 'private', 'team'],
          description: "Target layer to ingest the ADR into ('workspace', 'private', or 'team'). Defaults to 'workspace'."
        }
      },
      required: ['adrPath']
    }
  },
  {
    name: 'bootstrap_workspace_memories',
    description:
      'Scans repository configuration, linters, CI workflows, ADRs, Dockerfiles, and documentation to discover and propose initial Workspace-scoped persistent memories.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: {
          type: 'string',
          description: 'Optional path to the project root directory. Defaults to current working directory.'
        }
      }
    }
  },
  {
    name: 'generate_knowledge_graph_html',
    description:
      'Generates a complete, interactive standalone HTML canvas visualizer with D3.js force physics, domain clustering, staleness alerts, and inspector drawer.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: {
          type: 'string',
          description: 'Optional path to the project root directory. Defaults to current working directory.'
        }
      }
    }
  },
  {
    name: 'auto_elicit_session_knowledge',
    description:
      'Inspects current workspace git diffs and modified files to automatically detect and propose session-end memory candidates before closing a session or compacting context.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: {
          type: 'string',
          description: 'Optional path to the project root directory. Defaults to current working directory.'
        }
      }
    }
  },
  {
    name: 'detect_contradictions_and_drift',
    description:
      'Audits persistent memories across layers for semantic contradictions (opposing directives on similar tasks) and codebase drift (missing referenced files, runtime engine mismatches, staleness).',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: {
          type: 'string',
          description: 'Optional path to the project root directory. Defaults to current working directory.'
        },
        domain: {
          type: 'string',
          description: 'Optional category filter to isolate contradiction checks to a specific domain.'
        },
        threshold: {
          type: 'number',
          description: 'Semantic similarity threshold for contradiction evaluation (default: 0.65).'
        }
      }
    }
  },
  {
    name: 'record_memory_efficacy',
    description:
      'Records verification feedback and efficacy telemetry for a memory guideline (e.g. test_pass boosts efficacy, test_fail penalizes efficacy).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Slug of the memory entry.'
        },
        feedbackType: {
          type: 'string',
          enum: ['test_pass', 'test_fail', 'apply', 'recall'],
          description: 'Type of feedback event.'
        },
        details: {
          type: 'object',
          description: 'Optional details (e.g. { message: "Test passed" }).'
        }
      },
      required: ['slug', 'feedbackType']
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

  // Suppress notifications without id
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
            version: '2.0.0'
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
      const workspaceRoot = args.workspaceRoot || process.env.WORKSPACE_ROOT || process.cwd();

      try {
        let resultData = null;

        switch (toolName) {
          // --- Queries ---
          case 'get_memory_summary':
            resultData = getMemorySummary(workspaceRoot, args.layer || 'all', {
              domain: args.domain,
              query: args.query
            });
            break;

          case 'search_memories':
            resultData = searchMemoriesHybrid(workspaceRoot, args.query, {
              limit: args.limit || 5,
              mode: args.mode || 'hybrid'
            });
            // Record telemetry for top match
            if (resultData && resultData.length > 0) {
              recordTelemetryEvent(resultData[0].slug, 'recall');
            }
            break;

          case 'get_layer_statistics':
            resultData = getLayerStatistics(workspaceRoot);
            break;

          case 'get_memory_content': {
            const contentObj = getMemoryContent(
              workspaceRoot,
              args.layer || 'all',
              args.slug,
              args.slugs
            );
            resultData = contentObj.content;
            if (args.slug) recordTelemetryEvent(args.slug, 'apply');
            if (Array.isArray(args.slugs)) {
              args.slugs.forEach(s => recordTelemetryEvent(s, 'apply'));
            }
            break;
          }

          case 'get_memory_graph':
            resultData = getKnowledgeGraphData(workspaceRoot);
            break;

          case 'generate_knowledge_graph_html':
            resultData = generateKnowledgeGraphHtml(workspaceRoot);
            break;

          case 'bootstrap_workspace_memories':
            resultData = bootstrapRepoMemories(workspaceRoot);
            break;

          case 'proactive_memory_probe':
            resultData = proactiveMemoryProbe(workspaceRoot, args.query, {
              threshold: args.threshold,
              limit: args.limit
            });
            break;

          case 'mine_git_history_memories':
            resultData = mineGitHistoryMemories(workspaceRoot, args);
            break;

          // --- Commands ---
          case 'save_memory_entry':
            resultData = saveMemoryEntry(workspaceRoot, args);
            syncSqliteIndex(workspaceRoot);
            break;

          case 'merge_memory_entries':
            resultData = mergeMemoryEntries(workspaceRoot, args);
            syncSqliteIndex(workspaceRoot);
            break;

          case 'delete_memory_entry':
            resultData = deleteMemoryEntry(workspaceRoot, args);
            syncSqliteIndex(workspaceRoot);
            break;

          case 'sync_memory_layer':
            resultData = syncMemoryLayer(workspaceRoot, args);
            syncSqliteIndex(workspaceRoot);
            break;

          case 'prepare_team_promotion':
            resultData = prepareTeamPromotion(workspaceRoot, args);
            syncSqliteIndex(workspaceRoot);
            break;

          case 'ingest_team_adr':
            resultData = ingestTeamAdr(workspaceRoot, args.adrPath, { targetLayer: args.targetLayer || 'workspace' });
            syncSqliteIndex(workspaceRoot);
            break;

          case 'record_memory_efficacy':
            resultData = recordMemoryEfficacy(args.slug, args.feedbackType, args.details);
            break;

          case 'auto_elicit_session_knowledge':
            resultData = autoElicitSessionKnowledge(workspaceRoot);
            break;

          case 'detect_contradictions_and_drift':
            resultData = detectContradictionsAndDrift(workspaceRoot, {
              domain: args.domain,
              threshold: args.threshold
            });
            break;

          default:
            sendJsonRpc({
              jsonrpc: '2.0',
              id,
              error: {
                code: -32601,
                message: `Method '${toolName}' not found.`
              }
            });
            return;
        }

        const formattedText = typeof resultData === 'string' ? resultData : JSON.stringify(resultData, null, 2);

        sendJsonRpc({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: formattedText
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

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    handleRequest(parsed);
  } catch {
    // Ignore invalid JSON lines
  }
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
