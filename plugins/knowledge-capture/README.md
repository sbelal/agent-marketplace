# Knowledge Capture Plugin

**Knowledge Capture** is an advanced, multi-layered persistent memory plugin engineered for **Google Antigravity** and **Anthropic Claude Code**. It bridges the best practices of Git-backed institutional memory with a zero-dependency Node.js stdio **Model Context Protocol (MCP)** server, automated knowledge elicitation, proactive recall, and an interactive visual Memory Studio.

> **System Requirement:** Requires **Node.js >= 20.0.0** (LTS). Features zero-dependency SQLite FTS5 hybrid search with an automatic file-based indexing fallback.

---

## 🚀 Installation & Setup

### Step 1: Install the Plugin

#### Google Antigravity
Install using the universal cross-platform installer:
```bash
# Install to workspace (.agents/):
npx git+https://github.com/sbelal/agent-marketplace.git --plugin knowledge-capture --scope workspace

# Or install globally (~/.gemini/config/):
npx git+https://github.com/sbelal/agent-marketplace.git --plugin knowledge-capture --scope global
```

#### Claude Code
Install from the decentralized marketplace:
```bash
claude plugin marketplace add https://github.com/sbelal/agent-marketplace.git
claude plugin install knowledge-capture
```

---

### Step 2: Initialize Storage & Git Remotes (`/kc-init`)

Immediately after installing, run the initialization command in your chat session or terminal:
```text
/kc-init
```
*(Or via CLI: `node ./bin/setup.js`)*

The initialization wizard scaffolds your local directories and optionally configures your Git remotes (`settings.json`) for personal and team knowledge stores.

#### 💡 Why Run `/kc-init`? (Configured Remotes vs. Local-Only Mode)

Knowledge Capture works out-of-the-box in local-only mode, but configuring Git remotes unlocks the full power of multi-layer persistent memory:

