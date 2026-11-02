---
name: kc-status
description: Display comprehensive storage status, configured Git remotes, working branch states, and uncommitted modifications across all memory layers. Triggered by /kc-status.
user-invocable: true
---

# Skill: Knowledge Capture Status (`/kc-status`)

Display the operational health, Git synchronization status, branch details, and entry counts across all memory layers.

## Workflow

1. Execute the cross-platform status utility:
   ```bash
   node ./bin/status.js
   ```

2. Present the formatted output to the developer.

3. If uncommitted modifications or divergent branches are detected, guide the user:
   - **Uncommitted Private Changes:** Suggest running `/kc-commit` to review, audit, and push changes.
   - **Uncommitted Team Changes:** Remind the user that the team store should not be edited directly; suggest `/kc-promote` to prepare a promotion branch.
   - **Active Promotion Branch:** If the team clone is on `promote/<date>-<slug>`, remind the user to check out `main` and pull once their PR is merged.
   - **Upstream Commits Available:** If the team clone is behind upstream, suggest running `/kc-pull`.
