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

### Elicitation, Full-Envelope Repurposing & Fragmentation Detection Workflow
1. **Mandatory Pre-Scan:** Always call `get_memory_summary(layer="all")` before formulating any candidate.
2. **Determine Candidates (Full-Envelope Repurposing & Co-Triggered Defragmentation):**
   - **Extending an Existing Memory (`EXTEND` / `REPURPOSE-SLUG`):** If a new learning relates to, generalizes, or expands an existing memory, do **not** create a fragmented sibling file and do **not** blindly append paragraphs to the body while leaving a narrow `slug` and `description` untouched (which creates "invisible knowledge"). Update all three dimensions together:
     - **Slug Evolution (`old-slug -> new-slug`):** Propose renaming the slug (`REPURPOSE-SLUG`) when the combined scope outgrows the original filename.
     - **Trigger Description Expansion:** Rewrite `description:` so it explicitly covers both the original trigger scenario and the newly added scenarios.
     - **Unified Content Synthesis:** Refactor `# Title`, `## Why`, and `## How to apply` into a single cohesive guide and update `verified: YYYY-MM-DD`.
   - **Co-Triggered Memory Fragmentation Detection (`MERGE` or `related` Link):** During candidate determination, check if **2 or more existing memories** from the same `domain` or layer were co-retrieved during this session (or address tightly coupled facets of one concept in the `get_memory_summary` output). If they are orthogonal concerns, link them via `related: [...]`; if they are fragmented facets of the same subsystem, propose a **`MERGE`** candidate (`<slug-a> + <slug-b> -> <proposed-merged-slug>`) with an expanded trigger description.
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
   - When expanding or merging a read-only `Team` rule (`<team-slug>`), write `<new-slug>.md` in `Private` with `overrides: <team-slug>` so the narrower team rule is shadowed until `/kc-promote`.
   - Do not execute `git commit` or `git push` during capture; remind the user to run `/kc-commit`.

---

## 4. Model Context Protocol (MCP) Memory Retrieval (`kc-recall`)

When beginning a complex task, consult existing memory using MCP tools with minimal token overhead:
- **`get_memory_summary(layer?, domain?, query?)`**: Scans guidelines across layers, applies deterministic `Workspace > Private > Team` precedence shadowing, and outputs Markdown tables grouped by `### Domain: <domain>`.
- **`get_memory_content(layer?, slug?, slugs?)`**: Retrieves full markdown content, frontmatter, and the resolved `### Related Memories Available (1-Hop Graph)` footer. Read only relevant files—never dump the entire store.
- **`get_layer_statistics()`**: Retrieves entry counts per layer, active domain breakdown, stale entry count (`verified` > 180 days or missing), uncommitted changes, and branch divergence.

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

## 6. Plugin Maintenance, Update Notifications & Autonomous Upgrades

1. **Lightweight Startup Hook Update Notice:**
   - The `SessionStart` lifecycle hook audits for available plugin and repository updates in the background.
   - When an update is published, an actionable notification is injected in the session report informing the developer.
2. **Autonomous Upgrade Execution Upon User Instruction:**
   - When the user instructs the agent to update plugins (e.g. *"Update knowledge-capture"*, *"Update all plugins"*, or `/kc-update`):
     - **Inspect Mode:** Query installation state via `node ./bin/install.js --status-json` or inspecting `plugins.json`.
     - **Source-Mode (`plugins.json`):** Execute `git pull --ff-only` on the repository source or `node ./bin/install.js --update-source`.
     - **Copy-Mode (`.agents/plugins/` or `~/.gemini/config/plugins/`):** Run `node ./bin/install.js --update <target|all>` (or `npx git+https://github.com/sbelal/agent-marketplace.git --update <target|all>`).
     - **Preserve User Data:** Reassure the user that personal memory files (`~/.gemini/knowledge-capture/`) and settings are untouched.
     - **Report Confirmation:** Output an update summary card in chat detailing versions before and after.

---

## 7. State-Aware Interactive Setup & Configuration Protocol

When the user requests setup, configuration, or initialization (e.g. `/kc-init`, `/marketplace`, or *"Set up marketplace plugins"*):
1. **Never Show Generic CLI Readline Wizards in Chat:** Do not ask the user to run interactive readline terminal scripts.
2. **State-Aware Inspection & Option Pruning:**
   - Run `node ./bin/install.js --status-json` first to detect active sources, installed scopes, and settings.
   - **Crucial Rule:** If the user is currently using a mode (e.g. source-based global install), **prune that option from the choices** so it does not show up as a redundant setup choice.
3. **Use Harness-Native Choice Interfaces:**
   - **Google Antigravity:** Use the `ask_question` tool to present structured multiple-choice questions with clickable buttons and write-in input.
   - **Claude Code:** Use the interactive choices/prompt mechanism in the harness.
4. **Execute Headless Operations:** Once choices and parameters are collected, invoke commands headlessly with non-interactive flags (`--private-url`, `--team-url`, `--scope`, etc.).