| Capability | Configured with `/kc-init` ⭐ *(Recommended)* | Without Setup (Local-Only Default) |
| :--- | :--- | :--- |
| **Cross-Machine Sync** | ✅ Private memories sync across all your laptops and workstations via Git (`/kc-commit` & auto-pull). | ❌ Memories stay trapped on the single local machine where they were captured. |
| **Remote Agents & Cloud VMs** | ✅ Remote agent VMs clone and pull your private memory store automatically upon session start. | ⚠️ Remote agent VMs only see project workspace files; cannot access your personal memories. |
| **Team Knowledge Sharing** | ✅ Automatically pulls organization-wide conventions and platform standards from your team repo. | ❌ Team memory directory remains unlinked and empty. |
| **Team Promotion (`/kc-promote`)**| ✅ Create isolated branches (`promote/<slug>`) and open GitHub Pull Requests directly to the team store. | ❌ Promotion unavailable without a configured upstream team repository. |
| **Automatic Startup Pulls** | ✅ Non-blocking fast-forward on session start ensures you never code against outdated team standards. | ⚠️ Skipped during startup (operates in offline local mode). |

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
│ 3. Team Global (~/.gemini/knowledge-capture/team/<slug>)    │
│    Shared team standards, platform facts, conventions       │
│    Multi-team repos partitioned by slug (<org_id>-<repo>)   │
│    Synchronized via upstream Git remotes (Read-Only local)  │
└─────────────────────────────────────────────────────────────┘
```

1. **Workspace Scoped Layer (`.agents/rules/memory/`):** Highest precedence. Scoped to the active repository.
2. **Local Global Private Layer (`~/.gemini/knowledge-capture/private/`):** Middle precedence. Machine-local preferences, debugging solutions, and draft patterns. Overrides Team memory on identical topics (`overrides: <slug>`).
3. **Team Global Layer (`~/.gemini/knowledge-capture/team/<slug>/`):** Baseline precedence. Verified conventions and architectural decisions shared team-wide across one or more team repositories (e.g. `core`, `platform`, `infra`). Slugs are auto-derived as `<org_id>-<repo_slug>` or `<account_id>-<repo_slug>` from Git URLs. Read-only locally; changes are contributed via branches and Pull Requests.

---

## 🛠️ Model Context Protocol (MCP) Server

The plugin includes a lightweight, zero-dependency Node.js stdio **Model Context Protocol (MCP)** server (`mcp-server/index.js`) providing side-effect-free query tools and state commands complying with Command-Query Separation (CQS). Powered by a **workspace-partitioned SQLite FTS5 engine** with automatic zero-dependency **file-based fallback**:

| Tool | Purpose | Parameters |
| :--- | :--- | :--- |
| **`get_memory_summary`** | Scans memory files across layers, parses YAML frontmatters, shadows lower-tier overridden rules (`Workspace > Private > Team`), and outputs Markdown tables or compact index cards (~15 tokens/rule). | `layer` (*optional*: `"all"`, `"workspace"`, `"private"`, `"team"`), `domain` (*optional*), `query` (*optional*), `format` (*optional*: `"standard"`, `"compact"`) |
| **`search_memories`** | Multi-Vector hybrid semantic retrieval combining workspace-partitioned SQLite FTS5 BM25 with multi-facet dense embeddings (fused via Reciprocal Rank Fusion). Pure read query complying with CQS. Supports compact index cards and full body expansion. | `query` (*required* string), `limit` (*optional* number, default 5), `mode` (*optional*: `"hybrid"`, `"multi_vector"`, `"lexical"`), `format` (*optional*: `"compact"`, `"full"`) |
| **`get_layer_statistics`** | Returns memory entry counts per layer, active domain breakdown, stale entry counts (`verified` > 180 days or missing), multi-team repository status, and uncommitted changes. | *None* |
| **`get_memory_content`** | Retrieves full markdown content, frontmatter, and resolved **1-Hop Related Memories Graph** footer for one or more memory slugs across layers. | `layer` (*optional*), `slug` (*optional* string), `slugs` (*optional* `string[]`) |
| **`get_memory_graph`** | Returns referentially validated node-and-link graph dataset with broken link isolation for D3/SVG canvas rendering. | *None* |
| **`generate_knowledge_graph_html`** | Generates the Bidirectional Memory Studio: a complete, interactive standalone HTML canvas visualizer with D3.js force physics, Connect Mode (edge drawing), Quick Edit Drawer, and Staged Patch export. Runs 100% client-side in the browser. | `workspaceRoot` (*optional*) |
| **`manage_team_repositories`** | Manages multi-team knowledge repositories by slug. Supports registering, activating, deactivating, removing, and pulling team repos. | `action` (*required*: `"list"`, `"add"`, `"activate"`, `"deactivate"`, `"remove"`, `"sync"`), `slug` (*optional*), `url` (*optional*), `name` (*optional*), `cleanDisk` (*optional* boolean) |
| **`bootstrap_workspace_memories`**| Scans repository ADRs, CI workflows, linters, Dockerfiles, and documentation to discover and propose initial Workspace memory rules on day one. | `workspaceRoot` (*optional*) |
| **`auto_elicit_session_knowledge`**| Audits uncommitted working tree diffs and modified files to detect and propose session-end memory candidates before closing a session or compacting context. | `workspaceRoot` (*optional*) |
| **`detect_contradictions_and_drift`**| Audits active memories for semantic contradictions (opposing directives on similar tasks) and codebase drift (missing referenced files, runtime engine mismatches, staleness). | `workspaceRoot` (*optional*), `domain` (*optional*), `threshold` (*optional*) |
| **`proactive_memory_probe`** | Zero-turn pre-flight probe evaluating user prompts against memory triggers in < 5ms to surface immediate guidance cards. | `query` (*required* string), `threshold` (*optional* number), `limit` (*optional* number) |
| **`mine_git_history_memories`** | Tacit knowledge archeology scanning Git commits, reverts, and bug fixes for undocumented gotchas. | `maxCommits` (*optional* number) |
| **`record_memory_efficacy`** | Records verification feedback and efficacy telemetry for memory rules (`test_pass`, `test_fail`). | `slug` (*required* string), `feedbackType` (*required* string), `details` (*optional* object) |

---

## 🔄 Lifecycle Hooks (`SessionStart` & `SessionEnd`)

1. **`SessionStart` (`bin/session-start.js`):**
   - Reads `settings.json`.
   - Executes non-blocking `git pull --ff-only` on configured private and active team remotes with strict network/SSH guards (`timeout: 3000` ms, `GIT_TERMINAL_PROMPT=0`, `GIT_SSH_COMMAND="ssh -o BatchMode=yes -o ConnectTimeout=3"`).
   - Alerts if a Team clone is on a promotion branch or behind upstream, or if entries are stale (`verified` > 180 days).
   - Audits the Private layer for uncommitted Git modifications.
   - Injects memory counts per layer, active domain breakdown, and operational recall/capture directives into session context.

2. **`SessionEnd` Sentinel (`bin/session-end.js`):**
   - Fires exclusively upon session wrap-up / termination (mapped to `SessionEnd` to eliminate alert fatigue during normal user interrupts).
   - Audits uncommitted workspace modifications.
   - If files were changed without new memory recorded, injects an auto-elicitation reminder prompting the agent to preserve tacit decisions via `/kc-elicit` or `/kc-capture`.

---

## ⚡ Unified Skills & Slash Commands

Knowledge Capture uses a unified, skills-first architecture across Antigravity and Claude Code. Every action is backed by a native skill in `skills/`, eliminating duplicate wrappers.

### User-Facing Skills (`user-invocable: true`)
These skills appear directly in the user's slash command palette:

| Slash Command / Skill | Arguments | Description |
| :--- | :--- | :--- |
| **`/kc-init`** | None | Scaffolds directory layout, tests remote Git connectivity (`git ls-remote`), and configures multi-team repositories and private stores in `settings.json`. |
| **`/kc-bootstrap`** | None | Scans project ADRs, CI workflows, linters, Dockerfiles, and contribution guides to auto-discover and bootstrap Workspace memory rules. |
| **`/kc-elicit`** | None | Audits uncommitted workspace diffs to auto-synthesize and propose session-end memories before closing. |
| **`/kc-drift`** | `[domain]` | Runs the Semantic Contradiction & Codebase Drift Detection Engine across memories to discover conflicting directives and outdated rules. |
| **`/kc-graph`** | None | Generates the interactive Bidirectional Memory Studio HTML canvas with D3 force physics, Connect Mode (edge drawing), and Quick Edit Drawer. |
| **`/kc-status`** | None | Prints detailed health, active domain breakdown, stale entry counts (`verified` > 180 days), multi-team repository status, and uncommitted modifications across layers. |
| **`/kc-pull`** | `[team\|private\|all\|<slug>]` | Fast-forwards the local private store or configured team memory repositories from their remote upstreams. |
| **`/kc-commit`** | `[message]` | Audits private memory for sensitive credentials, validates upstream remotes, commits pending changes, and pushes to Git. |
| **`/kc-promote`** | `[slug]` | Creates an isolated branch (`promote/<date>-<slug>`), scrubs personal context, halts for developer diff inspection, and prepares a GitHub PR. |
| **`/kc-archeology`** | `[maxCommits]` | Mines Git history, revert commits, and bug fixes to discover undocumented tacit knowledge and workarounds. |
| **`/kc-consolidate`**| `[scope\|domain]` | Runs a 4-point **"Lint & Dream"** pass: merges fragmented/co-triggered slugs, prunes orphaned overrides or redundant private copies, repairs broken `related` graph links, and refreshes stale (>180d) or conflicting entries. |
| **`/kc-update`** | None | Audits upstream releases and safely executes autonomous plugin updates across source and copy install modes. |

---

## 🖥️ User-Invokable CLI Scripts & Flags

For automation, headless CI runs, or terminal workflows:

- **`node ./bin/setup.js`**: Setup & initialization utility:
  - `--private-url <url>`: Configure personal private memory repository URL.
  - `--team-repo-url <url>`: Configure team shared repository URL (auto-derives slug as `<org_id>-<repo_slug>` if omitted).
  - `--team-repo-slug <slug>`: Explicit slug identifier for the team repository.
  - `--activate-team <slug>`: Activate an existing team repository.
  - `--deactivate-team <slug>`: Deactivate an existing team repository.
  - `--remove-team <slug>`: Remove a team repository configuration.
  - `--embedding-engine <onnx|heuristic>`: Configure semantic vector embedding engine (`onnx` 384-d or `heuristic` 128-d).
  - `--no-install`: Skip automatic dependency installation.
- **`node ./bin/status.js`**: Prints formatted memory statistics, domain breakdowns, and Git health directly to stdout.
- **`node ./bin/pull.js [team|private|all|<slug>]`**: Fast-forwards local Git clones from remote upstreams.
- **`node ./bin/sync-manifests.js [--check]`**: Synchronizes plugin manifests and validates zero configuration drift across Antigravity and Claude Code.

---

## 🎨 Interactive Memory Studio Architecture (How the UI is Loaded)

The **Bidirectional Memory Studio** (`/kc-graph`) is engineered with a **100% self-contained client-side web architecture**:
- **Zero Local Server Daemon:** The MCP server does **NOT** run an HTTP or WebSocket server. MCP operates strictly over standard stdio JSON-RPC 2.0.
- **Standalone Artifact Generation:** The MCP tool `generate_knowledge_graph_html` (or skill `/kc-graph`) outputs a self-contained HTML file containing embedded SVG layout styles, inlined graph data JSON, and client-side JavaScript bundle using D3.js.
- **Direct Browser / Webview Execution:** The generated file (`knowledge-graph.html`) is written to the agent artifact directory (`<appDataDir>/brain/<conversation-id>/knowledge-graph.html`) and bookmarked as a user-facing deliverable. The IDE preview pane or web browser opens the file directly via `file://`.
- **In-Browser Physics & Interactions:** Draggable node physics, live search filtering, domain cluster pills, the Connect Mode edge drawer, and the Quick Edit inspector drawer run **entirely inside the browser's JavaScript engine alone**. Staged edge additions and metadata updates are exported from the browser as structured JSON patches.

