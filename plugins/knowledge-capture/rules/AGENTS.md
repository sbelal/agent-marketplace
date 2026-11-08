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

Every memory entry remains a flat `<slug>.md` file within its layer directory and follows this frontmatter format:

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

### Frontmatter Fields & Classifications
- `name`: Canonical kebab-case slug matching `<slug>.md`.
- `type`: `convention` | `platform-fact` | `tool-gotcha` | `preference`.
- `domain` *(optional, defaults to `"general"`)*: Taxonomic category (e.g., `kubernetes`, `terraform`, `go`, `ci-cd`) used for virtual grouping in `get_memory_summary`.
- `description`: Trigger condition describing **WHEN** this memory must be recalled.
- `verified`: `YYYY-MM-DD` date when the guideline was last verified (entries older than 180 days are flagged as stale).
- `overrides` *(optional)*: Lower-tier slug(s) superseded by this entry (`Workspace > Private > Team`).
- `related` *(optional, defaults to `[]`)*: Inline array `[slug-a, slug-b]` of 1-hop laterally linked memory slugs resolved by `get_memory_content`.

---

## 3. End-of-Task Knowledge Elicitation & Full-Envelope Repurposing (`kc-capture`)

Upon concluding any non-trivial coding task, architectural modification, or deep root-cause/architectural investigation (even if zero code changes were required):

### When to Capture
Capture only when an insight meets all four criteria:
- **Durable:** Useful across multiple sessions and tasks, not transient state or specific incident details.
- **Actionable:** Clear instructions on when to apply it and what to do.
- **Specific:** Explains exact syntax, flags, or root causes—not generic advice ("write clean code").
- **Novel:** Not already documented in repository READMEs, official docs, or existing memory files.

### Elicitation & Full-Envelope Repurposing Workflow
1. **Mandatory Pre-Scan:** Always call `get_memory_summary(layer="all")` before formulating any candidate.
2. **Evaluate for Holistic Extension / Repurposing:**
   If a new learning relates to, generalizes, or expands an existing memory, do **not** create a fragmented sibling file and do **not** blindly append paragraphs to the body while leaving a narrow `slug` and `description` untouched (which creates "invisible knowledge"). Instead, update all three dimensions together:
   - **Slug Evolution (`old-slug -> new-slug`):** Propose renaming the slug (`REPURPOSE-SLUG` / `EXTEND & RENAME`) when the combined scope outgrows the original filename.
   - **Trigger Description Expansion:** Rewrite `description:` so it explicitly covers both the original trigger scenario and the newly added scenarios.
   - **Unified Content Synthesis:** Refactor `# Title`, `## Why`, and `## How to apply` into a single cohesive guide and update `verified: YYYY-MM-DD`.
3. **Present Candidate Approval Table to Developer:**
   ```markdown
   ### 💡 Knowledge Capture Candidates

   | Action (CREATE \| EXTEND \| REPURPOSE-SLUG \| MERGE) | Layer | Target Slug (Old -> New) | Domain | Updated Trigger Description | Related Slugs | Summary of Content Synthesis |
   | :--- | :---: | :--- | :---: | :--- | :--- | :--- |
   | `REPURPOSE-SLUG` | `private` | `k8s-hpa-downscaling -> k8s-hpa-scaling-governance` | `kubernetes` | **Old:** When configuring HPA stabilization windows<br>**New:** When configuring HPA scaling policies, stabilization windows, or PDB alignment | `[k8s-pdb-configuration]` | Synthesizes HPA scale-down stabilization with PDB minAvailable coordination |
   ```
4. **Mandatory Approval Halt:** Never write, rename, or delete memory files until the user explicitly approves.
5. **Filesystem Persistence & Reference Re-Wiring (No Auto-Commit):**
   - Write the approved `<target-slug>.md` file.
   - When renaming/merging in `Workspace` or `Private`, remove `<old-slug>.md` and scan all `.md` files in `Workspace` and `Private` to update any `related: [...]` or `overrides: <old-slug>` references to `<new-slug>`.
   - When expanding a read-only `Team` rule (`<team-slug>`), write `<new-slug>.md` in `Private` with `overrides: <team-slug>` so the narrower team rule is shadowed until `/kc-promote`.
   - Do not execute `git commit` or `git push` during capture; remind the user to run `/kc-commit`.

---

## 4. Model Context Protocol (MCP) Recall & Co-Retrieval Consolidation (`kc-recall`)

When beginning a complex task, consult existing memory using MCP tools:
- **`get_memory_summary(layer?, domain?, query?)`**: Scans guidelines across layers, applies deterministic `Workspace > Private > Team` precedence shadowing, and outputs Markdown tables grouped by `### Domain: <domain>`.
- **`get_memory_content(layer?, slug?, slugs?)`**: Retrieves full markdown content, frontmatter, and the resolved `### Related Memories Available (1-Hop Graph)` footer. Read only relevant files—never dump the entire store.
- **`get_layer_statistics()`**: Retrieves entry counts per layer, active domain breakdown, stale entry count (`verified` > 180 days or missing), uncommitted changes, and branch divergence.
- **Co-Retrieval Consolidation Detection:** When a single task triggers **2 or more memories from the same `domain` or layer** that address tightly coupled facets of one concept, hold a **Co-Retrieval Consolidation Note** without interrupting the task mid-flight. At task completion, proactively offer to merge and repurpose those co-triggered slugs into a single unified slug with an expanded trigger description.

---

## 5. Team Promotion & 4-Point Consolidation Protocol

- **Team Promotion (`/kc-promote <slug>`):**
  - Personal memories verify and mature in Private storage before entering Team memory.
  - Promotion creates an isolated Git branch (`promote/<date>-<slug>`), scrubs personal usernames and machine paths, and halts for developer inspection before opening a GitHub Pull Request (`gh pr create`).
- **4-Point "Lint & Dream" Consolidation (`/kc-consolidate [scope|domain]`):**
  1. **Fragmented / Co-Triggered Slugs:** Merge narrow slugs in the same `domain` with adjacent trigger descriptions into a repurposed slug and broader trigger description.
  2. **Orphaned Overrides & Redundant Private Copies:** Prune `Private` entries whose `overrides:` target was removed upstream or already promoted identically to `Team`.
  3. **Broken Graph Links:** Repair or remove `related: [...]` links pointing to `[unresolved/broken reference]`.
  4. **Staleness & Contradictions:** Refresh or prune entries where `verified: YYYY-MM-DD` exceeds 180 days or where rules conflict.

---

## 6. Plugin Maintenance & Upgrades

When the user requests to update this plugin (e.g. via `/plugin update knowledge-capture` or "update plugin"):
- **Source-Mode (`plugins.json`):** When Antigravity mounts this plugin via `plugins.json`, execute `git pull --ff-only` in the source repository to update the code in-place.
- **Copy-Mode (`.agents/plugins/` or `~/.gemini/config/plugins/`):** Run `npx git+https://github.com/sbelal/agent-marketplace.git --update knowledge-capture`.
- **Data Preservation Guarantee:** User memories (`~/.gemini/knowledge-capture/`) and settings are decoupled from plugin engine files and remain untouched during upgrades.
