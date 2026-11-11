---
name: kc-archeology
description: Mine repository Git commit history, revert messages, and bug fixes to uncover uncodified gotchas, workarounds, and team conventions. Triggered by /kc-archeology or requests like "mine git history", "find past gotchas in commits", or "knowledge archeology".
user-invocable: true
---

# Skill: Historical Tacit Knowledge Archeology (`/kc-archeology`)

This skill performs deep tacit knowledge archeology across the project's Git commit history. It analyzes commit messages, reverts, hotfixes, race condition patches, and workarounds to surface critical undocumented knowledge and propose structured memory candidates for the **Workspace** or **Private** layer.

---

## Workflow

### 1. Pre-Scan Existing Memories (`get_memory_summary`)
Before formulating candidates, invoke:
```text
get_memory_summary(layer="all")
```
to avoid proposing duplicate memories for conventions or gotchas that are already documented.

### 2. Mine Git History (`mine_git_history_memories`)
Call the MCP tool **`mine_git_history_memories(maxCommits=100)`** to inspect recent commit logs:
- **Bug & Hotfix Commits:** Scans for commits resolving elusive bugs (`fix:`, `hotfix:`, `patch:`, `memory leak`, `oom`, `timeout`).
- **Workarounds & Gotchas:** Detects explicit workaround indicators (`workaround:`, `quirk:`, `caveat:`, `temporary fix`).
- **Reverts & Regressions:** Analyzes `revert:` commits to identify fragile configurations or incompatible package versions.
- **Concurrency & Resource Issues:** Extracts solutions for race conditions, deadlocks, and connection exhaustion.

### 3. Present Discovered Tacit Knowledge Candidates
Present the archeology findings in chat using this markdown table schema:

```markdown
### ⛏️ Git Knowledge Archeology Discoveries

| Action | Target Slug | Domain | Type | Trigger Description | Source Commit |
| :--- | :--- | :---: | :---: | :--- | :--- |
| `ARCHEOLOGY-CREATE` | `git-fix-postgres-pool-exhaustion` | `database` | `tool-gotcha` | When configuring connection pools or observing socket timeouts | `a8b2c4d1` (2026-08-14) |
| `ARCHEOLOGY-CREATE` | `git-revert-react-concurrent-hydration` | `frontend` | `tool-gotcha` | When setting up React 19 hydration with custom SSR headers | `f4e3d2c1` (2026-09-02) |
| `ARCHEOLOGY-CREATE` | `git-fix-docker-buildx-cache-invalidation` | `ci-cd` | `convention` | When optimizing Docker multi-stage build cache in CI pipelines | `c9d8e7f6` (2026-10-11) |
```

**Mandatory Halt:** Ask the developer:
> *"Which historical learnings would you like to codify into memory (`workspace` or `private`)?"*
> Wait for explicit developer authorization (e.g. "save all", "save 1 to workspace", or decline). **Never write memory files to disk without explicit developer confirmation.**

### 4. Persist Approved Candidates via MCP Tool
Upon developer confirmation:
1. For each approved entry, call:
   ```text
   save_memory_entry(
     layer=selectedLayer, // 'workspace' or 'private'
     slug=cand.slug,
     title=cand.title,
     domain=cand.domain,
     type=cand.type,
     description=cand.description,
     why=cand.why,
     howToApply=cand.howToApply,
     verified=cand.verified
   )
   ```
2. Confirm memory creation and summarize the codified insights.
3. Recommend running `/kc-status` or `/kc-graph` to visualize the newly integrated knowledge nodes.