### Autonomous Agent-Only Skills (`user-invocable: false`)
These skills are hidden from the user's slash command palette and run autonomously during agent execution:

- **`kc-capture` (Full-Envelope Repurposing & Co-Triggered Defragmentation):**
  - Always runs a mandatory `get_memory_summary(layer="all")` pre-scan before proposing candidates.
  - Prioritizes **Full-Envelope Repurposing** (`EXTEND` / `REPURPOSE-SLUG` / `MERGE`) over creating fragmented sibling files or blindly appending body paragraphs—evolving the **slug** (`old-slug -> new-slug`), expanding the **trigger description** (`description:`), and synthesizing the **Markdown body** together.
  - Performs **Co-Triggered Fragmentation Detection** during candidate determination: if 2+ memories from the same `domain` or layer were recalled together during the session (or address tightly coupled facets of one concept in the index), proposes merging them (`MERGE`) into a single unified guide with an expanded trigger description.
  - Automatically re-wires `related: [...]` and `overrides:` references across `Workspace` and `Private` when renaming/merging a slug (or sets `overrides: <team-slug>` in `Private` when expanding a read-only `Team` rule).
- **`kc-recall` (Domain Filtering & 1-Hop Graph Traversal):**
  - Consults `get_memory_summary` (with optional `domain` and `query` filters) before complex tasks and traverses the 1-hop `Related Memories Available` footer returned by `get_memory_content` with zero mid-task token overhead.

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

## 🔒 Privacy & Security Controls

1. **Mandatory Approval on Capture:** Claude/Antigravity will NEVER write memory candidates to disk without explicit developer confirmation in chat.
2. **Local Review Before Promotion:** Team memory changes are staged on a branch (`promote/<date>-<slug>`). The agent stops and gives the developer a local `git diff` command to inspect before opening a PR.
3. **Automated Sanitization:** Promotion scrubs usernames, machine paths (`C:\Users\...`), ticket IDs, and first-person phrasing.
4. **Credential Audit on Commit:** `/kc-commit` checks the diff for tokens, private keys, and passwords before staging or pushing.
