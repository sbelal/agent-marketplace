---
name: kc-recall
description: >
  Recall relevant persistent memory guidelines and team conventions.
  Use at the start of complex tasks, before the first reply, or after context compaction.
user-invocable: false
disable-slash-command: true
---

# Skill: Knowledge Recall

Retrieve past engineering guidelines and team conventions relevant to the active task using MCP tools.

## Workflow

1. **Scan Memory Index:**
   Call the MCP tool `get_memory_summary` to inspect active memory entries across Workspace, Private, and Team layers.

2. **Match Active Context:**
   Evaluate whether any memory slug or trigger description directly relates to the current task or problem.

3. **Retrieve Content On-Demand:**
   If a matching memory is found, invoke `get_memory_content(layer, slug)` to retrieve the full guideline body.
   - Do not load guidelines that are not relevant to the current task.
   - Respect precedence: Workspace overrides Private, Private overrides Team (`overrides: <slug>`).

4. **Apply Silently:**
   Incorporate the retrieved facts and gotchas into your solution without unnecessary narration to the user.
