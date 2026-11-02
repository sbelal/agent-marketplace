# Claude Code Plugin Installation & Management Guide

This guide details how to add this repository as a decentralized marketplace and install plugins within Claude Code.

---

## 🚀 Quickstart: Adding the Marketplace

Claude Code supports decentralized marketplaces out of the box. Add this repository to Claude Code's plugin manager:

```bash
claude plugin marketplace add https://github.com/sbelal/agent-marketplace.git
```

Verify that the marketplace was registered:
```bash
claude plugin marketplace list
```

---

## 📦 Installing Plugins

Once the marketplace is registered, you can install any catalog plugin by its identifier:

```bash
# Install Knowledge Capture memory system:
claude plugin install knowledge-capture

# Install Syran Logic Officer persona:
claude plugin install syran-persona
```

### Enabling and Disabling Plugins

By default, newly installed plugins are enabled. To manage their state:

```bash
# Disable a plugin:
claude plugin disable knowledge-capture

# Enable a plugin:
claude plugin enable knowledge-capture

# List installed plugins and statuses:
claude plugin list
```

---

## 🔄 Updating Plugins

To keep your plugins up to date with the latest features and fixes:

### 1. Update the Marketplace Catalog:
```bash
claude plugin marketplace update agent-marketplace
```

### 2. Update Installed Plugins:
```bash
# Update a specific plugin:
claude plugin update knowledge-capture

# Update all installed plugins:
claude plugin update --all
```

---

## 🗑️ Uninstallation

To completely remove a plugin from Claude Code:

```bash
claude plugin uninstall knowledge-capture
```

To remove the marketplace registry:
```bash
claude plugin marketplace remove agent-marketplace
```

---

## 💡 Claude Code Commands & Skills

### Knowledge Capture (`knowledge-capture`)
- `/kc-status`: Inspects memory counts, layer health, uncommitted entries, and Git sync status.
- `/kc-init`: Configures personal and team storage repositories.
- `/kc-commit`: Stages and commits private memory entries.
- `/kc-promote`: Promotes a private memory candidate to the team Git branch.
- `/kc-consolidate`: Deduplicates overlapping entries and optimizes guidelines.
- `/kc-pull`: Synchronizes upstream team memories.
*Background capabilities (`kc-capture` and `kc-recall`) operate automatically via hook triggers and the MCP server.*

### Syran: The Logic Officer (`syran-persona`)
- **Automatic Persona Injection:** The plugin's `SessionStart` hook (`hooks/hooks.json`) automatically injects the Syran persona directives into starting context upon launch.
- `/syran-consult`: Formally analyzes an architectural dilemma, code change, or proposition for logical validity, probability, and risk.
- `/syran-status`: Reports the operational readiness, directives, and MCP tool health of the Logic Officer.
- **MCP Server Tools (`syran-logic`):** Automatically available to Claude Code: `syran_consult`, `syran_analyze_fallacies`, `syran_evaluate_probability`, and `syran_get_status`.
