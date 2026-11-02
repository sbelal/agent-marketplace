# Antigravity Plugin Installation & Management Guide

This comprehensive guide details how to install, configure, update, and manage plugins from this repository within Google Antigravity.

---

## 🎯 Use-Case Decision Matrix: Which Installation Method is Best?

Antigravity supports two deployment architectures. Use this table to choose the right mode and scope for your workflow:

| Target Goal / Scenario | Recommended Method | Target Scope | Why this is the optimal choice |
| :--- | :---: | :---: | :--- |
| **"I want all marketplace plugins available and effortlessly kept up to date."** | **Mode 2: Source-Mode (`plugins.json`)** ⭐ *(Recommended)* | **Global** (`~/.gemini/config/plugins.json`) | Antigravity mounts the entire monorepo directly. When new plugins or updates are pushed, a simple `git pull` instantly refreshes all plugins with zero file copying. |
| **"I want all marketplace plugins active, but only inside this specific project."** | **Mode 2: Source-Mode (`plugins.json`)** | **Workspace** (`.agents/plugins.json`) | Scopes the entire catalog to the active repository without polluting other workspaces. |
| **"I only need one specific plugin (e.g. `knowledge-capture`) across all my projects."** | **Mode 1: Individual Plugin Copy** | **Global** (`~/.gemini/config/plugins/<id>`) | Installs an isolated, self-contained plugin folder globally without cloning or linking the rest of the monorepo. |
| **"I want a team member to clone my project and have the plugin work immediately without setup."** | **Mode 1: Individual Plugin Copy** | **Workspace** (`.agents/plugins/<id>`) | Bundles the complete plugin directly inside `.agents/plugins/`. When committed to project Git, teammates get the functionality instantly with zero external dependencies. |
| **"I need an immutable, pinned version that does not change when upstream commits are made."** | **Mode 1: Individual Plugin Copy** | **Workspace or Global** | Snapshot installation locks the plugin code at the installed version until explicitly upgraded. |

---

## 🚀 Quickstart: Universal Interactive Installer

Run the interactive installer directly in your terminal using `npx`:

```bash
npx git+https://github.com/sbelal/agent-marketplace.git
```

The interactive terminal wizard will launch:
```text
============================================================
       🪐 Antigravity Universal Plugin Tool & Manager       
============================================================
1. 📦 Install Individual Plugin(s) (Copy Deployment)
2. 🔗 Add Monorepo as Plugin Source (plugins.json)
3. 🔄 Check for Updates & Upgrade Plugins
4. 📋 View Installed Plugins & Active Sources
5. ⚡ Activate / Deactivate Plugins (Enable / Disable)
6. 🗑️  Uninstall Plugin or Remove Source Entry
7. ❌ Exit
```

---

## 🛠️ Installation Modes Detailed

### Mode 1: Individual Plugin Installation (Copy Deployment)

Mode 1 copies the plugin's complete assets (`plugin.json`, `skills/`, `rules/`, `mcp-server/`, `bin/`) into the Antigravity discovery tree.

#### Target Scopes:
- **Workspace Scope:** `<workspace>/.agents/plugins/<plugin-id>/`
  - Active only while working inside the current repository.
  - Can be committed to version control (`git add .agents/plugins`) to share with team members.
- **Global Scope:** `~/.gemini/config/plugins/<plugin-id>/`
  - Active across all workspaces and CLI sessions on your machine.

#### Headless CLI Commands:
```bash
# Install specific plugin to workspace:
npx git+https://github.com/sbelal/agent-marketplace.git --plugin knowledge-capture --scope workspace

# Install specific plugin globally:
npx git+https://github.com/sbelal/agent-marketplace.git --plugin syran-persona --scope global

# Install all plugins to workspace:
npx git+https://github.com/sbelal/agent-marketplace.git --plugin all --scope workspace
```

---

### Mode 2: Monorepo Source Registration (`plugins.json`)

Mode 2 registers the repository path in Antigravity's declarative `plugins.json`. Antigravity's language server will dynamically mount all plugins found in the repository without copying any files.

#### Target Scopes:
- **Workspace Scope:** `<workspace>/.agents/plugins.json`
- **Global Scope:** `~/.gemini/config/plugins.json`

#### Declarative Schema:
```json
{
  "entries": [
    {
      "path": "C:/Users/<username>/.gemini/sources/agent-marketplace/plugins"
    }
  ]
}
```

#### Headless CLI Commands:
```bash
# Register monorepo source in current workspace:
npx git+https://github.com/sbelal/agent-marketplace.git --source --scope workspace

# Register monorepo source globally:
npx git+https://github.com/sbelal/agent-marketplace.git --source --scope global
```

