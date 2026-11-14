#!/usr/bin/env node

/**
 * install.js
 * 
 * Interactive TUI and headless CLI installer for Antigravity plugins.
 * Adheres strictly to Command-Query Separation (CQS) and Single Responsibility Principle (SRP).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { execFileSync } = require('child_process');

const {
  normalizePath,
  resolveSourceConfigPath,
  getPluginsConfig,
  findSourceEntry,
  findMarketplaceSourceEntry,
  addSourceEntry,
  removeSourceEntry
} = require('./source-manager');

const {
  resolvePluginInstallPath,
  getAvailablePlugins,
  getInstalledPluginInfo,
  compareVersions,
  getPluginInventory,
  getSystemInstallationState,
  checkMarketplaceUpdates,
  installPlugin,
  uninstallPlugin,
  updatePlugin,
  setPluginEnabled,
  isPluginEnabled
} = require('./plugin-manager');

// ==========================================
// ENVIRONMENT RESOLUTION (Pure Queries)
// ==========================================

const REPO_ROOT = path.resolve(__dirname, '..');
const WORKSPACE_DIR = process.cwd();
const HOME_DIR = process.env.USERPROFILE || process.env.HOME || os.homedir();
const REMOTE_REPO_URL = 'https://github.com/sbelal/agent-marketplace.git';

/**
 * Checks whether this script is executing inside a temporary npx cache.
 * 
 * @param {string} rootDir 
 * @returns {boolean}
 */
function isNpxExecution(rootDir) {
  const norm = normalizePath(rootDir).toLowerCase();
  return norm.includes('/_npx/') || norm.includes('/npm-cache/') || norm.endsWith('/_npx');
}

/**
 * Resolves the persistent source directory to register in plugins.json.
 * 
 * @param {string} rootDir 
 * @param {string} homeDir 
 * @returns {string} Path to plugins directory
 */
function resolveSourceRegistrationPath(rootDir, homeDir) {
  if (isNpxExecution(rootDir)) {
    // If running via npx, point to a permanent sources directory
    return path.join(homeDir, '.gemini', 'sources', 'agent-marketplace', 'plugins');
  }
  // Otherwise point to local repo's plugins directory
  return path.join(rootDir, 'plugins');
}

/**
 * Resolves all git-backed marketplace source plugin directories to update.
 * Prefers registered git clone sources in workspace/global plugins.json before falling back
 * to the local/npx default registration path.
 *
 * @param {string} repoRoot
 * @param {string} workspaceDir
 * @param {string} homeDir
 * @returns {string[]}
 */
function resolveUpdateSourceTargets(repoRoot, workspaceDir, homeDir) {
  const targets = [];
  const seen = new Set();

  for (const scope of ['workspace', 'global']) {
    const configPath = resolveSourceConfigPath(scope, workspaceDir, homeDir);
    if (!configPath) continue;
    const matched = findMarketplaceSourceEntry(getPluginsConfig(configPath), repoRoot, homeDir);
    if (!matched || !matched.path) continue;
    const resolvedPluginsPath = path.resolve(matched.path);
    const repoDir = path.dirname(resolvedPluginsPath);
    if (fs.existsSync(path.join(repoDir, '.git'))) {
      const normKey = normalizePath(resolvedPluginsPath).toLowerCase();
      if (!seen.has(normKey)) {
        seen.add(normKey);
        targets.push(resolvedPluginsPath);
      }
    }
  }

  if (targets.length === 0) {
    targets.push(resolveSourceRegistrationPath(repoRoot, homeDir));
  }

  return targets;
}

// ==========================================
// COMMAND PROCEDURES (State Mutation & I/O)
// ==========================================

/**
 * Ensures permanent git clone exists when registering source via npx.
 * 
 * @param {string} targetPluginsPath 
 * @returns {boolean}
 */
function ensurePermanentSourceClone(targetPluginsPath) {
  const cloneDir = path.dirname(targetPluginsPath);
  if (fs.existsSync(cloneDir)) {
    try {
      console.log(`\x1b[36mSynchronizing permanent source repository in ${cloneDir}...\x1b[0m`);
      execFileSync('git', ['pull', '--ff-only'], { cwd: cloneDir, stdio: 'inherit' });
      return true;
    } catch (err) {
      console.warn(`\x1b[33mWarning: git pull failed in ${cloneDir}: ${err.message}\x1b[0m`);
      return false;
    }
  }

  console.log(`\x1b[36mCloning permanent source repository to ${cloneDir}...\x1b[0m`);
  try {
    fs.mkdirSync(path.dirname(cloneDir), { recursive: true });
    execFileSync('git', ['clone', '--depth', '1', REMOTE_REPO_URL, cloneDir], { stdio: 'inherit' });
    return true;
  } catch (err) {
    console.error(`\x1b[31mError cloning repository: ${err.message}\x1b[0m`);
    return false;
  }
}

