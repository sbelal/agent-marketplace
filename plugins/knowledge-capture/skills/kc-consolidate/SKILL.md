---
name: kc-consolidate
description: Consolidate, de-duplicate, prune, and cross-reference memory entries across Workspace, Private, or Team storage. Triggered by /kc-consolidate.
user-invocable: true
---

# Consolidate Memory (`/kc-consolidate`)

This skill reviews, deduplicates, merges, and prunes memory entries to maintain clean, compact, high-signal knowledge stores.

## Workflow

### 1. Identify Scope
Determine the target memory store:
- **Private Layer:** `~/.gemini/knowledge-capture/private/` (default)
- **Team Layer:** `~/.gemini/knowledge-capture/team/`
- **Workspace Layer:** `.agents/rules/memory/`

If the user passed a specific layer or topic argument, target that scope; otherwise default to Private memory.

### 2. Audit & Group Candidates
Use `get_memory_summary` to scan all entries in the target layer:
1. Identify overlapping or redundant memory files covering the same tool, framework, or operational issue.
2. Identify stale entries that reference deprecated versions, obsolete tooling, or transient bug workarounds that have since been fixed upstream.
3. Identify vague or non-actionable memories that provide no specific guidance.

### 3. Formulation of Merge & Prune Plan
- **Merge Rules:**
  - Consolidate related fragments into a single canonical slug.
  - Retain all distinct gotchas and edge-case instructions.
  - Set the latest `verified:` date.
  - Formulate a single, sharp `description` / `trigger`.
- **Prune Rules:**
  - Delete obsolete, duplicate, or trivial files.

### 4. Present Plan & Await User Authorization
Output a structured plan before making any file modifications:
```markdown
### 🧹 Memory Consolidation Plan (Scope: Private)

| Action | Target Slug | Source / Obsolete Files | Rationale |
| :--- | :--- | :--- | :--- |
| **Merge** | `docker-build-caching` | `docker-cache.md`, `docker-layers.md` | Combines buildkit flags and layer caching into one guide |
| **Prune** | `node-v14-dns-bug` | `node-v14-dns-bug.md` | Node 14 is EOL; issue resolved in current Node LTS |

*(Merged files follow the schema in `AGENTS.md` with updated `verified:` timestamp.)*
```

**Mandatory Halt:** Ask: *"Captain, do you approve executing these consolidation actions?"*
Wait for explicit confirmation.

### 5. Execute Filesystem Operations
Upon user confirmation:
1. Write the merged file(s).
2. Remove the superseded or pruned file(s).
3. If the layer is a Git repository, report status and remind the user:
   - For Private layer: Run `/kc-commit` to commit the consolidation.
   - For Team layer: Stage changes and prepare a promotion branch.