---

## ⚡ Plugin Activation & Lifecycle (Enable / Disable)

In Antigravity, discovering a plugin directory is distinct from activating it. Antigravity tracks active plugins in `~/.gemini/config/config.json` under `"plugins": { "<plugin-id>": { "enabled": true } }`. A plugin with `"enabled": false` will remain dormant even if present on disk.

### 1. Automatic Activation
Our installer **automatically activates plugins for you**:
- When installing via Mode 1 (`--plugin <id>`), the installer copies the files and immediately configures `"enabled": true` in Antigravity's configuration.
- When registering via Mode 2 (`--source`), the installer adds the entry and automatically enables all catalog plugins.

### 2. Managing Activation via the Installer
You can toggle or inspect activation states anytime using the installer:
```bash
# Enable / activate a plugin:
npx git+https://github.com/sbelal/agent-marketplace.git --enable knowledge-capture

# Deactivate / disable a plugin:
npx git+https://github.com/sbelal/agent-marketplace.git --disable knowledge-capture

# Check activation status across all plugins:
npx git+https://github.com/sbelal/agent-marketplace.git --list
```

### 3. Alternative Activation Methods
- **Antigravity CLI:** Run `agy plugin enable <name>` or `agy plugin disable <name>`.
- **In-Session Slash Command:** Type `/plugin enable <name>` or `/plugin disable <name>` directly in chat.
- **Antigravity IDE UI:** Open the **Customizations** page (or Settings > Plugins) and toggle the plugin switch.

---

## 🔄 Updates & Version Management

### How to Check for Updates

1. **Lightweight Startup Hook Notice:**
   Plugins with a `SessionStart` hook (such as `knowledge-capture`) periodically check if a newer version is available. A notification will appear in your session output when an update is published.
2. **On-Demand Audit:**
   Run the version audit command at any time:
   ```bash
   npx git+https://github.com/sbelal/agent-marketplace.git --check-updates
   ```

### How to Apply Updates

#### For Mode 1 (Copied Plugins):
Run the update command to overwrite the plugin code with the latest version:
```bash
# Update all installed plugins:
npx git+https://github.com/sbelal/agent-marketplace.git --update all

# Update a specific plugin:
npx git+https://github.com/sbelal/agent-marketplace.git --update knowledge-capture
```
> [!NOTE]
> **User Data Isolation Guarantee:** Upgrades strictly refresh plugin engine files (`skills/`, `rules/`, `bin/`). Personal configurations and user state (such as `~/.gemini/knowledge-capture/` memories) reside outside the plugin directory and are **never deleted or overwritten**.

#### For Mode 2 (Source-Mode `plugins.json`):
Because Antigravity loads the live directory, updates propagate automatically as soon as the git repository is pulled:
```bash
# If cloned to permanent cache:
npx git+https://github.com/sbelal/agent-marketplace.git --update-source

# Or pull directly inside your cloned repo:
git -C /path/to/agent-marketplace pull --ff-only
```

#### In-Session Antigravity Update (`/plugin update <name>`):
Inside an active Antigravity chat session:
- If you ask Antigravity to **"update knowledge-capture"** or run **`/plugin update knowledge-capture`**, the agent checks whether the plugin is registered via `plugins.json` or copied locally, and executes the appropriate update procedure automatically.

---

## 📋 Inspection & Uninstallation

### View Installed Plugins and Sources:
```bash
npx git+https://github.com/sbelal/agent-marketplace.git --list
```

### Uninstall Plugins:
```bash
# Uninstall a plugin from workspace:
npx git+https://github.com/sbelal/agent-marketplace.git --uninstall knowledge-capture --scope workspace

# Uninstall a plugin globally:
npx git+https://github.com/sbelal/agent-marketplace.git --uninstall knowledge-capture --scope global
```

### Remove Monorepo Source Entry:
```bash
# Remove source from workspace plugins.json:
npx git+https://github.com/sbelal/agent-marketplace.git --uninstall source --scope workspace

# Remove source from global plugins.json:
npx git+https://github.com/sbelal/agent-marketplace.git --uninstall source --scope global
```

---

## 🔌 Post-Installation Discovery

Newly copied plugin directories or `plugins.json` entries are mounted upon session start.
1. Restart your Antigravity IDE session or open a new terminal prompt.
2. Type `/` in chat to view newly available slash commands and skills.
3. For `knowledge-capture`, verify MCP tools with `/kc-status` or ask the agent to run `get_memory_summary`.
