# Agent Marketplace Architectural Principles & Governance

This repository enforces strict software engineering principles to ensure all plugins, MCP servers, and tooling remain maintainable, robust, and portable across Google Antigravity and Anthropic Claude Code.

---

## 1. Command-Query Separation (CQS)

Every function, tool, and service must strictly adhere to Command-Query Separation:
* **Queries:**
  - Prefixed with `get*`, `find*`, `resolve*`, `is*`, `check*`.
  - Pure, side-effect free, idempotent, and deterministic.
  - Return data, metrics, or evaluations without modifying filesystem, git, or process states.
* **Commands:**
  - Prefixed with `add*`, `install*`, `save*`, `update*`, `remove*`, `sync*`, `delete*`.
  - Mutate state explicitly.
  - Return operational status (`{ success: true, ... }`), never hidden state mutations inside query functions.

---

## 2. Single Responsibility Principle (SRP)

* Each module or file must have one well-defined responsibility.
* Business logic, storage path calculations, and filesystem I/O are decoupled.
* Persona directives (`syran-persona`) must never bleed into generic infrastructure or utility plugins (`knowledge-capture`).

---

## 3. Decoupled User Data & Non-Destructive Upgrades

* Upgrading a plugin updates engine code only (`skills/`, `rules/`, `mcp-server/`, `bin/`).
* User configuration, personal notes, Git clone remotes, and memory entries reside in dedicated user directories outside the plugin package (e.g. `~/.gemini/knowledge-capture/` and `.agents/rules/memory/`).
* Plugin updates never overwrite, delete, or reset user state.

---

## 4. Cross-Platform Compatibility

All plugins must execute seamlessly across:
1. **Google Antigravity:** Declarative `plugins.json`, native `ask_question` interactive choice tools, and stdio MCP servers.
2. **Anthropic Claude Code:** Standard `.claude-plugin/plugin.json`, `.mcp.json`, and lifecycle hooks.
3. **Platform Hook Limits:** Stdout from lifecycle hooks must stay strictly under 9,500 characters to prevent Claude Code truncation.