// ==========================================
// PRESENTATION FORMATTERS
// ==========================================

function printHeader() {
  console.log('\n\x1b[36m============================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m       🪐 Antigravity Universal Plugin Tool & Manager       \x1b[0m');
  console.log('\x1b[36m============================================================\x1b[0m');
  console.log(`\x1b[90mWorkspace: ${WORKSPACE_DIR}\x1b[0m`);
  console.log(`\x1b[90mRepository: ${REPO_ROOT}\x1b[0m\n`);
}

function printInventoryReport() {
  const inventory = getPluginInventory(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);

  console.log('\x1b[1m\x1b[34m--- Discovered Catalog Plugins ---\x1b[0m');
  inventory.items.forEach(p => {
    console.log(`\n\x1b[1m• ${p.displayName}\x1b[0m \x1b[33m(id: ${p.id}, v${p.version})\x1b[0m`);
    console.log(`  \x1b[90mDescription: ${p.description}\x1b[0m`);

    const wsStatus = p.workspaceInstalled
      ? `\x1b[32mInstalled (v${p.workspaceVersion})\x1b[0m${p.workspaceNeedsUpdate ? ' \x1b[31m[UPDATE AVAILABLE]\x1b[0m' : ''}`
      : '\x1b[90mNot Installed\x1b[0m';
    console.log(`  Workspace: ${wsStatus}`);

    const glStatus = p.globalInstalled
      ? `\x1b[32mInstalled (v${p.globalVersion})\x1b[0m${p.globalNeedsUpdate ? ' \x1b[31m[UPDATE AVAILABLE]\x1b[0m' : ''}`
      : '\x1b[90mNot Installed\x1b[0m';
    console.log(`  Global:    ${glStatus}`);

    const isInstalled = p.workspaceInstalled || p.globalInstalled || p.sourceActive;
    const actStatus = p.enabled
      ? '\x1b[32mActive (Enabled)\x1b[0m'
      : (isInstalled ? '\x1b[33mInactive (Disabled)\x1b[0m' : '\x1b[90mNot Installed\x1b[0m');
    console.log(`  Status:    ${actStatus}`);
  });

  console.log('\n\x1b[1m\x1b[34m--- Active plugins.json Declarations ---\x1b[0m');
  console.log(`• Workspace Scope: ${inventory.sources.workspace.active ? '\x1b[32mACTIVE (Monorepo Linked)\x1b[0m' : '\x1b[90mNone\x1b[0m'}`);
  if (inventory.sources.workspace.entries.length > 0) {
    inventory.sources.workspace.entries.forEach(e => console.log(`    \x1b[90m↳ ${e.path}\x1b[0m`));
  }

  console.log(`• Global Scope:    ${inventory.sources.global.active ? '\x1b[32mACTIVE (Monorepo Linked)\x1b[0m' : '\x1b[90mNone\x1b[0m'}`);
  if (inventory.sources.global.entries.length > 0) {
    inventory.sources.global.entries.forEach(e => console.log(`    \x1b[90m↳ ${e.path}\x1b[0m`));
  }
  console.log('');
}

function printUpdateAudit() {
  const inventory = getPluginInventory(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);
  console.log('\n\x1b[1m\x1b[34m--- Plugin Version & Update Audit ---\x1b[0m\n');

  let updateFound = false;

  inventory.items.forEach(p => {
    if (p.workspaceInstalled) {
      const up = p.workspaceNeedsUpdate;
      if (up) updateFound = true;
      console.log(`• [Workspace] ${p.name}: installed v${p.workspaceVersion} | available v${p.version} -> ${up ? '\x1b[31mUpdate Available!\x1b[0m' : '\x1b[32mUp to date\x1b[0m'}`);
    }
    if (p.globalInstalled) {
      const up = p.globalNeedsUpdate;
      if (up) updateFound = true;
      console.log(`• [Global]    ${p.name}: installed v${p.globalVersion} | available v${p.version} -> ${up ? '\x1b[31mUpdate Available!\x1b[0m' : '\x1b[32mUp to date\x1b[0m'}`);
    }
  });

  if (!updateFound) {
    console.log('\x1b[32mAll installed plugins are running the latest version!\x1b[0m\n');
  } else {
    console.log('\n\x1b[33mRun `--update all` or use Option 3 in the interactive menu to apply updates.\x1b[0m\n');
  }
}

// ==========================================
// INTERACTIVE CLI WIZARD
// ==========================================

