#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

function resolveKcPluginVersion() {
  try {
    const pluginJsonPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'plugin.json');
    const data = JSON.parse(fs.readFileSync(pluginJsonPath, 'utf8'));
    if (data && data.version) return data.version;
  } catch {}
  return '2.2.0';
}
const KC_PLUGIN_VERSION = resolveKcPluginVersion();
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
  autoElicitSessionKnowledge,
  getTeamRepositories,
  addTeamRepository,
  setTeamRepositoryActive,
  removeTeamRepository,
  syncTeamRepositories,
  applyMemoryPatch,
  auditTeamConflicts,
  resolveTeamConflict
} from './memory-service.js';

import {
  syncSqliteIndex,
  searchMemoriesHybrid,
  getKnowledgeGraphData,
  recordTelemetryEvent,
  generateKnowledgeGraphHtml,
  detectContradictionsAndDriftAsync,
  proactiveMemoryProbe,
  recordMemoryEfficacy,
  getMemoryGraphNeighbors,
  getMemorySpanningTree,
  renderVisualMemoryStudio,
  dreamMemoryConsolidationAsync,
  correlateTestExecutionEfficacy
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
          description: "Optional filter for memory layer ('all', 'workspace', 'private', 'team', or a specific team repository slug). Defaults to 'all'."
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
        },
        format: {
          type: 'string',
          enum: ['standard', 'compact'],
          description: "Summary format. 'standard' (default) returns markdown tables, 'compact' returns low-token index cards (~15 tokens/rule) for hierarchical recall."
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
        },
        format: {
          type: 'string',
          enum: ['compact', 'full'],
          description: "Recall format. 'compact' (default) returns indexed metadata and trigger to conserve tokens; 'full' includes full markdown guideline body."
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
          description:
            "The memory layer ('all', 'workspace', 'private', 'team', or a specific team repository slug) containing the target file, or 'all' to resolve highest-precedence layer automatically."
        },
        slug: {
          type: 'string',
          description: 'A single memory slug (or filename) to retrieve.'
        },
        slugs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of memory slugs to retrieve in a single batch call.'
        },
        depth: {
          type: 'number',
          description: 'GraphRAG multi-hop spanning tree depth (1 to 3, default: 1). When depth > 1, traverses the memory reference graph and appends a GraphRAG Spanning Tree Context Envelope.'
        }
      }
    }
  },
  {
    name: 'get_memory_spanning_tree',
    description:
      'GraphRAG Multi-Hop Spanning Tree Recall. Traverses the bi-directional memory reference and override graph starting from a root slug up to a specified depth (1 to 3) with cycle detection, returning connected subgraph nodes, edges, and a formatted Context Envelope.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Root memory slug to traverse from.'
        },
        depth: {
          type: 'number',
          description: 'Maximum traversal depth (1 to 3, default: 2).'
        },
        maxNodes: {
          type: 'number',
          description: 'Maximum total nodes to include in the spanning tree (default: 15).'
        }
      },
      required: ['slug']
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
    name: 'get_memory_graph_neighbors',
    description:
      'Retrieves bi-directional graph neighbors (both outgoing references and incoming backlinks) for a specific memory slug.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Memory slug to inspect for bi-directional graph neighbors.'
        },
        depth: {
          type: 'number',
          description: 'Optional traversal depth (1 to 3, default: 1).'
        }
      },
      required: ['slug']
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
        type: {
          type: 'string',
          enum: ['convention', 'tool-gotcha', 'platform-fact', 'preference'],
          description: 'Guideline type.'
        },
        domain: { type: 'string', description: 'Taxonomic category.' },
        description: { type: 'string', description: 'Expanded trigger description covering both scenarios.' },
        verified: { type: 'string', description: 'Verification date (YYYY-MM-DD).' },
        related: { type: 'array', items: { type: 'string' } },
        overrides: {
          type: 'string',
          description: 'Comma-separated lower-tier memory slugs superseded by this merged entry.'
        }
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
      'Prepares an isolated promotion branch in the Team memory repository and persists sanitized memory content (with PII scrubbed, voice neutralized, and paths generalized by the Agent LLM).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Slug in Private memory to promote to Team layer.'
        },
        teamSlug: {
          type: 'string',
          description: 'Optional target team repository slug (e.g., "core-platform"). Defaults to the first active team repository.'
        },
        content: {
          type: 'string',
          description: 'Optional LLM-sanitized markdown body or full markdown content (with PII scrubbed, first-person narrative generalized, and workstation paths converted to generic paths).'
        },
        frontmatter: {
          type: 'object',
          description: 'Optional sanitized frontmatter object (type, domain, description, verified, related).'
        }
      },
      required: ['slug']
    }
  },
  {
    name: 'ingest_team_adr',
    description:
      'Ingests an Architectural Decision Record (ADR) markdown file into a target memory layer (defaults to workspace; supports workspace, private, or team).',
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
        },
        teamSlug: {
          type: 'string',
          description: 'Optional target team repository slug when targetLayer is "team".'
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
    name: 'render_visual_memory_studio',
    description:
      'Launches or renders the interactive Visual Memory Studio with dual-platform environment adaptation. In Antigravity: generates an in-chat Generative UI artifact (<agent-embed> inline widget or standalone artifact) with full D3/Canvas physics, domain filtering, and connect mode. In Claude Code: launches the local HTTP studio server daemon on localhost:4242, opens the default desktop browser, and provides clickable URLs and terminal fallbacks.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: {
          type: 'string',
          description: 'Optional path to the project root directory. Defaults to current working directory.'
        },
        mode: {
          type: 'string',
          enum: ['auto', 'in_chat', 'browser'],
          description: "Target mode: 'auto' (auto-detects Antigravity vs Claude Code), 'in_chat' (generates in-chat Generative UI artifact), or 'browser' (launches local HTTP server and opens browser)."
        },
        compact: {
          type: 'boolean',
          description: 'If true, formats a compact (<= 450px) widget optimized for inline chat embedding.'
        }
      }
    }
  },
  {
    name: 'auto_elicit_session_knowledge',
    description:
      'Trajectory-based session knowledge elicitation. Inspects workspace git diffs, modified files, user feedback, preferences ("ways of working"), and zero-code debugging breakthrough signals to automatically detect and propose session-end memory candidates before closing a session or compacting context.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceRoot: {
          type: 'string',
          description: 'Optional path to the project root directory. Defaults to current working directory.'
        },
        transcript: {
          anyOf: [{ type: 'string' }, { type: 'array' }],
          description: 'Optional session conversation transcript (array of message objects or text string) to analyze for user corrections, stylistic preferences, and debugging insights.'
        },
        userFeedback: {
          type: 'string',
          description: 'Optional explicit user feedback, corrections, or instructions regarding preferences or ways of working.'
        },
        recentCommands: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Optional array or text of recent terminal commands executed during the session.'
        },
        errorLogs: {
          anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
          description: 'Optional error messages or stack traces encountered during debugging.'
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
  },
  {
    name: 'manage_team_repositories',
    description:
      'Manages multi-team knowledge repositories configured by unique slugs. Actions: "list" (show configured repositories with sync status and active state), "add" (register a new team repo with slug and git URL), "activate" (activate a team repo by slug), "deactivate" (deactivate a team repo by slug), "remove" (remove a team repo configuration and optionally clean local clone), and "sync" (git pull latest updates for active team repos, or a single repo when slug is provided).',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'add', 'activate', 'deactivate', 'remove', 'sync'],
          description: 'Action to execute on team repositories.'
        },
        slug: {
          type: 'string',
          description: 'Unique slug identifier for the team repository (required for add, activate, deactivate, remove; optional filter for sync).'
        },
        url: {
          type: 'string',
          description: 'Remote Git URL for the team repository (required for add).'
        },
        name: {
          type: 'string',
          description: 'Human-readable name or description for the team repository.'
        },
        cleanDisk: {
          type: 'boolean',
          description: 'When action is "remove", whether to also delete the local clone directory (defaults to false).'
        }
      },
      required: ['action']
    }
  },
  {
    name: 'apply_memory_patch',
    description:
      'Applies a structured memory patch (such as exported from the Bidirectional Memory Studio UI). Atomically updates memory frontmatter fields (domain, type, description, verified) and re-wires directional links (related, overrides) on disk, then synchronizes the SQLite index.',
    inputSchema: {
      type: 'object',
      properties: {
        patch: {
          type: 'object',
          description: 'The JSON patch object containing modified_nodes, added_links, and removed_links.'
        }
      },
      required: ['patch']
    }
  },
  {
    name: 'audit_team_conflicts',
    description:
      'Audits multi-repository and team synchronization for divergence conflicts between private and team layers (divergent overrides, conflicting rule triggers or bodies). Returns detected conflicts with 3-way diff summaries.',
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
    name: 'resolve_team_conflict',
    description:
      'Resolves a detected team memory conflict by choosing a resolution strategy ("adopt_team", "keep_private", or "merge_both") and updates persistent disk files, followed by index resynchronization.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Unique slug of the conflicting memory entry.'
        },
        privateSlug: {
          type: 'string',
          description: 'Optional private memory slug when overriding a differently named team slug.'
        },
        privatePath: {
          type: 'string',
          description: 'Optional direct file path to the private memory entry.'
        },
        resolution: {
          type: 'string',
          enum: ['adopt_team', 'keep_private', 'merge_both'],
          description: 'Conflict resolution strategy.'
        },
        mergedContent: {
          type: 'string',
          description: 'Merged markdown content or rule body (required when resolution is "merge_both").'
        },
        mergedFrontmatter: {
          type: 'object',
          description: 'Optional YAML frontmatter overrides for the merged entry.'
        }
      },
      required: ['slug', 'resolution']
    }
  },
  {
    name: 'dream_memory_consolidation',
    description:
      'Executes automated "Memory Dreaming" & Semantic Synthesis (/kc-dream). Scans persistent memories across layers, clusters semantically overlapping or fragmented entries, and generates consolidation proposals to reduce context bloat and synthesize unified architectural rules.',
    inputSchema: {
      type: 'object',
      properties: {
        domain: {
          type: 'string',
          description: 'Optional category filter to isolate clustering to a specific domain.'
        },
        threshold: {
          type: 'number',
          description: 'Semantic cosine similarity threshold for clustering (default: 0.65).'
        },
        workspaceRoot: {
          type: 'string',
          description: 'Optional path to the project root directory. Defaults to current working directory.'
        }
      }
    }
  },
  {
    name: 'correlate_test_efficacy',
    description:
      'Closed-Loop Execution-Driven Efficacy automated verification hook. Correlates test suite executions (command, exitCode, stdout, stderr) with memory rules to boost or penalize efficacy scores and modulate future search confidence.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'Test command executed (e.g. "npm test" or "go test ./...").'
        },
        exitCode: {
          type: 'number',
          description: 'Exit code of the test command (0 for pass, >0 for failure).'
        },
        stdout: {
          type: 'string',
          description: 'Standard output captured from test execution.'
        },
        stderr: {
          type: 'string',
          description: 'Standard error captured from test execution.'
        },
        slugs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional explicit memory slugs to correlate. If omitted, uses recently applied/recalled memories.'
        },
        workspaceRoot: {
          type: 'string',
          description: 'Optional path to the project root directory. Defaults to current working directory.'
        }
      }
    }
  }
];

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

