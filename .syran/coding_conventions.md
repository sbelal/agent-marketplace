# ⚙️ Project Coding Conventions

This document outlines coding conventions and standards for all plugins in `antigravity-plugins`.

---
### Convention 1: Modularity and Decomposition

* Scripts, MCP handlers, and hook utilities must be broken into atomic, single-purpose functions.
* **Reason:** Ensures maintainability, testability, and clarity.

---
### Convention 2: Strict CQS Implementation

* Query functions must be prefixed with `get`, `find`, `resolve`, or `calculate` and must return values without side effects.
* Command functions must be prefixed with `ensure`, `save`, `sync`, `commit`, or `update` and visibly orchestrate state modifications.
* **Reason:** Prevents hidden side effects during memory inspection and file traversal.

---
### Convention 3: Strict Persona Directives

* All Syran persona rules must strictly prohibit contractions and maintain formal, dispassionate language.
* Persona rules must enforce fact-based, probabilistic communication.
---
