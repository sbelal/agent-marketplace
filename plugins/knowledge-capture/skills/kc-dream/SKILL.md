---
name: kc-dream
description: Execute automated "Memory Dreaming" & Semantic Synthesis to discover fragmented, overlapping, or co-triggered memories across layers, cluster them via dense semantic multi-vectors, and synthesize consolidated master architectural guidelines. Triggered by /kc-dream [domain|threshold].
user-invocable: true
---

# Automated Memory Dreaming & Semantic Synthesis (`/kc-dream`)

This skill executes autonomous semantic consolidation ("Memory Dreaming") across persistent memory layers. It identifies fragmented facets of common systems, clusters semantically overlapping rules using dense multi-vectors, and synthesizes unified master guidelines to optimize token efficiency and eliminate architectural fragmentation.

## Workflow

### 1. Identify Scope & Clustering Parameters
Determine the dream scope and optional thresholds from user input (`/kc-dream [domain] [threshold]`):
- **Domain Filter (Optional):** Restricts semantic clustering to a single domain (e.g. `kubernetes`, `terraform`, `go`, `ci-cd`). Defaults to analyzing all domains.
- **Similarity Threshold (Optional):** Cosine similarity threshold for clustering (default: `0.65`).
- **Workspace Scope:** Current project root (`workspaceRoot`).

### 2. Run Semantic Dreaming Engine
Invoke the MCP tool:
```json
{
  "name": "dream_memory_consolidation",
  "arguments": {
    "domain": "<optional-domain>",
    "threshold": 0.65
  }
}
```

The dreaming engine performs:
1. **Multi-Vector Semantic Profiling:** Computes dense vector embeddings across trigger descriptions, rule content, and entity tags for all active memories.
2. **Dense Cosine Clustering:** Groups entries sharing semantic intent, overlapping triggers, or fragmented sub-rules of the same architectural subsystem.
3. **Synthesis & Deduplication:** Generates a unified trigger description, merged guidelines body, and calculates projected token savings.

### 3. Review Proposed Dream Consolidations
Present the discovered clusters and synthesized candidate proposals clearly to the user:

```markdown
### 🌙 Autonomous Memory Dreaming & Synthesis Report

| Cluster | Domain | Member Slugs | Proposed Master Slug | Token Savings | Recommendation |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **cluster-1** | `kubernetes` | `k8s-cpu-limits`, `k8s-mem-limits` | `k8s-resource-governance` | ~20% | Consolidate narrow limit rules into a master governance rule |
| **cluster-2** | `ci-cd` | `github-actions-caching`, `npm-ci-cache` | `ci-cache-optimization` | ~25% | Synthesize unified caching guideline |

#### Proposed Master Entry: `k8s-resource-governance`
- **Domain:** `kubernetes`
- **Trigger Description:** When configuring Kubernetes CPU and memory requests, limits, or Quality of Service (QoS) classes
- **Unified Body Preview:**
  [Synthesized guideline preview]
```

### 4. Await User Confirmation & Apply
Ask the user:
> *"Do you approve consolidating these memory clusters into master guidelines?"*

Upon user approval:
1. Save each synthesized master rule using `save_memory_entry` with `layer="workspace"` or `layer="private"`.
2. Clean up or deprecate superseded member slugs using `delete_memory_entry` or by adding `overrides:` frontmatter.
3. Verify SQLite index synchronization via `search_memories`.
