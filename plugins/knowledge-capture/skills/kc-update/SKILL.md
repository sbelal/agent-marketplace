---
name: kc-update
description: Check for updates and automatically upgrade Knowledge Capture (and marketplace plugins) upon user instruction. Triggered by /kc-update, /plugin-update, or requests like "update knowledge-capture" or "update all plugins".
user-invocable: true
---

# Plugin Update & Upgrade Workflow (`/kc-update`)

This skill allows the agent to safely and automatically check for updates and upgrade Knowledge Capture and marketplace plugins when instructed by the user.

## Workflow

### 1. Inspect Current Installation Mode & Update Status
Execute a query to inspect current installation state:
```bash
npx git+https://github.com/sbelal/agent-marketplace.git --status-json
```
Evaluate:
- Is the plugin operating in **Source-Mode** (`isGlobalSource: true` or `isWorkspaceSource: true`)?
- Is it operating in **Copy-Mode** (`installedWorkspaceCount > 0` or `installedGlobalCount > 0`)?
- Are updates currently available?

### 2. Execute Headless Upgrade

#### If Source-Mode (`plugins.json`):
The monorepo source is linked live. Execute a git fast-forward pull on the source repository:
```bash
# Update source via universal installer:
npx git+https://github.com/sbelal/agent-marketplace.git --update-source
```
This instantly updates all marketplace plugins with zero file copying.

#### If Copy-Mode (Individual Copied Plugins):
Execute headless plugin update to refresh engine code without affecting user data:
```bash
# To update knowledge-capture specifically:
npx git+https://github.com/sbelal/agent-marketplace.git --update knowledge-capture

# Or to update all outdated plugins:
npx git+https://github.com/sbelal/agent-marketplace.git --update all
```

### 3. Verify Operational Readiness & User Data Safety
Call the MCP tool `get_layer_statistics` to verify that user memories and settings in `~/.gemini/knowledge-capture/` remain intact and active.

### 4. Report Update Summary to User
Display an update confirmation card in chat:

```markdown
### 🚀 Plugin Update Completed

- **Plugin:** `knowledge-capture`
- **Deployment Mode:** `<Source-Mode (git) | Copy-Mode>`
- **Status:** Up to date!
- **Data Safety:** All memories in `~/.gemini/knowledge-capture/` and personal settings are 100% preserved.

*Note: Restart your Antigravity agent or IDE session if new MCP tools or skills were introduced.*
```
