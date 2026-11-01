# Knowledge Capture Plugin

**Knowledge Capture** is an advanced, multi-layered persistent memory plugin engineered for **Google Antigravity** and **Anthropic Claude Code**. It extends the native `/learn` paradigm with hierarchical storage scopes, automated candidate elicitation upon task completion, a zero-dependency Node.js stdio MCP server, and Git synchronization.

---

## 🏛️ Architecture: The 3 Storage Layers

Persistent knowledge is partitioned across three distinct tiers:

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. Workspace Scoped (.agents/rules/memory/*.md)             │
│    Project-specific rules, domain practices, local APIs     │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│ 2. Local Global Private (~/.gemini/knowledge-capture/private)│
│    Personal developer preferences, machine-local learnings   │
│    Version controlled via Git (user's private repository)   │
└─────────────────────────────────────────────────────────────┘
                              │  /kc-promote (Move or Split)
                              ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Team Global (~/.gemini/knowledge-capture/team)           │
│    Shared team standards, sanitized patterns, conventions   │
│    Version controlled via Git (team repository)             │
└─────────────────────────────────────────────────────────────┘
```

1. **Workspace Scoped Layer (`.agents/rules/memory/`):**
   * Stored in the active repository.
   * Antigravity discovers this directory hierarchically as active rules; no custom indexing is needed.
2. **Local Global Private Layer (`~/.gemini/knowledge-capture/private/`):**
   * Machine-local developer notes, personal debugging solutions, and custom workflows.
   * Persisted locally and synchronized with a private Git repository when configured.
3. **Team Global Layer (`~/.gemini/knowledge-capture/team/`):**
   * Generalized guidelines and engineering decisions intended for team-wide sharing.
   * Synchronized with a shared team Git repository.

---

## ⚙️ Configuration (`settings.json`)

The configuration file is located at `~/.gemini/knowledge-capture/settings.json`:

```json
{
  "privateRepoUrl": "https://github.com/username/my-private-memory.git",
  "teamRepoUrl": "https://github.com/team-org/shared-team-memory.git"
}
```

### Graceful Degradation (Offline / Unversioned)
* If `settings.json` is missing or repository URLs are blank, the **Private layer remains completely functional** on the local filesystem.
* Git pulls and sync operations are bypassed gracefully without throwing fatal errors or blocking the agent loop.

---

## 🛠️ Model Context Protocol (MCP) Server

The plugin includes a lightweight, zero-dependency Node.js stdio MCP server (`mcp-server/index.js`) providing side-effect-free query tools complying with Command-Query Separation (CQS):

| Tool | Purpose | Parameters |
| :--- | :--- | :--- |
| **`get_memory_summary`** | Scans memory files across layers, parses YAML frontmatters, and outputs a compact Markdown table of `[slug \| trigger description]`. | `layer` (*optional*: `"all"`, `"workspace"`, `"private"`, `"team"`) |
| **`get_layer_statistics`** | Returns memory file counts per layer, configuration status, and uncommitted Git changes warnings. | *None* |
| **`get_memory_content`** | Retrieves the full markdown content and YAML frontmatter of a designated memory slug across layers. | `layer` (*required*), `slug` (*required*) |

---

## 🔄 Lifecycle Hooks (`SessionStart`)

Upon starting a new Antigravity session, the `SessionStart` hook (`bin/session-start.js`):
1. Reads `settings.json`.
2. Executes non-blocking `git pull` on configured private and team remotes.
3. Audits the Private layer for uncommitted Git modifications.
4. Injects an overview into the agent's context displaying memory counts per layer and alerting on uncommitted changes.

---

## 💡 End-of-Task Knowledge Elicitation

Upon concluding any non-trivial coding task or architectural update:
1. The agent evaluates the turn for reusable insights (framework workarounds, design patterns, user preferences).
2. The agent formulates candidates with standardized YAML frontmatter (`slug`, `trigger`, `description`).
3. The agent outputs a candidate selection table in chat.
4. **Mandatory Approval Halt:** The agent halts and awaits the user's explicit consent to add all or specific candidates to the Private layer.
5. **Safe Local Persistence:** Files are written to the local filesystem only. **No automatic Git commit occurs.**

---

## ⚡ Slash Commands

| Command | Purpose |
| :--- | :--- |
| **`/kc-init`** | Scaffolds `~/.gemini/knowledge-capture/` directories, generates `settings.json`, and links Git remotes. |
| **`/kc-commit`** | Audits uncommitted files in the Private layer, proposes a structured commit message, commits changes, and executes `git push` if a remote Git URL is configured. |
| **`/kc-promote`** | Scans private memories, generalizes team-relevant patterns, and executes a **Move** (deleting the private file) or a **Split** (publishing team rules to `team/` and retaining personal context in `private/`). |

---

## 🚀 Installation

### 1. Claude Code
```bash
claude plugin install knowledge-capture
```

### 2. Google Antigravity

#### Global Machine Installation
**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force "$HOME\.gemini\config\plugins\knowledge-capture"
Copy-Item -Recurse -Force "plugins\knowledge-capture\*" "$HOME\.gemini\config\plugins\knowledge-capture\"
```

**macOS / Linux:**
```bash
mkdir -p ~/.gemini/config/plugins/knowledge-capture
cp -r plugins/knowledge-capture/* ~/.gemini/config/plugins/knowledge-capture/
```

*Note: Restart your Antigravity session after installing to mount MCP tools and lifecycle hooks.*
