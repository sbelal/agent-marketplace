# Knowledge Capture Protocol

This protocol governs persistent memory elicitation, inspection, and multi-layer storage across Antigravity and Claude Code.

---

## 1. Multi-Layer Memory Architecture & Precedence

Knowledge is organized across three tiers with strict resolution precedence:

1. **Layer 1: Workspace Scoped (`.agents/rules/memory/*.md`) [Highest Precedence]**
   * Repository-specific conventions, internal APIs, and codebase quirks.
   * Overrides both Private and Team layers.
2. **Layer 2: Local Global Private (`~/.gemini/knowledge-capture/private/*.md`) [Middle Precedence]**
   * Machine-local developer preferences, personal learnings, and environment quirks.
   * Version controlled via Git when configured. Overrides Team memories via `overrides: <team-slug>`.
3. **Layer 3: Team Global (`~/.gemini/knowledge-capture/team/*.md`) [Baseline Precedence]**
   * Shared organizational standards, verified platform facts, and architectural patterns.
   * Synchronized with shared team Git repository. Read-only locally; contributed via promotion branches and Pull Requests.

---

## 2. Standardized Memory File Schema

Every memory entry is a flat `<slug>.md` file adhering to this schema:

```markdown
---
name: <kebab-case-slug>
type: <convention | platform-fact | tool-gotcha | preference>
domain: <single-category-string, e.g., kubernetes | terraform | go | ci-cd | general>
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

### Frontmatter Fields:
* `name`: Canonical slug matching `<slug>.md`.
* `type`: `convention` | `platform-fact` | `tool-gotcha` | `preference`.
* `domain`: Taxonomic category (defaults to `"general"`).
* `description`: Trigger condition describing WHEN this memory must be recalled.
* `verified`: `YYYY-MM-DD` verification date (>180 days flags entry as stale).
* `overrides`: Lower-tier slug superseded by this entry (`Workspace > Private > Team`).
* `related`: Array of 1-hop laterally linked slugs resolved in `get_memory_content`.

---

## 3. End-of-Task Elicitation & Full-Envelope Repurposing (`kc-capture`)

Execute at task conclusion (including zero-code architectural or debugging investigations):

### Qualification Criteria:
* **Durable:** Reusable across tasks/sessions, not transient state.
* **Actionable:** Clear instructions on when to apply and what to do.
* **Specific:** Exact syntax, flags, or root causes—not generic advice.
* **Novel:** Not already covered in READMEs, official docs, or memory.

### Repurposing & Defragmentation Protocol:
1. **Mandatory Pre-Scan:** Always invoke `get_memory_summary(layer="all")` before proposing candidates.
2. **Full-Envelope Repurposing (`EXTEND` / `REPURPOSE-SLUG`):**
   When new learnings relate to an existing memory, do not create fragmented sibling files or merely append footnotes. Update all three dimensions:
   * **Slug Evolution:** Propose renaming (`REPURPOSE-SLUG`) if scope expands.
   * **Trigger Expansion:** Broaden `description:` to cover both scenarios.
   * **Unified Synthesis:** Refactor `# Title`, `## Why`, and `## How to apply` into a cohesive guide; refresh `verified: YYYY-MM-DD`.
3. **Co-Triggered Fragmentation Detection (`MERGE`):**
   If 2+ memories from the same domain were co-retrieved or address tightly coupled facets of one concept, propose merging them (`<slug-a> + <slug-b> -> <merged-slug>`) with an expanded trigger description.
4. **Candidate Approval Table:**
   Present candidates to the developer before writing to disk:

| Action (CREATE \| EXTEND \| REPURPOSE-SLUG \| MERGE) | Layer | Target Slug (Old -> New) | Domain | Updated Trigger Description | Related Slugs | Summary of Content Synthesis |
| :--- | :---: | :--- | :---: | :--- | :--- | :--- |
| `REPURPOSE-SLUG` | `private` | `k8s-hpa-downscaling -> k8s-hpa-scaling-governance` | `kubernetes` | **Old:** When configuring HPA stabilization<br>**New:** When configuring HPA scaling, stabilization, or PDB alignment | `[k8s-pdb-configuration]` | Synthesizes HPA scale-down stabilization with PDB minAvailable |

5. **Mandatory Approval Halt:** Never write or delete files without explicit user consent.
6. **Persistence & Reference Re-Wiring:**
   * Write approved `<target-slug>.md` using `save_memory_entry` or filesystem write.
   * When renaming/merging, remove old file(s) and update all incoming `related:` and `overrides:` references across remaining files.
   * Do not run `git commit`/`push` during capture; remind developer to run `/kc-commit`.

---

