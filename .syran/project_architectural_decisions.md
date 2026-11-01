# ⚙️ Project-Specific Decisions

This document lists the concrete, actionable rules and conventions for the `antigravity-plugins` monorepo.

---
### Decision 1: Monorepo Directory Organization

* **Reason:** To adhere to the Antigravity plugin specification while maintaining a clean monorepo layout for multiple plugins.
* **Layout:**
    * Root directory contains shared development files, license, and repository-wide documentation.
    * `plugins/` directory houses each distinct plugin bundle:
      * `plugins/syran-persona/`: Syran persona bundle without external tools.
      * `plugins/knowledge-capture/`: Multi-layered knowledge capture plugin with MCP server, hooks, and skills.
* **Example:**
    ```text
    antigravity-plugins/
    ├── README.md
    └── plugins/
        ├── syran-persona/
        │   ├── plugin.json
        │   ├── README.md
        │   └── rules/
        │       └── AGENTS.md
        └── knowledge-capture/
            ├── plugin.json
            ├── README.md
            ├── mcp_config.json
            ├── hooks.json
            ├── mcp-server/
            └── skills/
    ```

---
### Decision 2: Multi-Layer Memory Boundaries & Storage Paths

* **Reason:** To clearly separate local workspace-scoped context, local user global memory, and shared team memory.
* **Storage Mapping:**
    * Layer 1 (Workspace Scoped): In-repository `.agents/` or `.gemini/` path.
    * Layer 2 (Local Global Private): `~/.gemini/knowledge-capture/private`
    * Layer 3 (Team Global): `~/.gemini/knowledge-capture/team`
* **Configuration:** `~/.gemini/knowledge-capture/settings.json` stores repository URLs for Layer 2 and Layer 3 git synchronization.

---
### Decision 3: MCP Server Runtime for Markdown Metadata Parsing

* **Reason:** To provide efficient, on-demand scanning and parsing of memory markdown files across filesystem boundaries without polluting the agent's main execution loop.
* **Specification:** Stdio-based MCP server providing inspection tools (e.g., scanning frontmatter for slugs and trigger descriptions, formatting markdown summaries, and reporting layer statistics).
---
