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

### 2. Evaluate Findings & Prioritize Full-Envelope Repurposing
Review the current session for reusable insights meeting the qualification criteria in `AGENTS.md` (**Durable**, **Actionable**, **Specific**, **Novel**).

> [!IMPORTANT]
> **Holistic Repurposing Over Blind Appending:**
> Simply appending paragraphs to an existing memory file while leaving its narrow original `slug` and `description` untouched creates **"invisible knowledge"**—future `get_memory_summary` calls will miss the expanded scope because recall relies on the slug and trigger description.
> Conversely, creating a separate sibling file for a closely coupled facet fragments the knowledge base.

When a new learning belongs to the same conceptual workflow, component, or failure mode as an existing memory, do **not** create a fragmented sibling file and do **not** merely append body text. Instead, propose an **`EXTEND`**, **`REPURPOSE-SLUG`** (`EXTEND & RENAME (<old-slug> -> <new-slug>)`), or **`MERGE`** operation that updates the **entire envelope** across all three dimensions:

1. **Slug Evolution (`old-slug -> new-slug`):**
   - If the existing slug is now too narrow for the combined knowledge (e.g., `eks-coredns-oom` expanding to cover cluster DNS scaling limits -> `eks-coredns-scaling-and-limits`, or `k8s-hpa-downscaling` expanding to cover PDBs and scaling governance -> `k8s-hpa-scaling-governance`), propose renaming the slug (`name:` frontmatter + `.md` filename).
2. **Trigger Description Expansion:**
   - Rewrite the `description: When ...` frontmatter so the trigger condition explicitly encompasses *both* the original scenario and the newly added scenarios.
3. **Unified Content Synthesis:**
   - Refactor and synthesize the Markdown body (`# Title`, `## Why`, `## How to apply`) into a single cohesive architectural guide rather than tacking an "Update:" footnote onto the end, and refresh `verified: YYYY-MM-DD`.
   - Assign an appropriate `domain:` (e.g., `kubernetes`, `terraform`, `go`, `ci-cd`) and populate `related: [...]` with 1-hop lateral graph links to adjacent memories.

### 3. Determine Target Layer
Select the destination layer based on scope (`Workspace > Private > Team`):
- **Workspace Layer (`.agents/rules/memory/<slug>.md`):** Repo-specific architectural facts, domain rules, or internal APIs.
- **Private Layer (`~/.gemini/knowledge-capture/private/<slug>.md`):** Personal preferences, cross-repo patterns, debugging solutions, and evolved versions of Team rules.
- *(Note: Never write directly to read-only Team memory; when extending/repurposing a Team rule `<team-slug>`, write `<new-slug>.md` to Private with `overrides: <team-slug>` until promoted via `/kc-promote`.)*

### 4. Present Candidate Approval Table
Present proposed candidates to the developer using this exact table schema before writing to disk:

```markdown
### 💡 Knowledge Capture Candidates

| Action (CREATE \| EXTEND \| REPURPOSE-SLUG \| MERGE) | Layer | Target Slug (Old -> New) | Domain | Updated Trigger Description | Related Slugs | Summary of Content Synthesis |
| :--- | :---: | :--- | :---: | :--- | :--- | :--- |
| `REPURPOSE-SLUG` | `private` | `k8s-hpa-downscaling -> k8s-hpa-scaling-governance` | `kubernetes` | **Old:** When configuring HPA stabilization windows<br>**New:** When configuring HPA scaling policies, stabilization windows, or PodDisruptionBudget alignment | `[k8s-pdb-configuration, helm-values-schema]` | Synthesizes HPA scale-down stabilization with PDB minAvailable coordination and CPU target calculations |
```

### 5. Mandatory Approval Halt
Halt the turn and await explicit developer confirmation (e.g., "save all", "approve", "add `<slug>`", or decline). **Never write, rename, or delete memory files on disk without explicit consent.**

### 6. Persist to Disk & Execute Reference Re-Wiring
Upon developer approval:
1. **Write Target Memory File:** Write `<target-slug>.md` adhering strictly to the standardized YAML frontmatter schema (`name`, `type`, `domain`, `description`, `verified`, `overrides`, `related`).
2. **Clean Rename & Reference Re-Wiring (`REPURPOSE-SLUG` / `EXTEND & RENAME` / `MERGE`):**
   - **Within `Workspace` or `Private`:** Write `<new-slug>.md` and remove `<old-slug>.md` (via `git mv` if tracked, or `fs.unlink` / `rm`) so orphan files are never left behind.
   - **Cross-File Reference Update:** Scan all other `.md` files in `Workspace` (`.agents/rules/memory/`) and `Private` (`~/.gemini/knowledge-capture/private/`) and automatically update any `related: [...]` or `overrides: <old-slug>` references so they point to `<new-slug>`.
   - **Expanding a `Team` Rule:** If the memory being extended/repurposed lives in read-only `Team` (`<old-team-slug>`), write the expanded `<new-slug>.md` in `Private` with `overrides: <old-team-slug>` so the narrower team rule is cleanly shadowed until promoted via `/kc-promote`.
3. **No Auto-Commit:** Do not run `git commit` or `git push` during capture. Inform the developer that the changes are saved locally and can be committed/pushed anytime via `/kc-commit`.
