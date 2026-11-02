---
name: kc-init
description: Initialize Knowledge Capture directories, validate Git remote connectivity, and configure settings. Triggered by /kc-init or /kc-setup.
user-invocable: true
---

# Knowledge Capture Initialization (`/kc-init`)

This skill configures the environment, storage directories, and remote Git links for Knowledge Capture across platforms.

## Workflow

1. **Inspect Current Environment:**
   Run:
   ```bash
   node ./bin/status.js
   ```
   Show current paths, whether settings exist, and Git sync status.

2. **Scaffold Directory Layout:**
   Execute setup script:
   ```bash
   node ./bin/setup.js
   ```
   This ensures:
   * `~/.gemini/knowledge-capture/private/`
   * `~/.gemini/knowledge-capture/team/`
   * `~/.gemini/knowledge-capture/settings.json`

3. **Configure Team Memory Remote:**
   Ask the developer:
   * Supply their team memory repository URL (e.g. `git@github.com:org/shared-team-memory.git`), OR
   * Keep team memory unconfigured / local-only.
   
   If a URL is provided, test connectivity:
   ```bash
   git ls-remote "<teamRepoUrl>" HEAD
   ```
   If connectivity fails, alert them to verify SSH keys or PAT access.

4. **Configure Private Memory Remote:**
   Explain the choices for private memory:
   * **GitHub Private Repo (Recommended):** Keeps personal memories synced across workstations.
   * **Local-Only:** Stored on this machine under `~/.gemini/knowledge-capture/private/`, initialized with Git locally without a remote.
   
   If a URL is provided, test connectivity:
   ```bash
   git ls-remote "<privateRepoUrl>" HEAD
   ```

5. **Persist Settings & Clone/Init:**
   Save configuration:
   ```bash
   node ./bin/setup.js --private-url "<privateUrl>" --team-url "<teamUrl>"
   ```
   If team URL is provided, trigger initial clone:
   ```bash
   node ./bin/pull.js team
   ```

6. **Confirm Next Steps:**
   Confirm that:
   - The `SessionStart` hook will synchronize team memory and audit uncommitted changes on every session.
   - MCP tools `get_memory_summary` and `get_memory_content` will retrieve memories on demand.
   - Run `/kc-status` anytime to view health across layers.
