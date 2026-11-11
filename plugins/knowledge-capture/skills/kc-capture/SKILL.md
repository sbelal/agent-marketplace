---
name: kc-capture
description: >
  Capture durable lessons, operational patterns, conventions, tool quirks, and team facts
  into persistent memory using Full-Envelope Repurposing (evolving slugs, trigger descriptions,
  and content together). Triggers autonomously at the end of non-trivial coding, debugging, or
  architectural investigation tasks when high-value learnings emerge, or explicitly when asked
  to remember something.
user-invocable: false
disable-slash-command: true
---

# Skill: Knowledge Capture (`kc-capture`)

Execute knowledge elicitation at the conclusion of coding, debugging, or zero-code root-cause/architectural analysis tasks in compliance with the Knowledge Capture Protocol in `AGENTS.md`.

## Workflow

### 1. Mandatory Pre-Scan (`get_memory_summary`)
Before formulating or proposing any memory candidate, you **MUST** call:
```text
get_memory_summary(layer="all")
```
Inspect all existing memories across `Workspace`, `Private`, and `Team` layers (including their `domain`, `slug`, `overrides`, `related`, and `description` trigger conditions).

### 2. Determine Candidates: Full-Envelope Repurposing & Co-Triggered Fragmentation Detection
Review the current session for reusable insights meeting the qualification criteria in `AGENTS.md` (**Durable**, **Actionable**, **Specific**, **Novel**), and audit any memories that were recalled during the session against the `get_memory_summary(layer="all")` index.

> [!IMPORTANT]
> **Holistic Repurposing & Just-In-Time Defragmentation:**
> Simply appending paragraphs to an existing memory file while leaving its narrow original `slug` and `description` untouched creates **"invisible knowledge"**—future `get_memory_summary` calls will miss the expanded scope because recall relies on the slug and trigger description.
> Furthermore, candidate determination is the most token-efficient stage to detect **co-triggered memory fragmentation**—when multiple existing memories were recalled together for this task (or overlap in the same `domain` in the summary index).

Evaluate candidate actions across both new learnings and co-triggered existing memories:

#### A. Extending an Existing Memory (`EXTEND` / `REPURPOSE-SLUG`)
When a new learning belongs to the same conceptual workflow, component, or failure mode as an existing memory, do **not** create a fragmented sibling file and do **not** merely append body text. Propose an **`EXTEND`** or **`REPURPOSE-SLUG`** (`EXTEND & RENAME (<old-slug> -> <new-slug>)`) operation that updates the **entire envelope** across all three dimensions:
1. **Slug Evolution (`old-slug -> new-slug`):**
   - If the existing slug is now too narrow for the combined knowledge (e.g., `eks-coredns-oom` expanding to cover cluster DNS scaling limits -> `eks-coredns-scaling-and-limits`, or `k8s-hpa-downscaling` expanding to cover PDBs and scaling governance -> `k8s-hpa-scaling-governance`), propose renaming the slug (`name:` frontmatter + `.md` filename).
2. **Trigger Description Expansion:**
   - Rewrite the `description: When ...` frontmatter so the trigger condition explicitly encompasses *both* the original scenario and the newly added scenarios.
3. **Unified Content Synthesis:**
   - Refactor and synthesize the Markdown body (`# Title`, `## Why`, `## How to apply`) into a single cohesive architectural guide rather than tacking an "Update:" footnote onto the end, and refresh `verified: YYYY-MM-DD`.
   - Assign an appropriate `domain:` (e.g., `kubernetes`, `terraform`, `go`, `ci-cd`) and populate `related: [...]` with 1-hop lateral graph links to adjacent memories.

#### B. Co-Triggered Memory Fragmentation Detection (`MERGE` or `related` Link)
While determining candidates against the `get_memory_summary` output, check whether **2 or more existing memories** were triggered together during this task (or whether the new candidate exposes 2+ existing narrow slugs in the same `domain` that address tightly coupled facets of one concept):
- **Distinct Concerns (Keep Separate + Link via `related`):**
  If the memories represent genuinely separate domains or orthogonal concerns that happened to intersect on this task (e.g., `go-error-wrapping` and `postgres-connection-pooling`), keep them separate and propose linking them via `related: [...]`.
