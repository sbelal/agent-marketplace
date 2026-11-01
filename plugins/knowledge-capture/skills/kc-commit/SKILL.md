---
name: kc-commit
description: Commit and push uncommitted memory files in the Local Global Private layer to Git. Triggered by /kc-commit.
---

# Commit Private Memory (`/kc-commit`)

This skill reviews uncommitted changes in `~/.gemini/knowledge-capture/private/`, commits them, and pushes to the configured remote repository.

## Workflow

1. **Verify Git Initialization:**
   Inspect `~/.gemini/knowledge-capture/private/`.
   If `.git` is missing:
   * Inform the user: *"The Private memory layer is not currently initialized as a Git repository. Would you like to initialize it and add a remote URL?"*
   * If approved, run `git init -b main` in the private directory.

2. **Audit Pending Changes:**
   Execute in `~/.gemini/knowledge-capture/private/`:
   ```bash
   git status --porcelain
   ```
   * If empty: inform the user: *"All private memory files are clean; no uncommitted changes found."* Terminate workflow.
   * If changes exist: parse modified, added, and deleted `.md` files.

3. **Formulate Proposed Commit Message:**
   Inspect changed files to identify the affected memory slugs. Format a clear commit message:
   ```text
   feat(memory): update knowledge entries: <slug-1>, <slug-2>
   ```

4. **Request User Approval:**
   Present the list of changed files and proposed commit message in chat.
   Ask: *"Captain, do you approve staging, committing, and pushing these changes?"*

5. **Execute Commit & Remote Push:**
   Upon approval, execute in `~/.gemini/knowledge-capture/private/`:
   ```bash
   git add -A
   git commit -m "<approved-commit-message>"
   ```
   Check if a remote Git origin is configured:
   ```bash
   git remote get-url origin
   ```
   If a remote URL is present:
   ```bash
   git push origin HEAD
   ```
   Report the commit hash and remote push confirmation.
