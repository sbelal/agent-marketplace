---
name: kc-recall
description: >
  Recall relevant persistent memory guidelines, domain rules, and 1-hop related graph links.
  Use at the start of complex tasks, before the first reply, or after context compaction.
user-invocable: false
disable-slash-command: true
---

# Skill: Knowledge Recall (`kc-recall`)

Retrieve past engineering guidelines and team conventions relevant to the active task using MCP tools with minimal token overhead.

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

### 3. Apply Silently
Incorporate the retrieved facts, conventions, and gotchas directly into your solution without unnecessary narration or mid-task overhead. (Any evaluation of co-triggered or fragmented memories is deferred to `kc-capture` during end-of-task candidate determination.)
