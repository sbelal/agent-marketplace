# Knowledge Capture Protocol

This rule governs persistent memory elicitation, inspection, and multi-layer storage across Antigravity and Claude Code.

---

## 1. Multi-Layer Memory Architecture & Precedence

Knowledge is organized across three distinct tiers with strict resolution precedence:

1. **Layer 1: Workspace Scoped (`.agents/rules/memory/*.md`) [Highest Precedence]**
   * Repository-specific rules, internal APIs, and codebase quirks.
   * Discovered automatically by Antigravity as hierarchical rules; overrides both Private and Team layers.
2. **Layer 2: Local Global Private (`~/.gemini/knowledge-capture/private/*.md`) [Middle Precedence]**
   * Machine-local developer preferences, personal learnings, and environment quirks.
   * Version controlled via Git when configured in `settings.json`.
   * Overrides Team memories on the same subject. An explicit `overrides: <team-slug>` field indicates deliberate supersession, not a conflict.
3. **Layer 3: Team Global (`~/.gemini/knowledge-capture/team/*.md`) [Baseline Precedence]**
   * Shared organizational standards, verified platform facts, and sanitized architectural patterns.
   * Synchronized with a shared team Git repository. **Read-only locally; modifications are contributed via branches and GitHub Pull Requests.**

---

## 2. Standardized Memory File Schema

Every memory entry across all layers must follow this frontmatter format:

```markdown
---
name: <kebab-case-slug>
type: <convention | platform-fact | tool-gotcha | preference>
description: <One-line trigger condition: WHEN this memory should be recalled>
verified: YYYY-MM-DD
overrides: <team-slug-if-applicable>
---

# <Title>

<Clear, concise explanation of the pattern, gotcha, or fact.>

## Why
<Root cause, architectural rationale, or background context.>

## How to apply
<Actionable instructions, commands, or code patterns.>
```

### Type Classifications
- `convention`: Coding patterns, naming rules, file structures.
- `platform-fact`: Cloud infrastructure behaviors, Kubernetes configs, CI/CD pipeline specifics.
- `tool-gotcha`: Workarounds for CLI flags, compiler quirks, third-party library pitfalls.
- `preference`: User workflow preferences, testing habits, editor conventions.

---

## 3. End-of-Task Knowledge Elicitation

Upon concluding any non-trivial coding task, architectural modification, or debugging investigation:

### When to Capture
Capture only when an insight meets all four criteria:
- **Durable:** Useful across multiple sessions and tasks, not transient state or specific incident details.
- **Actionable:** Clear instructions on when to apply it and what to do.
- **Specific:** Explains exact syntax, flags, or root causes—not generic advice ("write clean code").
- **Novel:** Not already documented in repository READMEs, official docs, or existing memory files.

### What NOT to Capture
- Ephemeral task status ("PR #123 waiting for merge").
- Code snippets that belong directly in the project codebase.
- Generic language features easily found in official language documentation.

### Elicitation Workflow
1. **Formulate Candidate:** Draft slug, type, description, and verified date.
2. **Present Candidate Table to User:**
   ```markdown
   ### 💡 Knowledge Capture Candidates

   | Slug | Type | Trigger Description |
   | :--- | :---: | :--- |
   | `auth0-token-refresh` | `tool-gotcha` | Automatic token refresh handling without leaking client credentials |

   Persist candidates to Private memory (`~/.gemini/knowledge-capture/private/`), select specific slugs, or decline.
   ```
3. **Mandatory Approval Halt:** Never write files until the user explicitly approves ("save all", "add auth0-token-refresh").
4. **Filesystem Persistence (No Git Commit):** Write to `~/.gemini/knowledge-capture/private/<slug>.md`. Do not execute `git commit` or `git push` during capture.

---

## 4. Model Context Protocol (MCP) Memory Retrieval

When beginning a task, consult existing memory using MCP tools:
- **`get_memory_summary`**: Scans available guidelines across layers and returns a compact Markdown table. Use this first to check for relevant memory.
- **`get_memory_content(layer, slug)`**: Retrieves the full markdown body and frontmatter for a specific memory slug when its description matches the active task. Read only relevant files—never dump the entire store.
- **`get_layer_statistics`**: Retrieves entry counts, uncommitted changes, active branches, and upstream divergence.

---

## 5. Team Promotion & Consolidation Protocol

- **Team Promotion (`/kc-promote <slug>`):**
  - Personal memories verify and mature in Private storage before entering Team memory.
  - Promotion creates an isolated Git branch (`promote/<date>-<slug>`), scrubs personal usernames and machine paths, and halts for developer inspection.
  - Team contributions travel strictly through human-reviewed Pull Requests (`gh pr create`).
- **Memory Consolidation (`/kc-consolidate`):**
  - Periodically deduplicate overlapping entries, merge related fragments, and prune obsolete guidelines.

---

## 6. Plugin Maintenance & Upgrades

When the user requests to update this plugin (e.g. via `/plugin update knowledge-capture` or "update plugin"):
- **Source-Mode (`plugins.json`):** When Antigravity mounts this plugin via `plugins.json`, execute `git pull --ff-only` in the source repository to update the code in-place.
- **Copy-Mode (`.agents/plugins/` or `~/.gemini/config/plugins/`):** Run `npx git+https://github.com/sbelal/agent-marketplace.git --update knowledge-capture`.
- **Data Preservation Guarantee:** User memories (`~/.gemini/knowledge-capture/`) and settings are decoupled from plugin engine files and remain untouched during upgrades.
