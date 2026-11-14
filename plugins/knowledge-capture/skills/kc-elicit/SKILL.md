---
name: kc-elicit
description: Audit uncommitted working tree diffs and modified files to automatically detect, elicit, and propose session-end memory candidates before context loss or session wrap-up. Triggered by /kc-elicit or requests like "elicit session memories" or "wrap up session knowledge".
user-invocable: true
---

# Skill: Session-End Auto-Elicitation (`/kc-elicit`)

This skill acts as a session wrap-up sentinel, inspecting uncommitted git diffs, newly modified modules, dependencies, and test fixtures to automatically synthesize high-value memory proposals before a session concludes or before conversation context is compacted.

---

## Workflow

### 1. Audit Session Activity (`auto_elicit_session_knowledge`)
Call the MCP tool **`auto_elicit_session_knowledge()`** to inspect the workspace:
- Analyzes git status and modified file types (code modules, package dependencies, unit tests, configuration).
- Determines if active changes exist and whether memories were recorded during the current session.
- Synthesizes 1 to 3 structured memory proposals based on the observed changes.

### 2. Present Elicitation Review to Developer
If changes were found, present the structured proposals:

```markdown
### 💡 Session-End Knowledge Elicitation Review

| Action | Target Slug | Layer | Domain | Type | Proposed Description |
| :--- | :--- | :---: | :---: | :---: | :--- |
| `ELICIT-SAVE` | `session-dependency-updates` | `workspace` | `architecture` | `convention` | When updating project package dependencies or runtime toolchains |
| `ELICIT-SAVE` | `session-test-regression-rules` | `workspace` | `testing` | `tool-gotcha` | When running or writing test suites for recently modified modules |
```

**Developer Interaction:**
Ask the developer:
> *"Active changes were detected in this session. Would you like to capture any of these proposed memories into Workspace (`.agents/rules/memory/`) or Private (`paths.privateDir` from `get_layer_statistics`, default `~/.gemini/knowledge-capture/private/`) storage?"*
> Wait for confirmation before creating entries. Never commit or write files without explicit approval.


### 3. Persist Approved Memories via MCP Tool
Upon developer confirmation:
1. Call `save_memory_entry` with the appropriate layer and parameters for each approved memory.
2. Confirm memory persistence and remind the developer that workspace rules can be committed to the repository for team synchronization.
