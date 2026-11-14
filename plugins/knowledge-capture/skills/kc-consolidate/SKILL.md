---
name: kc-consolidate
description: Execute a full "Lint & Dream" audit to consolidate fragmented/co-triggered slugs, prune orphaned overrides or redundant private copies, repair broken 1-hop graph links, and refresh stale (>180d) or conflicting memory entries. Triggered by /kc-consolidate [scope|domain].
user-invocable: true
---

# Consolidate & Lint Memory (`/kc-consolidate`)

This skill performs a comprehensive 4-point **"Lint & Dream"** pass across memory layers to merge fragmented rules (Full-Envelope Repurposing), clean up orphaned overrides, repair broken `related` graph links, and resolve stale or contradictory entries.

## Workflow

### 1. Identify Scope & Inspect Layer Statistics
Determine the target memory store or domain from arguments (`/kc-consolidate [layer|domain]`):
- **Private Layer:** Resolved via `get_layer_statistics().paths.privateDir` (default `~/.gemini/knowledge-capture/private/`, default write target)
- **Workspace Layer:** `.agents/rules/memory/`
- **Team Layer:** Resolved via `manage_team_repositories({ action: 'list' })` (`<storage-dir>/team/<slug>/`, read-only locally; updated via `/kc-promote`)
- **Domain Filter:** If a domain name (e.g., `kubernetes`, `terraform`, `go`) is passed, focus the consolidation pass on that domain while cross-checking all layers.

Call `get_layer_statistics` and `get_memory_summary(layer="all")` first to obtain the full domain index, precedence shadowing map, and staleness report.

### 2. Execute the 4-Point "Lint & Dream" Audit
Inspect entries across the target scope using `get_memory_summary` and `get_memory_content`:

1. **Fragmented / Co-Triggered Slugs (Full-Envelope Merge & Repurpose):**
   - Identify narrow slugs within the same `domain` that have adjacent or overlapping trigger `description`s and frequently co-trigger for the same engineering tasks (e.g., `k8s-hpa-stabilization` + `k8s-hpa-cpu-target-calculation`).
   - Propose merging them into a single repurposed slug (`<new-broader-slug>`) with an expanded `description:` trigger and unified Markdown body.
2. **Orphaned Overrides & Redundant Private Copies:**
   - Flag `Private` entries whose `overrides: <slug>` target no longer exists upstream in `Team`.
   - Flag `Private` entries that have already been promoted identically to `Team` (making the local `Private` copy redundant).
3. **Broken Graph Links (`related: [...]`):**
   - Inspect the `### Related Memories Available (1-Hop Graph)` footer (or `related` frontmatter) across entries.
   - Flag any entry whose `related: [...]` array points to `[unresolved/broken reference]` (non-existent or previously renamed slugs) and propose either re-wiring to the renamed slug or pruning the dead link.
   - Suggest adding bidirectional or 1-hop `related: [...]` links between orthogonal rules that frequently intersect.
4. **Staleness (>180 Days) & Contradictions:**
   - Flag entries where `verified: YYYY-MM-DD` is older than **180 days** (or missing/invalid) as surfaced by `get_layer_statistics`.
   - Flag contradictory rules across or within layers where guidance conflicts without an explicit `overrides:` relationship.

### 3. Present Plan & Await User Authorization
Output a structured consolidation & lint plan before making any file modifications:

```markdown
### 🧹 Memory Consolidation & Lint Plan (Scope: Private / Domain: kubernetes)

| Audit Category | Action | Target Slug (Old -> New) | Source / Affected Files | Updated Trigger / Rationale |
| :--- | :--- | :--- | :--- | :--- |
| **1. Fragmented Slugs** | `MERGE & REPURPOSE` | `k8s-hpa-scaling-governance` | `k8s-hpa-downscaling.md`, `k8s-hpa-cpu-targets.md` | **New Trigger:** When configuring HPA stabilization windows, CPU targets, or PDB scaling alignment |
| **2. Orphaned Override** | `PRUNE-REDUNDANT` | `helm-oci-auth` | `private/helm-oci-auth.md` | Already promoted identically to `team/helm-oci-auth.md` |
| **3. Broken Graph Link** | `REWIRE-LINK` | `eks-irsa-trust-policy` | `private/eks-irsa-trust-policy.md` | Update `related: [k8s-hpa-downscaling]` -> `related: [k8s-hpa-scaling-governance]` |
| **4. Staleness (>180d)** | `REFRESH / PRUNE` | `node-v14-dns-bug` | `private/node-v14-dns-bug.md` | `verified: 2025-01-10` (>180d old); Node 14 is EOL |

*(Merged and updated files follow the standardized schema in `AGENTS.md` with refreshed `verified:` timestamps.)*
```

**Mandatory Halt:** Ask: *"Do you approve executing these consolidation and lint actions?"*
Wait for explicit confirmation.

### 4. Execute Operations & Reference Re-Wiring via MCP Tools
Upon user confirmation:
1. **Execute via MCP Mutation Tools:**
   - **For Merges:** Call `merge_memory_entries(layer, targetSlug, sourceSlugs, title, why, howToApply, type, domain, description, related, overrides)`. Automatically writes the target file, unlinks all source files, and updates all incoming `related:` and `overrides:` references across the layer!
   - **For Pruning / Deletions:** Call `delete_memory_entry(layer, slug)`. Removes the file and cleans up dangling references.
   - **For Refreshed Rules:** Call `save_memory_entry(...)` with bumped `verified: YYYY-MM-DD`.
2. Report the operational status and remind the user:
   - For **Private** layer: Run `/kc-commit` to review, commit, and push the consolidation.
   - For **Team** layer: Stage changes via `/kc-promote` on an isolated `promote/<date>-<slug>` branch.
