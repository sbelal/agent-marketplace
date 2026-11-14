---
name: kc-commit
description: Audit, commit, and push uncommitted memory files in the Local Global Private layer to Git. Triggered by /kc-commit [message].
user-invocable: true
---

# Commit Private Memory (`/kc-commit`)

This skill reviews uncommitted changes in the Local Global Private layer (`<private-dir>`, resolved via `get_layer_statistics().paths.privateDir`, or `${KC_STORAGE_DIR:-${GEMINI_HOME:-$HOME/.gemini}/knowledge-capture}/private`), audits them for sensitive data, commits them, and pushes to the configured remote repository.

> [!IMPORTANT]
> Never run this skill against a Team clone! Team changes travel strictly through `/kc-promote` and an approved GitHub Pull Request.

## Workflow

1. **Verify Git Initialization & Status:**
   Resolve `<private-dir>` from `get_layer_statistics().paths.privateDir` (or `${KC_STORAGE_DIR:-${GEMINI_HOME:-$HOME/.gemini}/knowledge-capture}/private`).
   If `.git` is missing:
   * Prompt user to run `/kc-init` to configure a remote repository or initialize local version control.

   Check working tree status:
   ```bash
   git -C "<private-dir>" status --short
   ```
   * If clean: inform the user: *"All private memory files are clean; no uncommitted changes found."* Terminate workflow.
   * If changes exist: parse modified, added, and deleted `.md` files.

2. **Safety & Privacy Audit:**
   Inspect the pending diff:
   ```bash
   git -C "<private-dir>" diff
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
   Ask: *"Do you approve staging, committing, and pushing these changes?"*

5. **Execute Commit & Remote Push:**
   Upon approval, execute in `<private-dir>`:
   ```bash
   git -C "<private-dir>" add -A
   git -C "<private-dir>" commit -m "<approved-commit-message>"
   ```
   Check if a remote Git origin is configured:
   ```bash
   git -C "<private-dir>" remote get-url origin
   ```
   If a remote URL is present:
   ```bash
   git -C "<private-dir>" push origin HEAD
   ```
   If push is rejected because upstream has newer commits:
   - Alert the user and advise running `git -C "<private-dir>" pull --rebase` or `/kc-pull private`.

   Report the commit hash and remote push confirmation.
