---
name: kc-pull
description: Fast-forward the local team or private memory clone from its configured Git remote upstream. Triggered by /kc-pull [team|private|all].
user-invocable: true
---

# Skill: Pull Memory Upstream (`/kc-pull`)

Fast-forward the local memory repositories with the latest changes from their upstream remotes.

## Workflow

1. Identify the target store from the command arguments (`team`, `private`, or `all`). Default to `team`.

2. Execute the pull utility:
   ```bash
   node ./bin/pull.js <target>
   ```

3. Report the outcome cleanly:
   - If changes were pulled, confirm that memory is now up to date.
   - If the pull fails due to uncommitted local changes, guide the user to stash, commit, or resolve them before pulling.
   - If the team clone is currently on a promotion branch (`promote/*`), remind the user to check out `main` before pulling:
     ```bash
     git -C ~/.gemini/knowledge-capture/team checkout main
     node ./bin/pull.js team
     ```
