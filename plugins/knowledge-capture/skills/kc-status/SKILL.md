---
name: kc-status
description: Display comprehensive storage status, active domain breakdown, stale entry counts (>180 days), configured Git remotes, working branch states, and uncommitted modifications across all memory layers. Triggered by /kc-status.
user-invocable: true
---

# Skill: Knowledge Capture Status (`/kc-status`)

> **Plugin script location (`<plugin-root>`):** Bundled scripts live in this plugin's `bin/` directory. In Claude Code, `<plugin-root>` is `${CLAUDE_PLUGIN_ROOT}` (Claude Code substitutes the absolute install path). If that variable appears literally (unsubstituted, e.g. in Antigravity), `<plugin-root>` is the plugin directory itself: run the scripts as `./bin/...` from it. Always quote the path.

Display the operational health, Git synchronization status, branch details, per-domain entry breakdown, and staleness audit (`verified` > 180 days or missing) across all memory layers.

## Workflow

1. Execute the cross-platform status utility (or call `get_layer_statistics` via MCP):
   ```bash
   node "<plugin-root>/bin/status.js"
   ```

2. Present the formatted output to the developer, explicitly surfacing:
   - **Layer Entry Counts:** `Workspace`, `Private`, and `Team` counts (and active total after precedence shadowing).
   - **Domain Breakdown:** Entry counts per `domain` across active layers (e.g., `kubernetes (12), terraform (8), general (4)`).
   - **Stale Entries (`verified` > 180 days or missing):** Total stale count and affected slugs.

3. If uncommitted modifications, stale entries, or divergent branches are detected, guide the user:
   - **Stale Entries (>180 days or missing `verified`):** Suggest running `/kc-consolidate` to review, refresh, or prune aging rules.
   - **Uncommitted Private Changes:** Suggest running `/kc-commit` to review, audit, and push changes.
   - **Uncommitted Team Changes:** Remind the user that the team store should not be edited directly; suggest `/kc-promote` to prepare a promotion branch.
   - **Active Promotion Branch:** If the team clone is on `promote/<date>-<slug>`, remind the user to check out `main` and pull once their PR is merged.
   - **Upstream Commits Available:** If the team clone is behind upstream, suggest running `/kc-pull`.