- **Fragmented Facets of One Concept (`MERGE`):**
  If 2 or more co-triggered or adjacent memories share the same `domain`/subsystem and always apply together (e.g., `k8s-hpa-stabilization` and `k8s-hpa-cpu-target-calculation`), include a **`MERGE`** candidate in the proposal table (`<slug-a> + <slug-b> -> <proposed-merged-slug>`)—synthesizing their contents (along with any new task learnings) into a single unified slug with an expanded trigger `description:`.

### 3. Determine Target Layer
Select the destination layer based on scope (`Workspace > Private > Team`):
- **Workspace Layer (`.agents/rules/memory/<slug>.md`):** Repo-specific architectural facts, domain rules, or internal APIs.
- **Private Layer (`~/.gemini/knowledge-capture/private/<slug>.md`):** Personal preferences, cross-repo patterns, debugging solutions, and evolved/merged versions of Team rules.
- *(Note: Never write directly to read-only Team memory; when extending, repurposing, or merging a Team rule `<team-slug>`, write `<new-slug>.md` to Private with `overrides: <team-slug>` until promoted via `/kc-promote`.)*

### 4. Present Candidate Approval Table
Present proposed candidates (including any `MERGE` actions for co-triggered fragmented memories) to the developer using this exact table schema before writing to disk:

```markdown
### 💡 Knowledge Capture Candidates

| Action (CREATE \| EXTEND \| REPURPOSE-SLUG \| MERGE) | Layer | Target Slug (Old -> New) | Domain | Updated Trigger Description | Related Slugs | Summary of Content Synthesis |
| :--- | :---: | :--- | :---: | :--- | :--- | :--- |
| `REPURPOSE-SLUG` | `private` | `k8s-hpa-downscaling -> k8s-hpa-scaling-governance` | `kubernetes` | **Old:** When configuring HPA stabilization windows<br>**New:** When configuring HPA scaling policies, stabilization windows, or PodDisruptionBudget alignment | `[k8s-pdb-configuration, helm-values-schema]` | Synthesizes HPA scale-down stabilization with PDB minAvailable coordination |
| `MERGE` | `private` | `k8s-hpa-stabilization + k8s-hpa-cpu-targets -> k8s-hpa-autoscaling-policy` | `kubernetes` | **Old:** Separate triggers for stabilization and CPU targets<br>**New:** When configuring HPA replica scaling, stabilization windows, or CPU/memory utilization targets | `[k8s-pdb-configuration]` | Consolidates co-triggered HPA fragments into one unified autoscaling guide |
```

### 5. Mandatory Approval Halt
Halt the turn and await explicit developer confirmation (e.g., "save all", "approve", "add `<slug>`", or decline). **Never write, rename, or delete memory files on disk without explicit consent.**

### 6. Persist via MCP Tools & Execute Reference Re-Wiring
Upon developer approval:
1. **Execute via MCP Tool:**
   - For `CREATE` or `EXTEND` / `REPURPOSE-SLUG`: Call the MCP tool `save_memory_entry(layer, slug, oldSlug, title, why, howToApply, type, domain, description, related, overrides)`. If `oldSlug` is provided, the tool automatically deletes the old file and re-wires all incoming references atomically!
   - For `MERGE`: Call the MCP tool `merge_memory_entries(layer, targetSlug, sourceSlugs, title, why, howToApply, type, domain, description, related, overrides)`. The tool writes the target file, deletes all source files, and re-wires all incoming references automatically.
2. **Expanding or Merging a Read-Only `Team` Rule:** If any memory being extended or merged lives in read-only `Team` (`<old-team-slug>`), write `<new-slug>` to `Private` with `overrides: <old-team-slug>` so the team rule is shadowed until `/kc-promote`.
3. **No Auto-Commit:** Do not run `git commit` or `git push` during capture. Inform the developer that the changes are saved locally and can be committed/pushed anytime via `/kc-commit`.