function runInteractiveWizard() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const prompt = (query) => new Promise(resolve => rl.question(query, resolve));

  async function mainMenu() {
    printHeader();
    const state = getSystemInstallationState(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);

    // State Detection & Notification Banner
    if (state.isGlobalSource && state.isWorkspaceSource) {
      console.log('\x1b[32m🪐 Current State: 🔗 Monorepo Source [Dual-Scope Active (Global & Workspace)]\x1b[0m');
      console.log('\x1b[90mAll catalog plugins are mounted from repository source.\x1b[0m\n');
    } else if (state.isGlobalSource) {
      console.log('\x1b[32m🪐 Current State: 🔗 Monorepo Source [Global Scope Active]\x1b[0m');
      console.log('\x1b[90mAll catalog plugins are mounted globally and automatically updated via git.\x1b[0m\n');
    } else if (state.isWorkspaceSource) {
      console.log('\x1b[32m🪐 Current State: 🔗 Monorepo Source [Workspace Scope Active]\x1b[0m');
      console.log('\x1b[90mCatalog plugins are scoped exclusively to this project.\x1b[0m\n');
    } else if (state.installedWorkspaceCount > 0 || state.installedGlobalCount > 0) {
      console.log(`\x1b[33m📦 Current State: Copy Deployment (${state.installedWorkspaceCount} workspace, ${state.installedGlobalCount} global)\x1b[0m\n`);
    } else {
      console.log('\x1b[90m⚪ Current State: No marketplace plugins or sources configured yet.\x1b[0m\n');
    }

    if (state.updatesAvailable) {
      console.log('\x1b[31m🚀 UPDATE AVAILABLE: One or more installed plugins have newer versions ready to upgrade!\x1b[0m\n');
    }

    // Dynamically construct menu based on current installation state
    const menuActions = [];

    if (state.isGlobalSource) {
      // NOTE: "Install source-based global install (repo clone)" is INTENTIONALLY EXCLUDED
      // because that is what the user currently is using!
      menuActions.push({
        label: state.updatesAvailable ? '🔄 Check for Updates & Upgrade Plugins \x1b[31m[UPDATE AVAILABLE]\x1b[0m' : '🔄 Check for Updates & Pull Latest (git)',
        handler: () => handleUpdateMenu(prompt)
      });
      menuActions.push({
        label: '⚡ Activate / Deactivate Plugins (Enable / Disable)',
        handler: () => handleToggleActivationMenu(prompt)
      });
      if (!state.isWorkspaceSource) {
        menuActions.push({
          label: '📦 Pin / Copy Plugin to Workspace (.agents/plugins/)',
          handler: () => handleInstallPluginMenu(prompt, 'workspace')
        });
      }
      menuActions.push({
        label: '📋 View Installed Plugins & Active Sources',
        handler: async () => {
          printInventoryReport();
          await prompt('Press Enter to return to main menu...');
        }
      });
      menuActions.push({
        label: '🗑️  Remove Global Source Entry',
        handler: async () => {
          const confirm = (await prompt('Remove Global Source Mode? (y/N): ')).trim().toLowerCase();
          if (confirm === 'y') {
            const configPath = resolveSourceConfigPath('global', WORKSPACE_DIR, HOME_DIR);
            const targetSourcePath = resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
            removeSourceEntry(configPath, targetSourcePath);
            console.log(`\x1b[32m✔ Global source removed from ${configPath}.\x1b[0m`);
          }
          await prompt('Press Enter to continue...');
        }
      });
    } else if (state.isWorkspaceSource) {
      menuActions.push({
        label: state.updatesAvailable ? '🔄 Check for Updates & Upgrade Plugins \x1b[31m[UPDATE AVAILABLE]\x1b[0m' : '🔄 Check for Updates & Pull Latest (git)',
        handler: () => handleUpdateMenu(prompt)
      });
      menuActions.push({
        label: '⚡ Activate / Deactivate Plugins (Enable / Disable)',
        handler: () => handleToggleActivationMenu(prompt)
      });
      menuActions.push({
        label: '🔗 Promote Monorepo to Global Scope (~/.gemini/config/plugins.json)',
        handler: () => handleAddSourceDirect(prompt, 'global')
      });
      menuActions.push({
        label: '📋 View Installed Plugins & Active Sources',
        handler: async () => {
          printInventoryReport();
          await prompt('Press Enter to return to main menu...');
        }
      });
      menuActions.push({
        label: '🗑️  Remove Workspace Source Entry',
        handler: async () => {
          const confirm = (await prompt('Remove Workspace Source Mode? (y/N): ')).trim().toLowerCase();
          if (confirm === 'y') {
            const configPath = resolveSourceConfigPath('workspace', WORKSPACE_DIR, HOME_DIR);
            const targetSourcePath = resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
            removeSourceEntry(configPath, targetSourcePath);
            console.log(`\x1b[32m✔ Workspace source removed from ${configPath}.\x1b[0m`);
          }
          await prompt('Press Enter to continue...');
        }
      });
    } else if (state.installedWorkspaceCount > 0 || state.installedGlobalCount > 0) {
      menuActions.push({
        label: state.updatesAvailable ? '🔄 Upgrade Outdated Plugins \x1b[31m[UPDATE AVAILABLE]\x1b[0m' : '🔄 Check for Updates & Upgrade Plugins',
        handler: () => handleUpdateMenu(prompt)
      });
      menuActions.push({
        label: '⭐ Switch to Global Source-Mode (Recommended - Zero Copy & Auto Git Sync)',
        handler: () => handleAddSourceDirect(prompt, 'global')
      });
      menuActions.push({
        label: '📦 Install Additional Plugin(s)',
        handler: () => handleInstallPluginMenu(prompt)
      });
      menuActions.push({
        label: '⚡ Activate / Deactivate Plugins (Enable / Disable)',
        handler: () => handleToggleActivationMenu(prompt)
      });
      menuActions.push({
        label: '📋 View Installed Plugins & Active Sources',
        handler: async () => {
          printInventoryReport();
          await prompt('Press Enter to return to main menu...');
        }
      });
      menuActions.push({
        label: '🗑️  Uninstall Plugin',
        handler: () => handleUninstallMenu(prompt)
      });
    } else {
      menuActions.push({
        label: '⭐ Add Monorepo as Plugin Source (Global - Recommended)',
        handler: () => handleAddSourceDirect(prompt, 'global')
      });
      menuActions.push({
        label: '🔗 Add Monorepo as Plugin Source (Workspace Scope)',
        handler: () => handleAddSourceDirect(prompt, 'workspace')
      });
      menuActions.push({
        label: '📦 Install Individual Plugin(s) (Copy Deployment)',
        handler: () => handleInstallPluginMenu(prompt)
      });
      menuActions.push({
        label: '📋 View Catalog Inventory',
        handler: async () => {
          printInventoryReport();
          await prompt('Press Enter to return to main menu...');
        }
      });
    }

    menuActions.push({
      label: '❌ Exit',
      handler: () => {
        console.log('Goodbye!');
        rl.close();
        process.exit(0);
      }
    });

    console.log('\x1b[1mAvailable Actions:\x1b[0m');
    menuActions.forEach((action, idx) => {
      console.log(`${idx + 1}. ${action.label}`);
    });
    console.log('');

    const choice = (await prompt(`Select an option [1-${menuActions.length}]: `)).trim();
    const choiceIdx = parseInt(choice, 10);

    if (!isNaN(choiceIdx) && choiceIdx >= 1 && choiceIdx <= menuActions.length) {
      await menuActions[choiceIdx - 1].handler();
    } else if (choice.toLowerCase() === 'exit' || choice.toLowerCase() === 'quit') {
      console.log('Goodbye!');
      rl.close();
      return;
    } else {
      console.log('\x1b[31mInvalid option.\x1b[0m');
    }

    await mainMenu();
  }

  async function handleAddSourceDirect(promptFn, scope) {
    const configPath = resolveSourceConfigPath(scope, WORKSPACE_DIR, HOME_DIR);
    const targetSourcePath = resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);

    if (isNpxExecution(REPO_ROOT)) {
      const cloned = ensurePermanentSourceClone(targetSourcePath);
      if (!cloned) {
        console.error('\x1b[31mFailed to establish permanent source clone. Aborting.\x1b[0m');
        await promptFn('Press Enter to continue...');
        return;
      }
    }

    const added = addSourceEntry(configPath, targetSourcePath);
    if (added) {
      console.log(`\n\x1b[32m✔ Successfully registered source entry in ${configPath}:\x1b[0m`);
      console.log(`  \x1b[36m${normalizePath(targetSourcePath)}\x1b[0m`);

      const plugins = getAvailablePlugins(REPO_ROOT);
      for (const p of plugins) {
        setPluginEnabled(p.id, true, HOME_DIR);
      }
      console.log(`\x1b[32m✔ Automatically activated all catalog plugins (enabled: true in config.json)\x1b[0m`);
      console.log('\n\x1b[36mRestart your Antigravity agent or IDE session to mount plugins.\x1b[0m\n');
    } else {
      console.log(`\n\x1b[33mSource entry already exists in ${configPath}.\x1b[0m\n`);
    }

    await promptFn('Press Enter to continue...');
  }

  async function handleInstallPluginMenu(promptFn, forcedScope = null) {
    const plugins = getAvailablePlugins(REPO_ROOT);
    if (plugins.length === 0) {
      console.log('\x1b[31mNo plugins discovered in repository.\x1b[0m');
      return;
    }

    console.log('\n\x1b[1mAvailable Plugins:\x1b[0m');
    plugins.forEach((p, idx) => {
      console.log(`${idx + 1}. ${p.displayName} (v${p.version}) - ${p.id}`);
    });
    console.log(`${plugins.length + 1}. [All Plugins]`);
    console.log(`${plugins.length + 2}. < Cancel`);

    const sel = (await promptFn(`\nChoose plugin to install [1-${plugins.length + 2}]: `)).trim();
    const selIdx = parseInt(sel, 10);

    if (isNaN(selIdx) || selIdx < 1 || selIdx > plugins.length + 2 || selIdx === plugins.length + 2) {
      return;
    }

    let scope = forcedScope;
    if (!scope) {
      const state = getSystemInstallationState(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);
      console.log('\n\x1b[1mSelect Installation Scope:\x1b[0m');
      console.log('1. Current Workspace (.agents/plugins/)');
      if (!state.isGlobalSource) {
        console.log('2. Global Machine (~/.gemini/config/plugins/)');
        console.log('3. < Cancel');
      } else {
        console.log('2. < Cancel (Global already active via source-mode)');
      }

      const scopeSel = (await promptFn('Choose scope: ')).trim();
      if (scopeSel === '1') {
        scope = 'workspace';
      } else if (scopeSel === '2' && !state.isGlobalSource) {
        scope = 'global';
      } else {
        return;
      }
    }

    const targets = (selIdx === plugins.length + 1) ? plugins : [plugins[selIdx - 1]];

    for (const p of targets) {
      console.log(`\nInstalling \x1b[1m${p.displayName}\x1b[0m to ${scope} scope...`);
      try {
        const result = installPlugin(p.id, REPO_ROOT, scope, WORKSPACE_DIR, HOME_DIR);
        console.log(`\x1b[32m✔ Successfully installed to ${result.targetPath}\x1b[0m`);
        if (result.activated) {
          console.log(`\x1b[32m✔ Automatically activated in Antigravity config (enabled: true)\x1b[0m`);
        }
      } catch (err) {
        console.error(`\x1b[31m✖ Failed to install ${p.id}: ${err.message}\x1b[0m`);
      }
    }

    console.log('\n\x1b[36mInstallation complete! Restart your Antigravity agent or session to discover new skills.\x1b[0m\n');
    await promptFn('Press Enter to continue...');
  }


  async function handleUpdateMenu(promptFn) {
    printUpdateAudit();

    console.log('1. Upgrade All Outdated Plugins');
    console.log('2. Upgrade Monorepo Source Cache');
    console.log('3. < Cancel');

    const choice = (await promptFn('Select option [1-3]: ')).trim();
    if (choice === '1') {
      const inventory = getPluginInventory(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);
      let count = 0;
      for (const p of inventory.items) {
        const display = p.displayName || p.name;
        if (p.workspaceNeedsUpdate) {
          console.log(`Upgrading ${display} (Workspace)...`);
          try {
            updatePlugin(p.id, REPO_ROOT, 'workspace', WORKSPACE_DIR, HOME_DIR);
            count++;
          } catch (err) {
            console.error(`\x1b[31m✖ Failed updating ${display} (Workspace): ${err.message}\x1b[0m`);
          }
        }
        if (p.globalNeedsUpdate) {
          console.log(`Upgrading ${display} (Global)...`);
          try {
            updatePlugin(p.id, REPO_ROOT, 'global', WORKSPACE_DIR, HOME_DIR);
            count++;
          } catch (err) {
            console.error(`\x1b[31m✖ Failed updating ${display} (Global): ${err.message}\x1b[0m`);
          }
        }
      }
      console.log(`\x1b[32m\nUpgraded ${count} plugin(s).\x1b[0m\n`);
    } else if (choice === '2') {
      const targetSourcePath = resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
      ensurePermanentSourceClone(targetSourcePath);
    }

    await promptFn('Press Enter to continue...');
  }

  async function handleToggleActivationMenu(promptFn) {
    console.log('\n\x1b[1mActivate / Deactivate Plugins (Enable / Disable)\x1b[0m');
    const plugins = getAvailablePlugins(REPO_ROOT);
    plugins.forEach((p, idx) => {
      const active = isPluginEnabled(p.id, HOME_DIR);
      const stateStr = active ? '\x1b[32mActive (Enabled)\x1b[0m' : '\x1b[33mInactive (Disabled)\x1b[0m';
      console.log(`${idx + 1}. ${p.displayName} (${p.id}) -> ${stateStr}`);
    });
    console.log(`${plugins.length + 1}. < Cancel`);

    const sel = (await promptFn(`\nSelect plugin to toggle state [1-${plugins.length + 1}]: `)).trim();
    const selIdx = parseInt(sel, 10);
    if (!isNaN(selIdx) && selIdx >= 1 && selIdx <= plugins.length) {
      const targetPlugin = plugins[selIdx - 1];
      const currentlyEnabled = isPluginEnabled(targetPlugin.id, HOME_DIR);
      const newState = !currentlyEnabled;
      setPluginEnabled(targetPlugin.id, newState, HOME_DIR);
      console.log(`\x1b[32m✔ ${targetPlugin.displayName} is now ${newState ? 'Active (Enabled)' : 'Inactive (Disabled)'}.\x1b[0m`);
    }
    await promptFn('Press Enter to continue...');
  }

  async function handleUninstallMenu(promptFn) {
    console.log('\n\x1b[1mUninstall Operations:\x1b[0m');
    console.log('1. Uninstall Plugin from Workspace (.agents/plugins/)');
    console.log('2. Uninstall Plugin from Global (~/.gemini/config/plugins/)');
    console.log('3. Remove Monorepo Source from Workspace (.agents/plugins.json)');
    console.log('4. Remove Monorepo Source from Global (~/.gemini/config/plugins.json)');
    console.log('5. < Cancel');

    const sel = (await promptFn('Select option [1-5]: ')).trim();
    if (sel === '1' || sel === '2') {
      const scope = sel === '1' ? 'workspace' : 'global';
      const plugins = getAvailablePlugins(REPO_ROOT);
      plugins.forEach((p, idx) => console.log(`${idx + 1}. ${p.displayName} (${p.id})`));
      const pSel = (await promptFn('Choose plugin to uninstall: ')).trim();
      const pIdx = parseInt(pSel, 10);
      if (!isNaN(pIdx) && pIdx >= 1 && pIdx <= plugins.length) {
        const targetId = plugins[pIdx - 1].id;
        const res = uninstallPlugin(targetId, scope, WORKSPACE_DIR, HOME_DIR);
        if (res.success) {
          console.log(`\x1b[32m✔ Successfully uninstalled ${targetId} from ${scope}.\x1b[0m`);
        } else {
          console.log(`\x1b[33mPlugin ${targetId} was not installed in ${scope}.\x1b[0m`);
        }
      }
    } else if (sel === '3' || sel === '4') {
      const scope = sel === '3' ? 'workspace' : 'global';
      const configPath = resolveSourceConfigPath(scope, WORKSPACE_DIR, HOME_DIR);
      const matchedEntry = findMarketplaceSourceEntry(getPluginsConfig(configPath), REPO_ROOT, HOME_DIR);
      const targetSourcePath = matchedEntry ? matchedEntry.path : resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
      const removed = removeSourceEntry(configPath, targetSourcePath);
      if (removed) {
        console.log(`\x1b[32m✔ Successfully removed source from ${configPath}.\x1b[0m`);
      } else {
        console.log(`\x1b[33mSource entry not found in ${configPath}.\x1b[0m`);
      }
    }

    await promptFn('Press Enter to continue...');
  }

  mainMenu();
}