let clientCapabilities = {};
let cachedClientWorkspaceRoots = [];
let rootsQueryInFlight = null;
let rootsGeneration = 0;
let hasQueriedRoots = false;
let nextServerRequestId = 1;
const pendingClientResponses = new Map();

function sendJsonRpc(response) {
  const json = JSON.stringify(response);
  process.stdout.write(json + '\n');
}

function sendClientRequest(method, params = {}, timeoutMs = 500) {
  return new Promise((resolve, reject) => {
    const reqId = `kc-srv-${nextServerRequestId++}`;
    const timer = setTimeout(() => {
      pendingClientResponses.delete(reqId);
      reject(new Error(`Timeout waiting for client response to ${method}`));
    }, timeoutMs);
    pendingClientResponses.set(reqId, {
      resolve: (res) => {
        clearTimeout(timer);
        resolve(res);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      }
    });
    sendJsonRpc({ jsonrpc: '2.0', id: reqId, method, params });
  });
}

async function refreshClientRoots(timeoutMs = 500) {
  if (rootsQueryInFlight) return rootsQueryInFlight;
  const gen = rootsGeneration;
  rootsQueryInFlight = (async () => {
    try {
      const result = await sendClientRequest('roots/list', {}, timeoutMs);
      const roots = Array.isArray(result?.roots) ? result.roots : [];
      const parsedPaths = [];
      for (const r of roots) {
        if (!r || typeof r.uri !== 'string') continue;
        if (r.uri.startsWith('file://')) {
          try {
            parsedPaths.push(fileURLToPath(r.uri));
          } catch {}
        }
      }
      if (rootsGeneration === gen) {
        cachedClientWorkspaceRoots = parsedPaths;
        hasQueriedRoots = true;
      }
    } catch {
      if (rootsGeneration === gen) {
        hasQueriedRoots = true;
      }
    } finally {
      rootsQueryInFlight = null;
    }
    if (rootsGeneration !== gen) {
      return refreshClientRoots(timeoutMs);
    }
    return cachedClientWorkspaceRoots;
  })();
  return rootsQueryInFlight;
}

