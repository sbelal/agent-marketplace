# Knowledge Capture Protocol

This protocol governs persistent memory elicitation, inspection, and multi-layer storage across Antigravity and Claude Code.

---

## 1. Multi-Layer Memory Architecture & Precedence

Knowledge is organized across three tiers with strict resolution precedence:

1. **Layer 1: Workspace Scoped (`.agents/rules/memory/*.md`) [Highest Precedence]**
   * Repository-specific conventions, internal APIs, and codebase quirks. Overrides Private and Team layers.
2. **Layer 2: Local Global Private (`~/.gemini/knowledge-capture/private/*.md`) [Middle Precedence]**
   * Developer preferences, personal learnings, and environment quirks. Overrides Team memories via `overrides: <team-slug>`.
3. **Layer 3: Team Global (`~/.gemini/knowledge-capture/team/<slug>/*.md`) [Baseline Precedence]**
   * Shared organizational standards and platform facts. Partitioned by unique repository slugs (e.g. `core`, `platform`). Managed via `manage_team_repositories`. Read-only locally; contributed via promotion branches and PRs.

---

## 2. Standardized Memory File Schema

Every memory entry is a flat `<slug>.md` file adhering to this schema:

```markdown
---
name: <kebab-case-slug>
type: <convention | platform-fact | tool-gotcha | preference>
domain: <single-category-string, e.g. kubernetes | terraform | go | ci-cd | general>
description: <One-line trigger condition: WHEN this memory should be recalled>
verified: YYYY-MM-DD
overrides: <team-slug-if-applicable>
related: [<related-slug-1>, <related-slug-2>]
---

# <Title>

<Clear, concise explanation of the pattern, gotcha, or fact.>

## Why
<Root cause, architectural rationale, or background context.>

## How to apply
<Actionable instructions, commands, or code patterns.>
```

* `name`: Canonical slug matching `<slug>.md`.
* `type`: `convention` | `platform-fact` | `tool-gotcha` | `preference`.
* `domain`: Taxonomic category (defaults to `"general"`).
* `description`: Trigger condition describing WHEN this memory must be recalled.
* `verified`: `YYYY-MM-DD` verification date (>180 days flags entry as stale).
* `overrides`: Lower-tier slug superseded by this entry (`Workspace > Private > Team`).
* `related`: Array of 1-hop laterally linked slugs resolved in `get_memory_content`.

---

## 3. End-of-Task Elicitation & Full-Envelope Repurposing (`kc-capture`)

Execute at task conclusion (including zero-code investigations or preference corrections):

### Qualification Criteria:
* **Durable:** Reusable across tasks/sessions, not transient state.
* **Actionable:** Clear instructions on when to apply and what to do.
* **Specific:** Exact syntax, flags, or root causes—not generic advice.
* **Novel:** Not already covered in READMEs, official docs, or memory.
* **Zero-Code Breakthroughs:** Investigations, runtime errors, or tool gotchas requiring 0 file changes.
* **Ways of Working & User Preferences:** User corrections, prose rewriting feedback (e.g. concise conclusions first vs. detailed analysis), and architectural preferences captured as `preference` or `convention` entries.

### Repurposing & Defragmentation Protocol:
1. **Mandatory Pre-Scan:** Always invoke `get_memory_summary(layer="all")` before proposing candidates.
2. **Full-Envelope Repurposing (`EXTEND` / `REPURPOSE-SLUG`):**
   When new learnings relate to an existing memory, do not create fragmented sibling files. Update all three dimensions:
   * **Slug Evolution:** Propose renaming (`REPURPOSE-SLUG`) if scope expands.
   * **Trigger Expansion:** Broaden `description:` to cover both scenarios.
   * **Unified Synthesis:** Refactor `# Title`, `## Why`, and `## How to apply` into a cohesive guide; refresh `verified: YYYY-MM-DD`.
3. **Co-Triggered Fragmentation Detection (`MERGE`):**
   If 2+ memories from the same domain were co-retrieved or address tightly coupled facets of one concept, propose merging them (`<slug-a> + <slug-b> -> <merged-slug>`).
4. **Candidate Approval Table:** Present candidates to the developer before writing to disk:

| Action (CREATE \| EXTEND \| REPURPOSE-SLUG \| MERGE) | Layer | Target Slug (Old -> New) | Domain | Updated Trigger Description | Related Slugs | Summary of Content Synthesis |
| :--- | :---: | :--- | :---: | :--- | :--- | :--- |
| `REPURPOSE-SLUG` | `private` | `k8s-hpa-downscaling -> k8s-hpa-scaling-governance` | `kubernetes` | **Old:** When configuring HPA stabilization<br>**New:** When configuring HPA scaling, stabilization, or PDB alignment | `[k8s-pdb-configuration]` | Synthesizes HPA scale-down stabilization with PDB minAvailable |

5. **Mandatory Approval Halt:** Never write or delete files without explicit user consent.
6. **Persistence & Reference Re-Wiring:**
   * Write approved `<target-slug>.md` using `save_memory_entry`.
   * When renaming/merging, remove old file(s) and re-wire incoming `related:` and `overrides:` references across remaining files.
   * Do not run `git commit`/`push` during capture; remind developer to run `/kc-commit`.

