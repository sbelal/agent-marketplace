#!/usr/bin/env node

/**
 * index.js
 * 
 * Standard Stdio JSON-RPC 2.0 Model Context Protocol (MCP) Server for Syran.
 * Adheres strictly to CQS and SRP standards.
 */

import readline from 'node:readline';
import {
  getPersonaStatus,
  getPersonaDirectives,
  consultLogic,
  analyzeLogicalFallacies,
  evaluateProbability,
  evaluateArchitecturalTradeoffs
} from './logic-service.js';

const TOOLS = [
  {
    name: 'syran_get_status',
    description: 'Retrieves the current operational status, mandate, directives, and rules of the Syran Logic Officer persona.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'syran_consult',
    description: 'Deconstructs a user query or technical proposition into formal logic propositions, identifies hidden assumptions or contradictions, and delivers objective counsel without contractions.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The query, architectural dilemma, or proposed command to evaluate.'
        },
        premise: {
          type: 'string',
          description: 'Optional underlying premise or assumption.'
        }
      },
      required: ['query']
    }
  },
  {
    name: 'syran_analyze_fallacies',
    description: 'Scans an argument, rationale, or design proposition for formal and informal logical fallacies (Sunk Cost, Ad Hominem, False Dilemma, Appeal to Emotion, Circular Reasoning, Hasty Generalization) and provides rigorous refutations.',
    inputSchema: {
      type: 'object',
      properties: {
        argument: {
          type: 'string',
          description: 'The argument, comment, or reasoning text to analyze for fallacies.'
        }
      },
      required: ['argument']
    }
  },
  {
    name: 'syran_evaluate_probability',
    description: 'Performs formal probabilistic and expected-value evaluation across competing hypotheses or implementation courses of action.',
    inputSchema: {
      type: 'object',
      properties: {
        hypotheses: {
          type: 'array',
          description: 'List of competing courses of action or hypotheses to rate.',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Name or description of hypothesis' },
              weight: { type: 'number', description: 'Empirical weight or frequency' },
              risk: { type: 'number', description: 'Risk factor score between 0.0 and 1.0' }
            },
            required: ['label']
          }
        },
        prior: {
          type: 'number',
          description: 'Prior baseline probability (0.0 to 1.0). Defaults to 0.5.'
        }
      },
      required: ['hypotheses']
    }
  },
  {
    name: 'syran_evaluate_tradeoffs',
    description: 'First-Principles Architectural Trade-Off Matrix. Evaluates competing architectural options across weighted criteria using multi-attribute utility theory (MAUT), detects Pareto dominance, and isolates critical pivot dimensions without contractions.',
    inputSchema: {
      type: 'object',
      properties: {
        options: {
          type: 'array',
          description: 'Array of candidate architectural options with names and criterion scores.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Name of the architectural candidate.' },
              description: { type: 'string', description: 'Optional description of the candidate architecture.' },
              scores: {
                type: 'object',
                description: 'Key-value map of numerical criterion scores (e.g. { latency: 12, memory: 40, complexity: 2 }).'
              }
            },
            required: ['name', 'scores']
          }
        },
        criteria: {
          type: 'array',
          description: 'Optional explicit evaluation criteria with weights and optimization directions.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Criterion identifier matching option score keys.' },
              weight: { type: 'number', description: 'Relative weight or priority (e.g. 1.0 to 5.0).' },
              direction: {
                type: 'string',
                enum: ['maximize', 'minimize'],
                description: 'Optimization direction ("maximize" if higher is better, "minimize" if lower is better).'
              },
              description: { type: 'string', description: 'Criterion description.' }
            },
            required: ['name']
          }
        }
      },
      required: ['options']
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
            name: 'syran-logic',
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

      try {
        let resultData = null;

        switch (toolName) {
          case 'syran_get_status': {
            const status = getPersonaStatus();
            const directives = getPersonaDirectives();
            resultData = {
              status,
              directives_preview: directives.slice(0, 500) + '...'
            };
            break;
          }

          case 'syran_consult': {
            resultData = consultLogic(args.query, args.premise);
            break;
          }

          case 'syran_analyze_fallacies': {
            resultData = analyzeLogicalFallacies(args.argument);
            break;
          }

          case 'syran_evaluate_probability': {
            resultData = evaluateProbability(args.hypotheses, args.prior);
            break;
          }

          case 'syran_evaluate_tradeoffs': {
            resultData = evaluateArchitecturalTradeoffs(args.options, args.criteria);
            break;
          }

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

        sendJsonRpc({
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(resultData, null, 2)
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