async function resolveWorkspaceRoot(args = {}) {
  if (args.workspaceRoot) return args.workspaceRoot;
  if (process.env.WORKSPACE_ROOT) return process.env.WORKSPACE_ROOT;
  if (process.env.WORKSPACE_DIR) return process.env.WORKSPACE_DIR;
  if (cachedClientWorkspaceRoots.length > 0) return cachedClientWorkspaceRoots[0];
  if (clientCapabilities?.roots && !hasQueriedRoots) {
    const roots = await refreshClientRoots(400);
    if (roots.length > 0) return roots[0];
  }
  return process.cwd();
}

async function handleRequest(message) {
  if (!message || typeof message !== 'object') {
    return;
  }

  const { id, method, params } = message;

  // Handle JSON-RPC responses from client (e.g., roots/list)
  if (!method && id !== undefined && id !== null && ('result' in message || 'error' in message)) {
    const pending = pendingClientResponses.get(id);
    if (pending) {
      pendingClientResponses.delete(id);
      if ('error' in message && message.error) {
        pending.reject(new Error(message.error.message || 'Client returned error'));
      } else {
        pending.resolve(message.result);
      }
    }
    return;
  }

  // Handle notifications without responding
  if (id === undefined || id === null || (typeof method === 'string' && method.startsWith('notifications/'))) {
    if (method === 'notifications/roots/list_changed') {
      rootsGeneration++;
      hasQueriedRoots = false;
      cachedClientWorkspaceRoots = [];
      refreshClientRoots().catch(() => {});
    } else if (method === 'notifications/initialized' && clientCapabilities?.roots) {
      refreshClientRoots().catch(() => {});
    }
    return;
  }

  switch (method) {
    case 'initialize': {
      clientCapabilities = (params && typeof params.capabilities === 'object' && params.capabilities) ? params.capabilities : {};
      const requestedVersion = params?.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requestedVersion)
        ? requestedVersion
        : '2024-11-05';
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'knowledge-capture',
            version: KC_PLUGIN_VERSION
          }
        }
      });
      break;
    }

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
      const args = (params?.arguments && typeof params.arguments === 'object' && !Array.isArray(params.arguments))
        ? params.arguments
        : {};
      const workspaceRoot = await resolveWorkspaceRoot(args);

      try {
        let resultData = null;

        switch (toolName) {
          // --- Queries ---
          case 'get_memory_summary':
            resultData = getMemorySummary(workspaceRoot, args.layer || 'all', {
              domain: args.domain,
              query: args.query,
              format: args.format || 'standard'
            });
            break;

          case 'search_memories':
            resultData = await searchMemoriesHybrid(workspaceRoot, args.query, {
              limit: args.limit || 5,
              mode: args.mode || 'hybrid',
              format: args.format || 'compact'
            });
            break;

          case 'get_layer_statistics':
            resultData = getLayerStatistics(workspaceRoot);
            break;

          case 'get_memory_content': {
            const contentObj = getMemoryContent(
              workspaceRoot,
              args.layer || 'all',
              args.slug,
              args.slugs,
              { depth: args.depth || 1 }
            );
            resultData = contentObj.content;
            break;
          }

          case 'get_memory_graph':
            resultData = getKnowledgeGraphData(workspaceRoot);
            break;

          case 'get_memory_graph_neighbors':
            resultData = getMemoryGraphNeighbors(workspaceRoot, args.slug, {
              depth: args.depth || 1
            });
            break;

          case 'get_memory_spanning_tree':
            resultData = getMemorySpanningTree(workspaceRoot, args.slug, {
              depth: args.depth || 2,
              maxDepth: args.depth || 2,
              maxNodes: args.maxNodes || 15
            });
            break;

          case 'generate_knowledge_graph_html':
            resultData = generateKnowledgeGraphHtml(workspaceRoot);
            break;

          case 'render_visual_memory_studio':
            resultData = await renderVisualMemoryStudio(workspaceRoot, args);
            break;

          case 'bootstrap_workspace_memories':
            resultData = bootstrapRepoMemories(workspaceRoot);
            break;

          case 'proactive_memory_probe':
            resultData = await proactiveMemoryProbe(workspaceRoot, args.query, {
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
            await syncSqliteIndex(workspaceRoot);
            break;

          case 'merge_memory_entries':
            resultData = mergeMemoryEntries(workspaceRoot, args);
            await syncSqliteIndex(workspaceRoot);
            break;

          case 'delete_memory_entry':
            resultData = deleteMemoryEntry(workspaceRoot, args);
            await syncSqliteIndex(workspaceRoot);
            break;

          case 'sync_memory_layer':
            resultData = syncMemoryLayer(workspaceRoot, args);
            await syncSqliteIndex(workspaceRoot);
            break;

          case 'prepare_team_promotion':
            resultData = prepareTeamPromotion(workspaceRoot, args);
            await syncSqliteIndex(workspaceRoot);
            break;

          case 'ingest_team_adr':
            resultData = ingestTeamAdr(workspaceRoot, args.adrPath, {
              targetLayer: args.targetLayer || 'workspace',
              teamSlug: args.teamSlug
            });
            await syncSqliteIndex(workspaceRoot);
            break;

          case 'record_memory_efficacy':
            resultData = recordMemoryEfficacy(args.slug, args.feedbackType, args.details);
            break;

          case 'auto_elicit_session_knowledge':
            resultData = autoElicitSessionKnowledge(workspaceRoot, args);
            break;

          case 'detect_contradictions_and_drift':
            resultData = await detectContradictionsAndDriftAsync(workspaceRoot, {
              domain: args.domain,
              threshold: args.threshold
            });
            break;

          case 'manage_team_repositories': {
            const { action, slug, url, name, cleanDisk } = args;
            if (action === 'list') {
              resultData = getTeamRepositories(workspaceRoot);
            } else if (action === 'add') {
              resultData = addTeamRepository(workspaceRoot, { slug, url, name });
              await syncSqliteIndex(workspaceRoot);
            } else if (action === 'activate') {
              resultData = setTeamRepositoryActive(workspaceRoot, { slug, active: true });
              await syncSqliteIndex(workspaceRoot);
            } else if (action === 'deactivate') {
              resultData = setTeamRepositoryActive(workspaceRoot, { slug, active: false });
              await syncSqliteIndex(workspaceRoot);
            } else if (action === 'remove') {
              resultData = removeTeamRepository(workspaceRoot, { slug, cleanDisk: cleanDisk === true });
              await syncSqliteIndex(workspaceRoot);
            } else if (action === 'sync') {
              resultData = syncTeamRepositories(workspaceRoot, { slug });
              await syncSqliteIndex(workspaceRoot);
            } else {
              throw new Error(`Unknown action for manage_team_repositories: ${action}`);
            }
            break;
          }

          case 'apply_memory_patch':
            resultData = applyMemoryPatch(workspaceRoot, args.patch || args);
            await syncSqliteIndex(workspaceRoot);
            break;

          case 'audit_team_conflicts':
            resultData = auditTeamConflicts(workspaceRoot);
            break;

          case 'resolve_team_conflict':
            resultData = resolveTeamConflict(workspaceRoot, args);
            await syncSqliteIndex(workspaceRoot);
            break;

          case 'dream_memory_consolidation':
            resultData = await dreamMemoryConsolidationAsync(workspaceRoot, args);
            break;

          case 'correlate_test_efficacy':
            resultData = correlateTestExecutionEfficacy(workspaceRoot, args);
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

        const formattedText = typeof resultData === 'string' ? resultData : JSON.stringify(resultData ?? null, null, 2);

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

let requestQueue = Promise.resolve();

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    sendJsonRpc({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error: Invalid JSON'
      }
    });
    return;
  }
  requestQueue = requestQueue.then(async () => {
    try {
      await handleRequest(parsed);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[knowledge-capture] Unhandled JSON-RPC error: ${msg}\n`);
      if (parsed && parsed.id !== undefined && parsed.id !== null) {
        sendJsonRpc({
          jsonrpc: '2.0',
          id: parsed.id,
          error: {
            code: -32603,
            message: `Internal error: ${msg}`
          }
        });
      }
    }
  });
});

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
