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
| **`get_memory_summary`** | Scans memory files across layers, parses YAML frontmatters, shadows lower-tier overridden rules (`Workspace > Private > Team`), and outputs Markdown tables grouped by `### Domain: <domain>` (`[Layer \| Slug \| Type \| Overrides \| Related \| Trigger / Description]`). | `layer` (*optional*: `"all"`, `"workspace"`, `"private"`, `"team"`), `domain` (*optional* category filter), `query` (*optional* keyword filter) |
| **`get_layer_statistics`** | Returns memory entry counts per layer, active domain breakdown (`kubernetes (12), ...`), stale entry counts (`verified` > 180 days or missing), configured Git remotes, working branch states, uncommitted changes, and upstream divergence. | *None* |
| **`get_memory_content`** | Retrieves the full markdown content, YAML frontmatter, and resolved **1-Hop Related Memories Graph** footer for one or more memory slugs across layers. | `layer` (*optional*: `"all"`, `"workspace"`, `"private"`, `"team"`), `slug` (*optional* string), `slugs` (*optional* `string[]`) |

---

## 🔄 Lifecycle Hooks (`SessionStart`)

Upon starting an Antigravity or Claude Code session, the `SessionStart` hook (`bin/session-start.js`):
1. Reads `settings.json`.
2. Executes non-blocking `git pull --ff-only` on configured remotes with strict network/SSH guards (`timeout: 3000` ms, `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=3"`) so offline sessions never hang.
3. Alerts if the Team clone is on a promotion branch or behind upstream, or if entries are stale (`verified` > 180 days).
4. Audits the Private layer for uncommitted Git modifications.
5. Injects an overview into the agent's context displaying memory counts per layer, active domain breakdown, staleness counts, and an **Operational Recall & Capture Directive** enforcing pre-task `kc-recall` (with co-retrieval detection) and post-task `kc-capture` (with Full-Envelope Repurposing).

---

## ⚡ Unified Skills & Slash Commands

Knowledge Capture uses a unified, skills-first architecture across Antigravity and Claude Code. Every action is backed by a native skill in `skills/`, eliminating duplicate wrappers.

### User-Facing Skills (`user-invocable: true`)
These skills appear directly in the user's slash command palette:

| Slash Command / Skill | Arguments | Description |
| :--- | :--- | :--- |
| **`/kc-init`** | None | Scaffolds directory layout, tests remote Git connectivity (`git ls-remote`), and configures `settings.json`. |
| **`/kc-status`** | None | Prints detailed health, active domain breakdown, stale entry counts (`verified` > 180 days), branch names, uncommitted modifications, and upstream ahead/behind counts across layers. |
| **`/kc-pull`** | `[team\|private\|all]` | Fast-forwards the local team or private memory clone from its configured Git remote upstream. |
| **`/kc-commit`** | `[message]` | Audits private memory for sensitive credentials, validates upstream remotes, commits pending changes, and pushes to Git. |
| **`/kc-promote`** | `[slug]` | Creates an isolated branch (`promote/<date>-<slug>`), scrubs personal context, halts for developer diff inspection, and prepares a GitHub PR. |
| **`/kc-consolidate`**| `[scope\|domain]` | Runs a 4-point **"Lint & Dream"** pass: merges fragmented/co-triggered slugs, prunes orphaned overrides or redundant private copies, repairs broken `related` graph links, and refreshes stale (>180d) or conflicting entries. |

### Autonomous Agent-Only Skills (`user-invocable: false`)
These skills are hidden from the user's slash command palette and run autonomously during agent execution:

- **`kc-capture` (Full-Envelope Repurposing):**
  - Always runs a mandatory `get_memory_summary(layer="all")` pre-scan before proposing candidates.
  - Prioritizes **Full-Envelope Repurposing** (`EXTEND` / `REPURPOSE-SLUG` / `MERGE`) over creating fragmented sibling files or blindly appending body paragraphs—evolving the **slug** (`old-slug -> new-slug`), expanding the **trigger description** (`description:`), and synthesizing the **Markdown body** together.
  - Automatically re-wires `related: [...]` and `overrides:` references across `Workspace` and `Private` when renaming a slug (or sets `overrides: <team-slug>` in `Private` when expanding a read-only `Team` rule).
- **`kc-recall` (1-Hop Graph & Co-Retrieval Consolidation Detection):**
  - Consults `get_memory_summary` (with optional `domain` and `query` filters) before complex tasks and traverses the 1-hop `Related Memories Available` footer returned by `get_memory_content`.
  - Monitors for **Co-Retrieval Fragmentation**: when 2+ memories from the same `domain` or layer co-trigger for a single task, holds a note until task wrap-up and proactively offers to merge and repurpose them into a single unified guide.

---

## 📝 Memory File Schema

Every memory entry remains a flat `<slug>.md` file within its layer directory (preserving deterministic `overrides` and `related` resolution). Existing `.md` files without `domain` or `related` remain 100% backward-compatible and default to `domain: "general"` and `related: []`.

```markdown
---
name: k8s-hpa-scaling-governance
type: platform-fact
domain: kubernetes
description: When configuring horizontal pod autoscalers, stabilization windows, or PodDisruptionBudget scaling alignment
verified: 2026-11-01
overrides: team-hpa-default
related: [k8s-pdb-configuration, helm-values-schema]
---

# Kubernetes HPA Scaling & Stabilization Governance

Prevent pod thrashing during intermittent traffic spikes by specifying a stabilization window and aligning replica floors with PodDisruptionBudgets.

## Why
Default Kubernetes HPA behaviors scale down replicas rapidly after brief traffic lulls, causing subsequent spikes to hit unready pods or violate PDB budgets during node drains.

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