## 4. MCP Memory Retrieval Protocol (`kc-recall`)

At the start of complex tasks, consult memory with minimal token overhead:
* **`get_memory_summary(layer?, domain?, query?)`**: Scans guidelines, shadows overridden entries (`Workspace > Private > Team`), and outputs grouped markdown tables.
* **`get_memory_content(layer?, slug?, slugs?)`**: Retrieves full markdown content, frontmatter, and resolved 1-hop related memory graph footer.
* **`get_layer_statistics()`**: Returns layer counts, active domains, stale entry counts (>180d), and Git synchronization health.

---

## 5. Team Promotion & 4-Point Consolidation Protocol

* **Team Promotion (`/kc-promote <slug>`):**
  Personal memories mature in Private storage before entering Team memory. Promotion creates branch `promote/<date>-<slug>` in `team/`, scrubs personal usernames/paths, and halts for developer inspection before `gh pr create`.
* **Repository Bootstrapping (`/kc-bootstrap`):**
  Scans project ADRs (`docs/adr/`), CI workflows (`.github/workflows/`), linters (`.golangci.yml`, `ruff.toml`, `.eslintrc`), and Dockerfiles to auto-discover and propose initial Workspace memory rules on day one.
* **Session-End Auto-Elicitation (`/kc-elicit`):**
  Audits uncommitted working tree diffs, modified dependencies, and test fixtures at session close (via `SessionEnd` / `Stop` sentinel hook `bin/session-end.js`) and proposes structured memory drafts before context loss.
* **Interactive Visual Memory Studio (`/kc-graph`):**
  Generates an interactive D3.js canvas artifact (`knowledge-graph.html`) featuring force physics, visual Connect Mode, inline node metadata editor, and Staged Patch exporter.
* **Zero-Turn Proactive Recall Probe (`proactive_memory_probe`):**
  Pre-flight check evaluating user queries and task context against memory triggers in < 5ms to surface immediate advisory guidance cards.
* **Historical Tacit Knowledge Archeology (`/kc-archeology`):**
  Mines git commit history, revert messages, and hotfix commit diffs to discover uncodified gotchas and team conventions.
* **Memory Efficacy & Verification Scoring (`record_memory_efficacy`):**
  Tracks utility metrics and test pass/fail signals to automatically adjust efficacy scores (boosting effective rules, penalizing broken rules).
* **Multi-Vector Hybrid Retrieval (`search_memories`):**
  Retrieves memories using Reciprocal Rank Fusion (RRF) combining lexical BM25 with multi-facet dense embeddings across trigger intent (50%), content rules (35%), and entity tags (15%). Gracefully falls back to file-based multi-vector ranking.
* **Semantic Contradiction & Drift Engine (`/kc-drift`):**
  Audits active memories across all layers for semantic contradictions (opposing directives on similar tasks without explicit `overrides:`) and codebase drift (missing referenced files, runtime engine mismatches, dangling overrides, and staleness).
* **4-Point "Lint & Dream" Consolidation (`/kc-consolidate [scope|domain]`):**
  1. **Fragmented Slugs:** Merge narrow co-triggered slugs in same domain.
  2. **Orphaned Overrides & Redundant Copies:** Prune entries whose overrides target disappeared upstream or are already identical in Team.
  3. **Broken Graph Links:** Repair or prune `related:` links pointing to non-existent slugs.
  4. **Staleness & Contradictions:** Refresh or prune entries where `verified:` > 180 days or where guidance conflicts.

---

## 6. Plugin Maintenance & Upgrades

1. **Startup Update Audit:** `SessionStart` hook audits for upstream updates. When available, an actionable notice is injected into the session report.
2. **Autonomous Upgrade Execution:** When instructed to update:
   * **Source-Mode (`plugins.json`):** Run `node ./bin/install.js --update-source` or `git pull --ff-only`.
   * **Copy-Mode (`.agents/plugins/`):** Run `node ./bin/install.js --update <target|all>`.
   * **Data Safety:** Personal memory files in `~/.gemini/knowledge-capture/` are strictly decoupled from plugin code and never overwritten.

---

## 7. State-Aware Interactive Setup Protocol

When setup or configuration is requested (e.g. `/kc-init`, `/marketplace`):
1. **Never Show Generic Terminal Readline Prompts in Chat:** Query `node ./bin/install.js --status-json` first.
2. **Option Pruning:** Omit redundant options (e.g. do not offer global source install if already active).
3. **Native Interfaces:** Use `ask_question` modal in Antigravity, and interactive prompts in Claude Code.
4. **Headless Execution:** Run operations with non-interactive CLI flags (`--private-url`, `--scope`, etc.).
