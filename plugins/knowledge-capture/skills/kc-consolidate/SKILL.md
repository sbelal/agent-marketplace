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
- **Private Layer:** `~/.gemini/knowledge-capture/private/` (default write target)
- **Workspace Layer:** `.agents/rules/memory/`
- **Team Layer:** `~/.gemini/knowledge-capture/team/` (read-only locally; consolidated via promotion branch)
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

**Mandatory Halt:** Ask: *"Captain, do you approve executing these consolidation and lint actions?"*
Wait for explicit confirmation.

### 4. Execute Filesystem Operations & Reference Re-Wiring
Upon user confirmation:
1. Write merged/repurposed memory file(s) with updated `name`, `domain`, expanded `description`, refreshed `verified: YYYY-MM-DD`, and `related: [...]` links.
2. Delete superseded or pruned file(s) in `Workspace` or `Private` so no orphan files remain.
3. **Automatic Reference Re-Wiring:** Scan all remaining `.md` files in `Workspace` and `Private` and update any `related: [...]` or `overrides:` references that pointed to merged/renamed slugs so they point to the new canonical slug.
4. Report Git status and remind the user:
   - For **Private** layer: Run `/kc-commit` to review, commit, and push the consolidation.
   - For **Team** layer: Stage changes via `/kc-promote` on an isolated `promote/<date>-<slug>` branch.
