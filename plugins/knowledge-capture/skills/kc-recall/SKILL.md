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

### 1. Scan Memory Index (`search_memories` or `get_memory_summary`)
Call the MCP tool **`search_memories`** for natural-language semantic matching:
- Pass `query: "<natural language description of task or error>"` to perform fast hybrid FTS5 + cosine similarity matching across memory titles, triggers, and bodies with confidence scores.
- Alternatively, call **`get_memory_summary`** with `domain` or `query` filters to scan full tables grouped by `### Domain: <domain>` with precedence shadowing (`Workspace > Private > Team`).

### 2. Match Active Context & Traverse 1-Hop Graph (`get_memory_content`)
Evaluate whether any memory `slug` or `Trigger / Description` directly relates to the current task or problem:
- Invoke `get_memory_content` (with a single `slug` or batch `slugs: [...]`) to retrieve the full guideline body.
- Inspect the `### Related Memories Available (1-Hop Graph)` footer appended at the bottom of the returned content. If a 1-hop linked memory is directly relevant to the task, fetch it via `get_memory_content` as well.
- Do not load guidelines that are unrelated to the current task.

### 3. Apply Silently
Incorporate the retrieved facts, conventions, and gotchas directly into your solution without unnecessary narration or mid-task overhead. (Any evaluation of co-triggered or fragmented memories is deferred to `kc-capture` during end-of-task candidate determination.)
