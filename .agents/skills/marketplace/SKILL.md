---
name: marketplace
description: State-aware plugin marketplace setup and management wizard. Uses native interactive questions/choices to install, configure, update, or toggle marketplace plugins. Triggered by /marketplace or requests like "set up plugins" or "manage marketplace".
user-invocable: true
---

# Agent Marketplace Setup & Management Wizard (`/marketplace`)

This skill allows the agent to guide the developer through installing, updating, and managing marketplace plugins using native interactive questions/choices instead of terminal readline prompts. It automatically detects current installation state and eliminates redundant options (e.g. omitting global source installation if already active).

## Workflow

### 1. Query Current Installation State
Execute the headless state inspector:
```bash
node ./bin/install.js --status-json
```

Parse the JSON output to determine:
- `isGlobalSource`: Is monorepo registered in `~/.gemini/config/plugins.json`?
- `isWorkspaceSource`: Is monorepo registered in `.agents/plugins.json`?
- `installedWorkspaceCount` & `installedGlobalCount`: Are individual plugins copied?
- `updatesAvailable`: Are any plugins outdated?
- `relevantActions`: Context-filtered list of valid actions for the current state.

---

### 2. Present State-Aware Interactive Choices

#### Under Google Antigravity:
Call the **`ask_question`** tool to render an interactive modal with selectable choices.

- **Scenario A: Global Source Mode is Already Active (`isGlobalSource: true`)**
  > **Crucial Rule:** Do NOT offer to install Global Source Mode because that is what the user is currently using!
  
  Call `ask_question`:
  - `question`: "Agent Marketplace is currently active in Global Source Mode (all catalog plugins linked). What would you like to do?"
  - `options`:
    - "(Recommended) Check for updates & pull latest changes"
    - "Configure plugin settings (e.g. Knowledge Capture Git remotes)"
    - "Enable or disable catalog plugins"
    - "Copy a specific plugin to this workspace (.agents/plugins/ for pinning)"
    - "View active plugins & inventory"
    - "Remove Global Source Mode"

- **Scenario B: Workspace Source Mode is Active (`isWorkspaceSource: true`)**
  Call `ask_question`:
  - `question`: "Agent Marketplace is currently scoped to this workspace. What would you like to do?"
  - `options`:
    - "(Recommended) Check for updates & sync workspace"
    - "Promote to Global Scope (~/.gemini/config/plugins.json) to use across all projects"
    - "Enable or disable catalog plugins"
    - "Configure plugin settings"
    - "Remove Workspace Source Mode"

- **Scenario C: Copy-Deployment Mode is Active (`installedCount > 0`)**
  Call `ask_question`:
  - `question`: "You have individual copied plugins installed. What would you like to do?"
  - `options`:
    - "(Recommended) Switch to Global Source-Mode (Zero-copy & auto git updates)"
    - "Check for updates & upgrade installed plugins"
    - "Install additional plugins from catalog"
    - "Enable or disable installed plugins"
    - "Uninstall a plugin"

- **Scenario D: Fresh System (No plugins or sources installed)**
  Call `ask_question`:
  - `question`: "How would you like to install plugins from Agent Marketplace?"
  - `options`:
    - "(Recommended) Mode 2: Global Source-Mode - Links entire monorepo in ~/.gemini/config/plugins.json with auto-git updates"
    - "Mode 2: Workspace Source-Mode - Links monorepo to .agents/plugins.json for current project only"
    - "Mode 1: Individual Plugin Copy - Copies specific plugins directly"

#### Under Claude Code:
Present the corresponding state-aware multiple-choice options using Claude Code's interactive choice prompts.

---

### 3. Execute Selected Action Headlessly

Based on the developer's choice, run the appropriate headless CLI command:

- **Check/Apply Updates:**
  - If Source Mode: `node ./bin/install.js --update-source` (or `git pull --ff-only`)
  - If Copy Mode: `node ./bin/install.js --update all`
- **Register Global Source:**
  `node ./bin/install.js --source --scope global`
- **Register Workspace Source:**
  `node ./bin/install.js --source --scope workspace`
- **Install Individual Plugin:**
  `node ./bin/install.js --plugin <id> --scope <workspace|global>`
- **Toggle Enable / Disable:**
  `node ./bin/install.js --enable <id>` OR `node ./bin/install.js --disable <id>`
- **Configure Knowledge Capture:**
  Invoke `/kc-init` skill.
- **Remove Source:**
  `node ./bin/install.js --uninstall source --scope <workspace|global>`

---

### 4. Confirm Completion
Report the outcome cleanly with next steps. Remind the developer to restart the agent session if plugins were newly added or removed.
