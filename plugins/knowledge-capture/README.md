# Knowledge Capture Plugin

**Knowledge Capture** is an advanced, multi-layered persistent memory plugin engineered for **Google Antigravity** and **Anthropic Claude Code**. It bridges the best practices of Git-backed institutional memory with a zero-dependency Node.js stdio **Model Context Protocol (MCP)** server, automated knowledge elicitation, and human-in-the-loop review guardrails.

---

## 🏛️ Architecture: The 3 Storage Layers

Persistent knowledge is partitioned across three distinct tiers with strict precedence:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Workspace Scoped (.agents/rules/memory/*.md)             │
│    Project-specific rules, domain practices, local APIs     │
└──────────────────────────────┬──────────────────────────────┘
                               │ Overrides Private & Team
┌──────────────────────────────▼──────────────────────────────┐
│ 2. Local Global Private (~/.gemini/knowledge-capture/private)│
│    Personal developer preferences, machine-local learnings   │
│    Version controlled via Git (user's private repository)   │
└──────────────────────────────┬──────────────────────────────┘
                               │ Promoted via PR / Overrides Team
┌──────────────────────────────▼──────────────────────────────┐
│ 3. Team Global (~/.gemini/knowledge-capture/team)           │
│    Shared team standards, platform facts, conventions       │
│    Synchronized via upstream Git repo (Read-Only local)     │
└─────────────────────────────────────────────────────────────┘
```

1. **Workspace Scoped Layer (`.agents/rules/memory/`):** Highest precedence. Scoped to the active repository.
2. **Local Global Private Layer (`~/.gemini/knowledge-capture/private/`):** Middle precedence. Machine-local preferences, debugging solutions, and draft patterns. Overrides Team memory on identical topics (`overrides: <slug>`).
3. **Team Global Layer (`~/.gemini/knowledge-capture/team/`):** Baseline precedence. Verified conventions and architectural decisions shared team-wide. Read-only locally; changes are contributed via branches and Pull Requests.

---

## 🛠️ Model Context Protocol (MCP) Server

The plugin includes a lightweight, zero-dependency Node.js stdio MCP server (`mcp-server/index.js`) providing side-effect-free query tools complying with Command-Query Separation (CQS):

| Tool | Purpose | Parameters |
| :--- | :--- | :--- |
| **`get_memory_summary`** | Scans memory files across layers, parses YAML frontmatters, and outputs a compact Markdown table of `[Layer \| Slug \| Type \| Overrides \| Trigger Description]`. Respects precedence hierarchy. | `layer` (*optional*: `"all"`, `"workspace"`, `"private"`, `"team"`) |
| **`get_layer_statistics`** | Returns memory entry counts per layer, configured Git remotes, working branch states, uncommitted changes, and upstream divergence. | *None* |
| **`get_memory_content`** | Retrieves the full markdown content and YAML frontmatter of a designated memory slug across layers. | `layer` (*required*), `slug` (*required*) |

---

## 🔄 Lifecycle Hooks (`SessionStart`)

Upon starting an Antigravity or Claude Code session, the `SessionStart` hook (`bin/session-start.js`):
1. Reads `settings.json`.
2. Executes non-blocking `git pull --ff-only` on configured remotes (checks for clean working trees and ensures team clone is on `main`).
3. Alerts if the Team clone is on a promotion branch or behind upstream.
4. Audits the Private layer for uncommitted Git modifications.
5. Injects an overview into the agent's context displaying memory counts per layer and alerting on uncommitted changes.

---

## ⚡ Unified Skills & Slash Commands

Knowledge Capture uses a unified, skills-first architecture across Antigravity and Claude Code. Every action is backed by a native skill in `skills/`, eliminating duplicate wrappers.

### User-Facing Skills (`user-invocable: true`)
These skills appear directly in the user's slash command palette:

| Slash Command / Skill | Arguments | Description |
| :--- | :--- | :--- |
| **`/kc-init`** | None | Scaffolds directory layout, tests remote Git connectivity (`git ls-remote`), and configures `settings.json`. |
| **`/kc-status`** | None | Prints detailed health, branch names, uncommitted modifications, and upstream ahead/behind counts for all memory layers. |
| **`/kc-pull`** | `[team\|private\|all]` | Fast-forwards the local team or private memory clone from its configured Git remote upstream. |
| **`/kc-commit`** | `[message]` | Audits private memory for sensitive credentials, validates upstream remotes, commits pending changes, and pushes to Git. |
| **`/kc-promote`** | `[slug]` | Creates an isolated branch (`promote/<date>-<slug>`), scrubs personal context, halts for developer diff inspection, and prepares a GitHub PR. |
| **`/kc-consolidate`**| `[scope]` | Scans memory entries, identifies overlaps, merges related guides into a single slug, and prunes obsolete rules with developer approval. |

### Autonomous Agent-Only Skills (`user-invocable: false`)
These skills are hidden from the user's slash command palette and run autonomously during agent execution:

- **`kc-capture`**: Autonomously evaluates task completions for novel, durable learnings and formulates candidate tables for developer approval.
- **`kc-recall`**: Consults the MCP memory index before complex tasks and fetches relevant guidelines on demand.

---

## 📝 Memory File Schema

```markdown
---
name: k8s-hpa-downscaling
type: platform-fact
description: When configuring horizontal pod autoscalers to prevent aggressive flap
verified: 2026-11-01
overrides: team-hpa-default
---

# Kubernetes HPA Downscaling Stabilization

Prevent pod thrashing during intermittent traffic spikes by specifying a stabilization window.

## Why
Default Kubernetes HPA behaviors scale down replicas rapidly after brief traffic lulls, causing subsequent spikes to hit unready pods.

## How to apply
In your Helm values or Deployment manifest:
```yaml
behavior:
  scaleDown:
    stabilizationWindowSeconds: 300
```

---

## 🚀 Installation & Enablement

### 1. Google Antigravity
Install using the universal cross-platform installer:
```bash
# Install to workspace:
npx git+https://github.com/sbelal/agent-marketplace.git --plugin knowledge-capture --scope workspace

# Or install globally:
npx git+https://github.com/sbelal/agent-marketplace.git --plugin knowledge-capture --scope global
```

### 2. Claude Code
Install from the decentralized marketplace:
```bash
claude plugin marketplace add https://github.com/sbelal/agent-marketplace.git
claude plugin install knowledge-capture
```

---

## 🔒 Privacy & Security Controls

1. **Mandatory Approval on Capture:** Claude/Antigravity will NEVER write memory candidates to disk without explicit developer confirmation in chat.
2. **Local Review Before Promotion:** Team memory changes are staged on a branch (`promote/<date>-<slug>`). The agent stops and gives the developer a local `git diff` command to inspect before opening a PR.
3. **Automated Sanitization:** Promotion scrubs usernames, machine paths (`C:\Users\...`), ticket IDs, and first-person phrasing.
4. **Credential Audit on Commit:** `/kc-commit` checks the diff for tokens, private keys, and passwords before staging or pushing.
