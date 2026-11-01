# 🏛️ Architectural Guiding Principles

This document outlines the high-level architectural principles for the `antigravity-plugins` monorepo. All plugins and scripts within this repository must adhere to these guidelines.

---
### Principle 1: Modular Monorepo Architecture

* **Rationale:** Each plugin must function as an independent, self-contained unit capable of distribution, installation, and lifecycle management without hard dependencies on other plugins in the repository.
* **Implications:**
    * Every plugin resides in its own isolated directory under `plugins/<plugin-name>/`.
    * Each plugin must include its own manifest (`plugin.json`), user-facing documentation (`README.md`), and optional components (`skills/`, `rules/`, `hooks.json`, `mcp_config.json`).
    * Plugins must not cross-reference private files from sibling plugin directories.

---
### Principle 2: Command-Query Separation (CQS) & Single Responsibility Principle (SRP)

* **Rationale:** Separating state queries from side-effect-bearing commands ensures predictable execution, testability, and clear lifecycle boundaries.
* **Implications:**
    * Query operations (e.g., `resolve*`, `get*`, `calculate*`, `find*`) must be pure calculation functions that never mutate file systems, trigger network requests, or modify git states.
    * State mutations and configuration changes (e.g., `ensure*`, `commit*`, `sync*`, `promote*`) must be explicit command routines called visibly at lifecycle boundaries.
    * Transport protocols (such as MCP stdio communication) must remain decoupled from domain logic.

---
### Principle 3: Graceful Degradation and Resilient Persistence

* **Rationale:** Customizations must operate seamlessly across varied environments, including offline usage or setups lacking remote git synchronization.
* **Implications:**
    * Memory and configuration systems must function locally even if remote git repositories are unspecified or unreachable.
    * Absence of remote URLs degrades gracefully to local filesystem persistence without raising fatal runtime errors.
---
