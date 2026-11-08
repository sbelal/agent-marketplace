---
name: kc-recall
description: >
  Recall relevant persistent memory guidelines, domain rules, and 1-hop related graph links,
  while monitoring for co-triggered memory fragmentation. Use at the start of complex tasks,
  before the first reply, or after context compaction.
user-invocable: false
disable-slash-command: true
---

# Skill: Knowledge Recall (`kc-recall`)

Retrieve past engineering guidelines and team conventions relevant to the active task using MCP tools, and detect co-retrieval fragmentation signals.

## Workflow

### 1. Scan Memory Index (`get_memory_summary`)
Call the MCP tool `get_memory_summary` to inspect active memory entries across `Workspace`, `Private`, and `Team` layers:
- Pass `domain` (e.g., `"kubernetes"`, `"terraform"`, `"go"`, `"ci-cd"`) or `query` keyword filters when the task targets a specific domain or subsystem, or scan `layer: "all"` for broad architectural tasks.
- The summary groups active rules by `### Domain: <domain>` while automatically shadowing overridden lower-tier rules (`Workspace > Private > Team`).

### 2. Match Active Context & Traverse 1-Hop Graph (`get_memory_content`)
Evaluate whether any memory `slug` or `Trigger / Description` directly relates to the current task or problem:
- Invoke `get_memory_content` (with a single `slug` or batch `slugs: [...]`) to retrieve the full guideline body.
- Inspect the `### Related Memories Available (1-Hop Graph)` footer appended at the bottom of the returned content. If a 1-hop linked memory is directly relevant to the task, fetch it via `get_memory_content` as well.
- Do not load guidelines that are unrelated to the current task.
- Apply retrieved facts and gotchas silently into your engineering execution without unnecessary narration.

### 3. Co-Retrieval Consolidation Detection Heuristic
Whenever a single task or problem triggers **2 or more memories simultaneously** during recall (or requires pulling multiple closely coupled slugs across steps to answer one architectural/debugging question), evaluate whether those memories are artificially fragmented:

- **Case A — Distinct Concerns (Keep Separate + Link):**
  If the memories represent genuinely separate domains or orthogonal concerns that happen to intersect on this task (e.g., `go-error-wrapping` and `postgres-connection-pooling`), keep them separate (and optionally suggest linking them via `related: [...]` at task wrap-up).
- **Case B — Fragmented Facets of One Concept (Propose Consolidation at Wrap-Up):**
  If 2 or more triggered memories belong to the same `domain` or layer and address tightly coupled facets of the same subsystem (e.g., `k8s-hpa-stabilization` and `k8s-hpa-cpu-target-calculation`):
  1. **Do NOT interrupt** the user's primary engineering task mid-flight.
  2. Hold a **"Co-Retrieval Consolidation Note"** in working context until task completion (alongside `kc-capture`).
  3. At task completion, proactively flag the co-triggered slugs to the developer:
     > *"During this task, memories `<slug-a>` and `<slug-b>` were triggered together. Would you like me to merge and repurpose them into a single unified memory (`<proposed-merged-slug>`) with an expanded trigger description?"* (Or suggest running `/kc-consolidate <domain>`.)

### 4. Execution on Consolidation Approval
If the developer confirms merging the co-triggered memories:
1. Synthesize their contents into a unified Markdown guide under `<proposed-merged-slug>.md` with an expanded `description:` covering all combined trigger scenarios and an updated `verified: YYYY-MM-DD` date.
2. Remove the superseded file(s) in `Workspace` or `Private` (or set `overrides: <team-slug>` if superseding a read-only `Team` rule).
3. Scan `Workspace` and `Private` memory files and re-wire any `related: [...]` or `overrides:` pointers referencing the old slugs so they point to `<proposed-merged-slug>`.