// ==========================================
// CLI HEADLESS FLAG DISPATCHER
// ==========================================

function runCliDispatcher(args) {
  const getArg = (flag) => {
    const prefix = `${flag}=`;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === flag && i + 1 < args.length) return args[i + 1];
      if (args[i].startsWith(prefix)) return args[i].slice(prefix.length);
    }
    return null;
  };
  const hasFlag = (flag) => args.includes(flag) || args.some(a => a.startsWith(`${flag}=`));

  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
Usage: npx antigravity-plugins [options]

Options:
  --list                    Show inventory of available and installed plugins
  --check-updates           Audit installed plugins for available version updates
  --plugin <id|all>         Install specific plugin or all plugins
  --source                  Register repository in plugins.json
  --scope <workspace|global> Target scope (default: workspace)
  --enable <id>             Activate/enable a plugin in Antigravity configuration
  --disable <id>            Deactivate/disable a plugin in Antigravity configuration
  --update <id|all>         Upgrade specified plugin or all outdated plugins
  --update-source           Pull latest commits for monorepo source cache
  --uninstall <id>          Uninstall specific plugin
  --help, -h                Show this help screen
    `);
    process.exit(0);
  }

  if (hasFlag('--status-json') || hasFlag('--inventory-json')) {
    const state = getSystemInstallationState(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);
    const updateCheck = checkMarketplaceUpdates(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);
    console.log(JSON.stringify({ ...state, updateCheck }, null, 2));
    process.exit(0);
  }

  if (hasFlag('--list')) {
    printInventoryReport();
    process.exit(0);
  }

  if (hasFlag('--check-updates')) {
    printUpdateAudit();
    process.exit(0);
  }

  let scope = 'workspace';
  if (hasFlag('--scope')) {
    const rawScope = getArg('--scope');
    const scopeArg = (rawScope || '').toLowerCase();
    if (scopeArg === 'global' || scopeArg === 'g') {
      scope = 'global';
    } else if (scopeArg === 'workspace' || scopeArg === 'w') {
      scope = 'workspace';
    } else {
      console.error(`\x1b[31mError: Invalid --scope value '${rawScope || ''}'. Must be 'workspace' or 'global'.\x1b[0m`);
      process.exit(1);
    }
  }

  const validateToggleTarget = (flagName, rawVal) => {
    if (!rawVal || rawVal.startsWith('-') || !/^[a-zA-Z0-9_-]+$/.test(rawVal)) {
      console.error(`\x1b[31mError: Invalid or missing plugin ID for ${flagName}.\x1b[0m`);
      process.exit(1);
    }
    const available = getAvailablePlugins(REPO_ROOT);
    const matched = available.find(p => p.id.toLowerCase() === rawVal.toLowerCase());
    if (!matched) {
      const validIds = available.map(p => p.id).join(', ') || '(none)';
      console.error(`\x1b[31mError: Unknown plugin '${rawVal}'. Available plugins: ${validIds}\x1b[0m`);
      process.exit(1);
    }
    return matched.id;
  };

  if (hasFlag('--enable')) {
    const enableId = validateToggleTarget('--enable', getArg('--enable'));
    setPluginEnabled(enableId, true, HOME_DIR);
    console.log(`\x1b[32m✔ Enabled plugin '${enableId}' in Antigravity configuration.\x1b[0m`);
    process.exit(0);
  }

  if (hasFlag('--disable')) {
    const disableId = validateToggleTarget('--disable', getArg('--disable'));
    setPluginEnabled(disableId, false, HOME_DIR);
    console.log(`\x1b[32m✔ Disabled plugin '${disableId}' in Antigravity configuration.\x1b[0m`);
    process.exit(0);
  }

  if (hasFlag('--source')) {
    const configPath = resolveSourceConfigPath(scope, WORKSPACE_DIR, HOME_DIR);
    const targetSourcePath = resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
    if (isNpxExecution(REPO_ROOT)) {
      const cloned = ensurePermanentSourceClone(targetSourcePath);
      if (!cloned) {
        console.error('\x1b[31m✖ Failed to clone or update permanent marketplace source cache.\x1b[0m');
        process.exit(1);
      }
    }
    const added = addSourceEntry(configPath, targetSourcePath);
    const plugins = getAvailablePlugins(REPO_ROOT);
    for (const p of plugins) {
      setPluginEnabled(p.id, true, HOME_DIR);
    }
    if (added) {
      console.log(`\x1b[32m✔ Added source to ${configPath}\x1b[0m`);
      console.log(`\x1b[32m✔ Automatically activated catalog plugins (enabled: true)\x1b[0m`);
    } else {
      console.log(`\x1b[33mSource already registered in ${configPath}\x1b[0m`);
    }
    process.exit(0);
  }

  const pluginArg = getArg('--plugin');
  if (hasFlag('--plugin')) {
    if (!pluginArg || pluginArg.startsWith('-')) {
      console.error('\x1b[31mError: Missing plugin ID for --plugin. Usage: --plugin <id|all>\x1b[0m');
      process.exit(1);
    }
    const plugins = getAvailablePlugins(REPO_ROOT);
    const targets = pluginArg.toLowerCase() === 'all'
      ? plugins
      : plugins.filter(p => p.id.toLowerCase() === pluginArg.toLowerCase());

    if (targets.length === 0) {
      console.error(`\x1b[31mPlugin '${pluginArg}' not found in catalog.\x1b[0m`);
      process.exit(1);
    }

    for (const p of targets) {
      try {
        const res = installPlugin(p.id, REPO_ROOT, scope, WORKSPACE_DIR, HOME_DIR);
        console.log(`\x1b[32m✔ Installed ${p.name} (v${res.version}) to ${res.targetPath}\x1b[0m`);
        if (res.activated) {
          console.log(`\x1b[32m✔ Automatically activated in Antigravity config (enabled: true)\x1b[0m`);
        }
      } catch (err) {
        console.error(`\x1b[31m✖ Failed installing ${p.id}: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  if (hasFlag('--update-source')) {
    const targets = resolveUpdateSourceTargets(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);
    console.log(`\x1b[36mSynchronizing marketplace source repository...\x1b[0m`);
    const allSucceeded = targets.every(targetSourcePath => ensurePermanentSourceClone(targetSourcePath));
    if (allSucceeded) {
      console.log('\x1b[32m✔ Source repository successfully updated.\x1b[0m');
      process.exit(0);
    } else {
      console.error('\x1b[31m✖ Failed updating source repository.\x1b[0m');
      process.exit(1);
    }
  }

  const updateArg = getArg('--update');
  if (updateArg || hasFlag('--update')) {
    const target = (!updateArg || updateArg.startsWith('-') ? 'all' : updateArg).toLowerCase();
    const inventory = getPluginInventory(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);
    if (target !== 'all' && !inventory.items.some(p => p.id.toLowerCase() === target)) {
      const validIds = inventory.items.map(p => p.id).join(', ') || '(none)';
      console.error(`\x1b[31mError: Unknown plugin '${updateArg}'. Available plugins: ${validIds}\x1b[0m`);
      process.exit(1);
    }
    let count = 0;

    for (const p of inventory.items) {
      if (target === 'all' || target === p.id.toLowerCase()) {
        try {
          if (p.workspaceInstalled) {
            const res = updatePlugin(p.id, REPO_ROOT, 'workspace', WORKSPACE_DIR, HOME_DIR);
            if (res.updated) {
              console.log(`\x1b[32m✔ Updated ${p.name} (workspace) v${res.fromVersion} -> v${res.toVersion}\x1b[0m`);
              count++;
            }
          }
          if (p.globalInstalled) {
            const res = updatePlugin(p.id, REPO_ROOT, 'global', WORKSPACE_DIR, HOME_DIR);
            if (res.updated) {
              console.log(`\x1b[32m✔ Updated ${p.name} (global) v${res.fromVersion} -> v${res.toVersion}\x1b[0m`);
              count++;
            }
          }
        } catch (err) {
          console.error(`\x1b[31m✖ Failed updating ${p.id}: ${err.message}\x1b[0m`);
          process.exit(1);
        }
      }
    }
    console.log(`Completed updates (${count} updated).`);
    process.exit(0);
  }

  const uninstallArg = getArg('--uninstall');
  if (hasFlag('--uninstall')) {
    if (!uninstallArg || uninstallArg.startsWith('-')) {
      console.error('\x1b[31mError: Missing target for --uninstall. Usage: --uninstall <id|source>\x1b[0m');
      process.exit(1);
    }
    if (uninstallArg.toLowerCase() === 'source') {
      const configPath = resolveSourceConfigPath(scope, WORKSPACE_DIR, HOME_DIR);
      const matchedEntry = findMarketplaceSourceEntry(getPluginsConfig(configPath), REPO_ROOT, HOME_DIR);
      const targetSourcePath = matchedEntry ? matchedEntry.path : resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
      const removed = removeSourceEntry(configPath, targetSourcePath);
      if (removed) {
        console.log(`\x1b[32m✔ Successfully removed source from ${configPath}.\x1b[0m`);
      } else {
        console.log(`\x1b[33mSource entry not found in ${configPath}.\x1b[0m`);
      }
    } else {
      try {
        const matched = getAvailablePlugins(REPO_ROOT).find(p => p.id.toLowerCase() === uninstallArg.toLowerCase());
        const targetId = matched ? matched.id : uninstallArg;
        const res = uninstallPlugin(targetId, scope, WORKSPACE_DIR, HOME_DIR);
        if (res.success) {
          console.log(`\x1b[32m✔ Successfully uninstalled ${targetId} from ${scope}.\x1b[0m`);
        } else {
          console.log(`\x1b[33mPlugin ${targetId} was not found in ${scope}.\x1b[0m`);
        }
      } catch (err) {
        console.error(`\x1b[31m✖ Failed uninstalling ${uninstallArg}: ${err.message}\x1b[0m`);
        process.exit(1);
      }
    }
    process.exit(0);
  }

  console.error(`\x1b[31mError: Unrecognized or incomplete arguments: ${args.join(' ')}. Run --help for usage.\x1b[0m`);
  process.exit(1);
}

// ==========================================
// ENTRY POINT
// ==========================================

if (require.main === module) {
  const cliArgs = process.argv.slice(2);
  if (cliArgs.length > 0) {
    runCliDispatcher(cliArgs);
  } else {
    runInteractiveWizard();
  }
}

module.exports = {
  isNpxExecution,
  resolveSourceRegistrationPath,
  resolveUpdateSourceTargets
};
