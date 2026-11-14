# Knowledge Capture Protocol

Governs persistent memory elicitation, inspection, and multi-layer storage across Antigravity and Claude Code.

---

## 1. Multi-Layer Architecture & Precedence

Three tiers with strict resolution precedence (`Workspace > Private > Team`):
1. **Workspace (`.agents/rules/memory/*.md`) [Highest]:** Repo conventions, internal APIs, codebase quirks.
2. **Private (`~/.gemini/knowledge-capture/private/*.md`) [Middle]:** Personal learnings, preferences, env quirks. Override Team rules via `overrides: <team-slug>`.
3. **Team (`~/.gemini/knowledge-capture/team/<slug>/*.md`) [Baseline]:** Shared org standards partitioned by repo slug via `manage_team_repositories`. Read-only locally; updated via `/kc-promote` branches & PRs.

*(Resolve exact base path via `KC_STORAGE_DIR` / `GEMINI_HOME` or `get_layer_statistics`.)*

---

## 2. Standardized Memory File Schema

Every memory is a flat `<slug>.md` file:

```markdown
---
name: <kebab-case-slug>
type: <convention | platform-fact | tool-gotcha | preference>
domain: <lowercase-category, e.g. kubernetes | terraform | go | ci-cd | general>
description: <One-line trigger: WHEN this memory must be recalled>
verified: YYYY-MM-DD
overrides: <team-slug-if-applicable>
related: [<related-slug-1>, <related-slug-2>]
---
# <Title>
## Why
<Root cause or rationale>
## How to apply
<Actionable instructions, commands, or patterns>
```

* `verified`: `YYYY-MM-DD` (>180 days flags entry as stale). `overrides`: superseded lower-tier slug. `related`: 1-hop linked slugs resolved in `get_memory_content`.

---

## 3. End-of-Task Elicitation & Repurposing (`kc-capture`)

Run at task conclusion (including zero-code investigations or user preference corrections):
* **Criteria:** Durable, Actionable, Specific, Novel, Zero-Code Breakthroughs (runtime/tool debugging requiring 0 file edits), or User Preferences/Ways of Working (captured as `preference` or `convention`).
* **Repurposing & Defragmentation Protocol:**
  1. **Pre-Scan:** Invoke `get_memory_summary(layer="all")` first.
  2. **Full-Envelope Repurposing (`EXTEND` / `REPURPOSE-SLUG`):** Broaden an existing rule instead of fragmenting: evolve slug, expand `description:`, refactor `# Title`/`## Why`/`## How to apply`, refresh `verified`.
  3. **Merge (`MERGE`):** Combine co-triggered domain siblings (`<a + b> -> <merged-slug>`).
  4. **Approval Table & Halt:** Present `Action (CREATE|EXTEND|REPURPOSE-SLUG|MERGE) | Layer | Target Slug (Old->New) | Domain | Updated Trigger | Related | Summary` and wait for explicit consent before writing/deleting.
  5. **Persist:** Call `save_memory_entry` / `merge_memory_entries` (rewires `related:`/`overrides:`). Never `git commit`/`push` during capture; remind developer to run `/kc-commit`.

---

## 4. MCP Retrieval Protocol (`kc-recall`, CQS)

Consult memory at the start of complex tasks using pure read queries first:
* **`search_memories(query, limit?, mode?, format?)`**: Hybrid RRF retrieval (FTS5 BM25 + multi-vector embeddings). Supports `compact` (~15 tokens) and `full` formats.
* **`get_memory_summary(layer?, domain?, query?, format?)`**: Lists active guidelines (applying `Workspace > Private > Team` shadowing).
* **`get_memory_content(layer?, slug?, slugs?, depth?)`**: Loads full Markdown + 1-hop graph; `depth: 2..3` builds a GraphRAG spanning tree envelope.
* **`get_memory_spanning_tree(slug, depth?, maxNodes?)`**: Cycle-safe GraphRAG subgraph traversal.
* **`get_layer_statistics()`**: Layer counts, domains, stale entries (>180d), team repo status, Git health.
* **`manage_team_repositories(action, slug?, url?, name?, cleanDisk?)`**: Manage `team/<slug>/` repos (`list`, `add`, `activate`, `deactivate`, `remove`, `sync`).

---

## 5. Governance, Studio & Consolidation Commands

* **`/kc-promote <slug>`:** Scrubs PII/paths, neutralizes voice, opens `promote/<date>-<slug>` in `team/<team-slug>/`, halts for user diff check before PR.
* **`/kc-bootstrap`:** Auto-discovers ADRs, CI workflows, linters, and Dockerfiles for Workspace onboarding.
* **`/kc-elicit`:** Audits session diffs, error logs, and user feedback before context loss.
* **`/kc-studio` / `/kc-graph`:** Interactive Visual Memory Studio (`node ./bin/studio.js` or inline `<agent-embed>` artifact) with `/api/patch`.
* **`record_memory_efficacy`:** Adjusts memory efficacy scores from usage and test pass/fail outcomes.
* **`/kc-drift`:** Audits active rules for semantic contradictions, missing referenced files, runtime mismatches, dangling overrides, and staleness.
* **`/kc-consolidate` (`/kc-dream`):** 4-point audit: (1) merge co-triggered domain slugs, (2) prune orphaned overrides / redundant private copies, (3) repair broken `related:` links, (4) refresh/prune stale (>180d) or conflicting entries.

---

## 6. Plugin Maintenance & State-Aware Setup

* **Upgrades:** `SessionStart` audits upstream updates. Upgrade Source-Mode via `npx git+https://github.com/sbelal/agent-marketplace.git --update-source` (`git pull --ff-only`) or Copy-Mode via `--update <target|all>`. Personal memory data is decoupled and preserved.
* **Setup (`/kc-init`, `/marketplace`):** Query `--status-json` first (no raw readline prompts), prune redundant choices, use `ask_question` in Antigravity / interactive prompts in Claude Code, and pass headless CLI flags (`--private-url`, `--scope`, etc.).
