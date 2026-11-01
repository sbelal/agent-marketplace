---
name: kc-init
description: Initialize Knowledge Capture directories, settings template, and Git repository links. Triggered by /kc-init or when setting up multi-layer memory storage.
---

# Knowledge Capture Initialization (`/kc-init`)

This skill configures the environment and storage directories for Knowledge Capture.

## Workflow

1. **Inspect Environment:**
   Check if `~/.gemini/knowledge-capture/settings.json` exists.
   If present, display current configuration to the user.

2. **Execute Scaffolding:**
   Run the setup script:
   ```bash
   node ./bin/setup.js
   ```
   This ensures:
   * Directory created: `~/.gemini/knowledge-capture/private/`
   * Directory created: `~/.gemini/knowledge-capture/team/`
   * Config template created: `~/.gemini/knowledge-capture/settings.json`

3. **Configure Git Remotes (Optional):**
   Ask the user if they have remote Git repository URLs for:
   * **Private Memory Repository** (e.g., `https://github.com/user/my-private-memory.git`)
   * **Team Memory Repository** (e.g., `https://github.com/team/shared-team-memory.git`)

   If provided, update settings:
   ```bash
   node ./bin/setup.js --private-url "<url>" --team-url "<url>"
   ```

4. **Status Report:**
   Output confirmation of active paths and Git sync status.
