---
name: kc-commit
description: Audit, commit, and push uncommitted memory files in the Local Global Private layer to Git. Triggered by /kc-commit [message].
user-invocable: true
---

# Commit Private Memory (`/kc-commit`)

This skill reviews uncommitted changes in `~/.gemini/knowledge-capture/private/`, audits them for sensitive data, commits them, and pushes to the configured remote repository.

> [!IMPORTANT]
> Never run this skill against the Team clone! Team changes travel strictly through `/kc-promote` and an approved GitHub Pull Request.

## Workflow

1. **Verify Git Initialization & Status:**
   Inspect `~/.gemini/knowledge-capture/private/`.
   If `.git` is missing:
   * Prompt user to run `/kc-init` to configure a remote repository or initialize local version control.
   
   Check working tree status:
   ```bash
   git -C ~/.gemini/knowledge-capture/private status --short
   ```
   * If clean: inform the user: *"All private memory files are clean; no uncommitted changes found."* Terminate workflow.
   * If changes exist: parse modified, added, and deleted `.md` files.

2. **Safety & Privacy Audit:**
   Inspect the pending diff:
   ```bash
   git -C ~/.gemini/knowledge-capture/private diff
   ```
   Halt immediately and alert the user if any of the following are found:
   * **Secrets / Credentials:** AWS keys, personal API tokens, private keys, database passwords.
   * **Transient incident details:** Temporary URLs or tokens that should not be permanently stored.

3. **Formulate Proposed Commit Message:**
   - If `$ARGUMENTS` was provided by the user, use it as the commit message.
   - Otherwise, formulate a structured commit message from the modified slugs:
     ```text
     feat(memory): update knowledge entries: <slug-1>, <slug-2>
     ```

4. **Request User Approval:**
   Present the list of changed files and proposed commit message in chat.
   Ask: *"Captain, do you approve staging, committing, and pushing these changes?"*

5. **Execute Commit & Remote Push:**
   Upon approval, execute in `~/.gemini/knowledge-capture/private/`:
   ```bash
   git -C ~/.gemini/knowledge-capture/private add -A
   git -C ~/.gemini/knowledge-capture/private commit -m "<approved-commit-message>"
   ```
   Check if a remote Git origin is configured:
   ```bash
   git -C ~/.gemini/knowledge-capture/private remote get-url origin
   ```
   If a remote URL is present:
   ```bash
   git -C ~/.gemini/knowledge-capture/private push origin HEAD
   ```
   If push is rejected because upstream has newer commits:
   - Alert the user and advise running `git -C ~/.gemini/knowledge-capture/private pull --rebase` or `/kc-pull private`.
   
   Report the commit hash and remote push confirmation.
