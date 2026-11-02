# Agent Marketplace

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platforms: Antigravity & Claude Code](https://img.shields.io/badge/Platforms-Antigravity%20%7C%20Claude%20Code-brightgreen.svg)]()
[![Standard: Model Context Protocol](https://img.shields.io/badge/Standard-MCP-purple.svg)](https://modelcontextprotocol.io/)

A universal, cross-platform plugin marketplace and monorepo engineered for **Google Antigravity** and **Anthropic Claude Code**. This repository provides independently deployable plugins, MCP servers, lifecycle hooks, and architectural rules.

---

## 📦 Plugin Catalog

| Plugin | Version | Platforms | Description | Quick Link |
| :--- | :---: | :---: | :--- | :--- |
| **`knowledge-capture`** | `1.0.0` | Antigravity, Claude Code | Advanced multi-layered memory system (Workspace, Local Global Private, and Team Global) with Node.js stdio MCP server, automated candidate elicitation, and Git synchronization. | [`plugins/knowledge-capture/`](./plugins/knowledge-capture/) |
| **`syran-persona`** | `1.0.0` | Antigravity, Claude Code | Adopts the Syran Logic Officer persona globally, providing dispassionate logical analysis, formal precision, and probability-driven counsel. | [`plugins/syran-persona/`](./plugins/syran-persona/) |

---

## 🎯 Which Installation Method is Best for Your Usecase?

| Target Goal / Scenario | Recommended Method | Target Scope | Why this is optimal |
| :--- | :---: | :---: | :--- |
| **"I want all marketplace plugins available and effortlessly kept up to date."** | **Mode 2: Source-Mode (`plugins.json`)** ⭐ | **Global** (`~/.gemini/config/plugins.json`) | Antigravity mounts the entire monorepo directly. When updates are pushed, a simple `git pull` instantly refreshes all plugins with zero file copying. |
| **"I want all marketplace plugins active, but only inside this specific project."** | **Mode 2: Source-Mode (`plugins.json`)** | **Workspace** (`.agents/plugins.json`) | Scopes the entire catalog to the active repository without polluting other workspaces. |
| **"I only need one specific plugin (e.g. `knowledge-capture`) across all my projects."** | **Mode 1: Individual Plugin Copy** | **Global** (`~/.gemini/config/plugins/<id>`) | Installs an isolated, self-contained plugin folder globally without cloning or linking the rest of the monorepo. |
| **"I want a team member to clone my project and have the plugin work immediately without setup."** | **Mode 1: Individual Plugin Copy** | **Workspace** (`.agents/plugins/<id>`) | Bundles the complete plugin directly inside `.agents/plugins/`. When committed to project Git, teammates get the functionality instantly. |
| **"I am using Claude Code as my primary CLI."** | **Claude Marketplace Add** | **Claude Plugin Engine** | Native decentralized marketplace installation with `claude plugin marketplace add`. |

---

## 🚀 Quickstarts

### 🪐 Google Antigravity

Run the universal cross-platform installer wizard in your terminal:

```bash
npx git+https://github.com/sbelal/agent-marketplace.git
```

#### Headless 1-Liners:
```bash
# Add entire monorepo as live plugin source (Global):
npx git+https://github.com/sbelal/agent-marketplace.git --source --scope global

# Install a specific plugin to current workspace (auto-activated):
npx git+https://github.com/sbelal/agent-marketplace.git --plugin knowledge-capture --scope workspace

# Audit and update all installed plugins:
npx git+https://github.com/sbelal/agent-marketplace.git --update all

# Explicitly activate or deactivate a plugin:
npx git+https://github.com/sbelal/agent-marketplace.git --enable knowledge-capture
npx git+https://github.com/sbelal/agent-marketplace.git --disable knowledge-capture
```

📖 **Detailed Antigravity Manual:** See [**`docs/install-antigravity.md`**](./docs/install-antigravity.md) for full walkthroughs, scope options, manual air-gapped installation, and in-session updates.

---

### 🟣 Anthropic Claude Code

Register this repository as a decentralized marketplace in Claude Code:

```bash
# Register marketplace
claude plugin marketplace add https://github.com/sbelal/agent-marketplace.git

# Install plugins
claude plugin install knowledge-capture
claude plugin install syran-persona

# Keep plugins updated
claude plugin update --all
```

📖 **Detailed Claude Code Manual:** See [**`docs/install-claude-code.md`**](./docs/install-claude-code.md) for full commands, configuration options, and slash command reference.

---

## 📂 Repository Structure

```text
agent-marketplace/
├── package.json                              # Universal npm & npx executable manifest
├── bin/                                      # Cross-platform installer & managers
│   ├── install.js                            # Interactive wizard & headless CLI router
│   ├── plugin-manager.js                     # CQS plugin discovery, copier & auditor
│   └── source-manager.js                     # Idempotent plugins.json manipulator
├── docs/                                     # Dedicated platform installation guides
│   ├── install-antigravity.md                # Antigravity installation & update guide
│   └── install-claude-code.md                # Claude Code marketplace guide
├── .claude-plugin/
│   └── marketplace.json                      # Claude Code marketplace catalog
├── .syran/                                   # Architectural governance rules
├── plugins/
│   ├── knowledge-capture/                    # Multi-layer persistent memory plugin
│   │   ├── plugin.json                       # Antigravity manifest
│   │   ├── .claude-plugin/plugin.json        # Claude Code manifest
│   │   ├── mcp_config.json                   # Antigravity MCP configuration
│   │   ├── .mcp.json                         # Claude Code MCP configuration
│   │   ├── hooks.json                        # Antigravity lifecycle hooks
│   │   ├── hooks/hooks.json                  # Claude Code lifecycle hooks
│   │   ├── bin/                              # Setup & sync utilities
│   │   ├── mcp-server/                       # Node.js stdio MCP server (CQS)
│   │   ├── rules/AGENTS.md                   # Elicitation & update rules
│   │   └── skills/                           # Slash command workflows
│   └── syran-persona/                        # Pure logic officer persona plugin
│       ├── plugin.json                       # Antigravity manifest
│       ├── .claude-plugin/plugin.json        # Claude Code manifest
│       ├── mcp_config.json                   # Antigravity MCP configuration
│       ├── .mcp.json                         # Claude Code MCP configuration
│       ├── hooks.json                        # Antigravity lifecycle hooks
│       ├── hooks/hooks.json                  # Claude Code lifecycle hooks
│       ├── bin/session-start.js              # Startup persona context injector
│       ├── mcp-server/                       # Node.js stdio MCP server (CQS logic tools)
│       ├── rules/AGENTS.md                   # Persona rule definition
│       └── skills/                           # Slash command workflows (/syran-consult, /syran-status)
├── LICENSE
└── README.md
```

---

## 🏛️ Architectural Principles

1. **Command-Query Separation (CQS):** All query functions (`get*`, `find*`, `resolve*`) are pure and side-effect free. State mutations and file system writes (`add*`, `install*`, `update*`) are explicit command procedures.
2. **Single Responsibility Principle (SRP):** Each module, skill, and hook does exactly one thing with clear boundaries.
3. **Decoupled User Data:** Plugin updates replace engine code only; user configuration, private Git repositories, and stored memories are never overwritten during updates.

---

## 🤝 Contributing & License

Contributions are welcome. Please ensure all code conforms to the CQS and SRP guidelines described in `.syran/`.
Licensed under the [Apache License 2.0](LICENSE).