---

## 4. MCP Memory Retrieval Protocol (`kc-recall`)

At the start of complex tasks, consult memory with minimal token overhead using Command-Query Separation (CQS):
* **`search_memories(query, limit?, mode?, format?)`**: Multi-vector hybrid retrieval combining SQLite FTS5 BM25 with dense embeddings (trigger 50%, content 35%, entities 15%) fused via RRF. Pure read query. Supports `format: 'compact'` (~15 tokens/card) and `format: 'full'`.
* **`get_memory_summary(layer?, domain?, query?, format?)`**: Scans guidelines, shadows overridden entries (`Workspace > Private > Team`), and outputs grouped markdown tables or compact index cards (`format: 'compact'`).
* **`get_memory_content(layer?, slug?, slugs?, depth?)`**: Retrieves full markdown content, frontmatter, and resolved 1-hop related memory graph footer. With `depth: 2..3`, traverses multi-hop reference & override graph via BFS to assemble a structured GraphRAG Spanning Tree Context Envelope.
* **`get_memory_spanning_tree(slug, depth?, maxNodes?)`**: GraphRAG Multi-Hop Spanning Tree Recall. Traverses connected subgraph with cycle detection, returning envelope context, nodes, and edges.
* **`get_layer_statistics()`**: Returns layer counts, active domains, stale entry counts (>180d), multi-team repository status, and Git synchronization health.
* **`manage_team_repositories(action, slug?, url?, name?, cleanDisk?)`**: Command for multi-team memory repositories (`list`, `add`, `activate`, `deactivate`, `remove`, `sync`). Scopes repositories under `team/<slug>/`.

---

## 5. Team Promotion & Consolidation Protocol

* **Team Promotion (`/kc-promote <slug>`):**
  Personal memories mature in Private storage before entering Team memory. The Agent LLM semantically transforms content (scrubbing PII/secrets, neutralizing voice, and generalizing workstation paths). Promotion creates branch `promote/<date>-<slug>` in `team/`, writes the sanitized guideline, and halts for developer inspection before `gh pr create`.
* **Repository Bootstrapping (`/kc-bootstrap`):**
  Scans project ADRs (`docs/adr/`), CI workflows (`.github/workflows/`), linters, and Dockerfiles to auto-discover and propose initial Workspace memory rules on day one.
* **Session-End Auto-Elicitation (`/kc-elicit`):**
  Audits uncommitted tree diffs, modified dependencies, error logs, and user feedback/preferences at session close (via `SessionEnd` hook) and proposes structured memory drafts before context loss.
* **Interactive Visual Memory Studio (`/kc-studio` & `/kc-graph`):**
  Launches the standalone Memory Studio CLI server (`node ./bin/studio.js`) or generates the interactive D3.js canvas artifact. Features force physics, visual Connect Mode, inline node metadata editor, and direct 1-click browser-to-disk persistence via `/api/patch`.
* **Memory Efficacy Scoring (`record_memory_efficacy`):**
  Tracks utility metrics and test pass/fail signals to automatically adjust efficacy scores (boosting effective rules, penalizing broken rules).
* **Semantic Contradiction & Drift Engine (`/kc-drift`):**
  Audits active memories across all layers for semantic contradictions (opposing directives on similar tasks without explicit `overrides:`) and codebase drift (missing referenced files, runtime mismatches, dangling overrides, staleness).
* **4-Point "Lint & Dream" Consolidation (`/kc-consolidate` / `/kc-dream`):**
  1. Fragmented Slugs: Merge narrow co-triggered slugs in same domain.
  2. Orphaned Overrides & Redundant Copies: Prune entries whose overrides target disappeared upstream.
  3. Broken Graph Links: Repair or prune `related:` links pointing to non-existent slugs.
  4. Staleness & Contradictions: Refresh or prune entries where `verified:` > 180 days or guidance conflicts.

---

## 6. Plugin Maintenance & Upgrades

1. **Startup Update Audit:** `SessionStart` hook audits for upstream updates. When available, an actionable notice is injected into the session report.
2. **Autonomous Upgrade Execution:**
   * **Source-Mode (`plugins.json`):** Run `npx git+https://github.com/sbelal/agent-marketplace.git --update-source` or `git pull --ff-only`.
   * **Copy-Mode (`.agents/plugins/`):** Run `npx git+https://github.com/sbelal/agent-marketplace.git --update <target|all>`.
   * **Data Safety:** Personal memory files in `~/.gemini/knowledge-capture/` are decoupled from plugin code and never overwritten.

---

## 7. State-Aware Interactive Setup Protocol

When setup is requested (e.g. `/kc-init`, `/marketplace`):
1. **No Raw Readline Prompts:** Query `npx git+https://github.com/sbelal/agent-marketplace.git --status-json` first (or use `~/.gemini/sources/agent-marketplace/bin/install.js` if present).
2. **Option Pruning:** Omit redundant options (e.g. skip global source install if active).
3. **Native UI:** Use `ask_question` in Antigravity, interactive prompts in Claude Code.
4. **Headless Flags:** Run via non-interactive CLI flags (`--private-url`, `--scope`, etc.).
