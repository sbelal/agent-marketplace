# Agent Marketplace

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platforms: Antigravity & Claude Code](https://img.shields.io/badge/Platforms-Antigravity%20%7C%20Claude%20Code-brightgreen.svg)]()
[![Standard: Model Context Protocol](https://img.shields.io/badge/Standard-MCP-purple.svg)](https://modelcontextprotocol.io/)

A universal, cross-platform plugin marketplace and monorepo engineered for **Google Antigravity** and **Anthropic Claude Code**. This repository houses independently deployable plugins, MCP servers, lifecycle hooks, and rules.

---

## 📦 Plugin Catalog

| Plugin | Version | Platforms | Description | Directory |
| :--- | :---: | :---: | :--- | :--- |
| **`syran-persona`** | `1.0.0` | Antigravity, Claude Code | Adopts the Syran Logic Officer persona globally, providing dispassionate logical analysis, formal precision, and probability-driven counsel. | [`plugins/syran-persona/`](./plugins/syran-persona/) |
| **`knowledge-capture`** | `1.0.0` | Antigravity, Claude Code | Advanced multi-layered memory system (Workspace, Local Global Private, and Team Global) with Node.js stdio MCP server, automated candidate elicitation, and Git synchronization. | [`plugins/knowledge-capture/`](./plugins/knowledge-capture/) |

---

## 🚀 Installation & Usage

### 1. Claude Code

Register this repository as a plugin marketplace in Claude Code:

```bash
# Add this marketplace
claude plugin marketplace add sbelal/agent-marketplace

# Install plugins from this marketplace
claude plugin install syran-persona
claude plugin install knowledge-capture
```

### 2. Google Antigravity

#### Local Workspace Installation
To enable a plugin for a specific workspace, clone or copy the plugin into your repository's `.agents/plugins/` directory:

```bash
# Example: Add syran-persona to your workspace
mkdir -p .agents/plugins/syran-persona
cp -r /path/to/agent-marketplace/plugins/syran-persona/* .agents/plugins/syran-persona/
```

#### Global Machine Installation
To enable a plugin across all local Antigravity sessions:

```bash
# Windows
mkdir "%USERPROFILE%\.gemini\config\plugins\syran-persona"
xcopy /E /I "plugins\syran-persona" "%USERPROFILE%\.gemini\config\plugins\syran-persona"

# macOS / Linux
mkdir -p ~/.gemini/config/plugins/syran-persona
cp -r plugins/syran-persona/* ~/.gemini/config/plugins/syran-persona/
```

*Note: Restart your Antigravity session after creating or copying a new plugin directory.*

---

## 📂 Repository Structure

```text
agent-marketplace/
├── .claude-plugin/
│   └── marketplace.json                      # Claude Code marketplace catalog
├── .syran/                                   # Architectural governance
│   ├── architectural_principles.md
│   ├── project_architectural_decisions.md
│   ├── coding_conventions.md
│   └── code_review_guidelines.md
├── plugins/
│   ├── syran-persona/                        # Pure logic officer persona plugin
│   │   ├── plugin.json                       # Antigravity manifest
│   │   ├── .claude-plugin/plugin.json        # Claude Code manifest
│   │   ├── README.md                         # Dedicated documentation
│   │   └── rules/
│   │       └── AGENTS.md                     # Persona rule definition (no contractions)
│   └── knowledge-capture/                    # Multi-layer persistent memory plugin
│       ├── plugin.json                       # Antigravity manifest
│       ├── .claude-plugin/plugin.json        # Claude Code manifest
│       ├── README.md                         # Dedicated documentation
│       ├── mcp_config.json                   # Antigravity MCP configuration
│       ├── hooks.json                        # Antigravity lifecycle hooks
│       ├── bin/                              # Hook handlers & setup utilities
│       │   ├── session-start.js
│       │   └── setup.js
│       ├── mcp-server/                       # Node.js stdio MCP server
│       │   ├── index.js
│       │   ├── memory-service.js
│       │   └── package.json
│       ├── rules/
│       │   └── AGENTS.md                     # Task completion capture elicitation
│       └── skills/                           # Slash command workflows
│           ├── kc-init/
│           ├── kc-commit/
│           └── kc-promote/
├── LICENSE
└── README.md
```

---

## 🏛️ Architectural Principles

1. **Independent Packaging:** Every plugin functions as an autonomous unit with its own manifest, documentation, and dependencies.
2. **Command-Query Separation (CQS):** MCP tools and inspection routines are strictly side-effect-free queries; filesystem updates and Git operations are explicit commands.
3. **Resilient Persistence:** Systems degrade gracefully to local offline storage when remote Git repositories are not configured.

---

## 🤝 Contributing

Contributions are welcome. All new plugins must adhere to Command-Query Separation (CQS), include automated tests or validation scripts, and provide both Antigravity and Claude Code manifests.
