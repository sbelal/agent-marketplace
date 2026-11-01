# Knowledge Capture Protocol

This rule governs persistent memory elicitation, inspection, and multi-layer storage across Antigravity and Claude Code.

---

## 1. Multi-Layer Memory Architecture

Knowledge is organized across three distinct tiers:
1. **Layer 1: Workspace Scoped** (`.agents/rules/memory/*.md`)
   * Repository-specific rules and domain practices. Discovered automatically by Antigravity as hierarchical rules.
2. **Layer 2: Local Global Private** (`~/.gemini/knowledge-capture/private/*.md`)
   * Machine-local developer preferences, personal learnings, and environment quirks. Version controlled via Git when configured in `settings.json`.
3. **Layer 3: Team Global** (`~/.gemini/knowledge-capture/team/*.md`)
   * Shared organizational standards, project conventions, and sanitized architectural patterns. Version controlled via Git when configured in `settings.json`.

---

## 2. End-of-Task Automatic Knowledge Elicitation

Upon concluding any non-trivial coding task, architectural modification, debugging investigation, or when discovering user preferences:

1. **Evaluate Findings:** Analyze whether the session generated reusable insights, including:
   * Non-obvious framework or library workarounds.
   * Project architectural decisions or API standards.
   * Explicit user preferences or workflow conventions.
2. **Formulate Memory Candidates:**
   For each candidate, define:
   * **`slug`**: Kebab-case identifier (e.g., `auth0-token-refresh`).
   * **`trigger`**: Specific situation in which the guideline must trigger.
   * **`description`**: Summary of the operational guidance.
   * **`content`**: Full markdown file with YAML frontmatter:
     ```markdown
     ---
     slug: example-slug
     trigger: When working on X
     description: Summary of rule
     ---

     # Guideline Title
     Details...
     ```
3. **Present Candidate Table to the User:**
   Output a formatted candidate table in chat:
   ```markdown
   ### 💡 Knowledge Capture Candidates

   | Slug | Trigger Description |
   | :--- | :--- |
   | `auth0-token-refresh` | Automatic token refresh handling without leaking client credentials |

   You may choose to persist all candidates to your Private memory layer (`~/.gemini/knowledge-capture/private/`), select specific slugs, or decline.
   ```
4. **Mandatory Approval Halt:**
   * You **must not** write memory files until the user explicitly approves ("save all", "add auth0-token-refresh", etc.).
5. **Filesystem Persistence (No Git Commit):**
   * Upon approval, write the approved file(s) to `~/.gemini/knowledge-capture/private/<slug>.md`.
   * **Do not execute `git commit` or `git push` during automatic capture.**
   * Notify the user that memory files have been persisted to disk, and inform them:
     > *Files saved to Private memory. You may review and sync them to your remote repository at any time using the `/kc-commit` command.*

---

## 3. Utilizing MCP Tools for Memory Retrieval

When addressing tasks, check existing memory to adhere to past decisions:
* Call `get_memory_summary` to scan available rules and triggers across layers.
* Call `get_memory_content(layer, slug)` to retrieve the full body of a relevant guideline.
* Call `get_layer_statistics` to check synchronization state or file counts.
