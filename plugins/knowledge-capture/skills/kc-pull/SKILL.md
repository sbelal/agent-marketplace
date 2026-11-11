---
name: kc-pull
description: Fast-forward the local team or private memory clone from its configured Git remote upstream. Triggered by /kc-pull [team|private|all].
user-invocable: true
---

# Skill: Pull Memory Upstream (`/kc-pull`)

> **Plugin script location (`<plugin-root>`):** Bundled scripts live in this plugin's `bin/` directory. In Claude Code, `<plugin-root>` is `${CLAUDE_PLUGIN_ROOT}` (Claude Code substitutes the absolute install path). If that variable appears literally (unsubstituted, e.g. in Antigravity), `<plugin-root>` is the plugin directory itself: run the scripts as `./bin/...` from it. Always quote the path.

Fast-forward the local memory repositories with the latest changes from their upstream remotes.

## Workflow

1. Identify the target store from the command arguments (`team`, `private`, or `all`). Default to `team`.

2. Call the MCP tool **`sync_memory_layer({ layer: target })`** directly (or execute `node "<plugin-root>/bin/pull.js" <target>` from terminal).

3. Report the outcome cleanly:
   - If changes were pulled, confirm that memory is now up to date.
   - If the pull fails due to uncommitted local changes, guide the user to stash, commit, or resolve them before pulling.
   - If the team clone is currently on a promotion branch (`promote/*`), remind the user to check out `main` before pulling:
     ```bash
     git -C ~/.gemini/knowledge-capture/team checkout main
     node "<plugin-root>/bin/pull.js" team
     ```
