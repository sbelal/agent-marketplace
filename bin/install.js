#!/usr/bin/env node

/**
 * install.js
 * 
 * Interactive TUI and headless CLI installer for Antigravity plugins.
 * Adheres strictly to Command-Query Separation (CQS) and Single Responsibility Principle (SRP).
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

const {
  normalizePath,
  resolveSourceConfigPath,
  getPluginsConfig,
  findSourceEntry,
  addSourceEntry,
  removeSourceEntry
} = require('./source-manager');

const {
  resolvePluginInstallPath,
  getAvailablePlugins,
  getInstalledPluginInfo,
  compareVersions,
  getPluginInventory,
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
const HOME_DIR = process.env.USERPROFILE || process.env.HOME || '';
const REMOTE_REPO_URL = 'https://github.com/sbelal/agent-marketplace.git';

/**
 * Checks whether this script is executing inside a temporary npx cache.
 * 
 * @param {string} rootDir 
 * @returns {boolean}
 */
function isNpxExecution(rootDir) {
  const norm = normalizePath(rootDir).toLowerCase();
  return norm.includes('_npx') || norm.includes('npm-cache') || norm.includes('temp') || norm.includes('tmp');
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
      execSync('git pull --ff-only', { cwd: cloneDir, stdio: 'inherit' });
      return true;
    } catch (err) {
      console.warn(`\x1b[33mWarning: git pull failed in ${cloneDir}: ${err.message}\x1b[0m`);
      return false;
    }
  }

  console.log(`\x1b[36mCloning permanent source repository to ${cloneDir}...\x1b[0m`);
  try {
    fs.mkdirSync(path.dirname(cloneDir), { recursive: true });
    execSync(`git clone --depth 1 ${REMOTE_REPO_URL} "${cloneDir}"`, { stdio: 'inherit' });
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
    console.log('1. 📦 Install Individual Plugin(s) (Copy Deployment)');
    console.log('2. 🔗 Add Monorepo as Plugin Source (plugins.json)');
    console.log('3. 🔄 Check for Updates & Upgrade Plugins');
    console.log('4. 📋 View Installed Plugins & Active Sources');
    console.log('5. ⚡ Activate / Deactivate Plugins (Enable / Disable)');
    console.log('6. 🗑️  Uninstall Plugin or Remove Source Entry');
    console.log('7. ❌ Exit\n');

    const choice = (await prompt('Select an option [1-7]: ')).trim();

    switch (choice) {
      case '1':
        await handleInstallPluginMenu(prompt);
        break;
      case '2':
        await handleAddSourceMenu(prompt);
        break;
      case '3':
        await handleUpdateMenu(prompt);
        break;
      case '4':
        printInventoryReport();
        await prompt('Press Enter to return to main menu...');
        break;
      case '5':
        await handleToggleActivationMenu(prompt);
        break;
      case '6':
        await handleUninstallMenu(prompt);
        break;
      case '7':
      case 'exit':
      case 'quit':
        console.log('Goodbye!');
        rl.close();
        return;
      default:
        console.log('\x1b[31mInvalid option. Please choose 1-7.\x1b[0m');
        break;
    }

    await mainMenu();
  }

  async function handleInstallPluginMenu(promptFn) {
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

    console.log('\n\x1b[1mSelect Installation Scope:\x1b[0m');
    console.log('1. Current Workspace (.agents/plugins/)');
    console.log('2. Global Machine (~/.gemini/config/plugins/)');
    console.log('3. < Cancel');

    const scopeSel = (await promptFn('Choose scope [1-3]: ')).trim();
    if (scopeSel !== '1' && scopeSel !== '2') return;

    const scope = scopeSel === '1' ? 'workspace' : 'global';
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

  async function handleAddSourceMenu(promptFn) {
    console.log('\n\x1b[1mAdd Monorepo as Plugin Source (plugins.json)\x1b[0m');
    console.log('This enables declarative loading for all current and future plugins.');
    console.log('Updates are applied via `git pull` without re-copying files.\n');

    console.log('1. Workspace Scope (.agents/plugins.json)');
    console.log('2. Global Scope (~/.gemini/config/plugins.json)');
    console.log('3. < Cancel');

    const scopeSel = (await promptFn('Choose scope [1-3]: ')).trim();
    if (scopeSel !== '1' && scopeSel !== '2') return;

    const scope = scopeSel === '1' ? 'workspace' : 'global';
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
      console.log(`\n\x1b[32m✔ Successfully added source entry in ${configPath}:\x1b[0m`);
      console.log(`  \x1b[36m${normalizePath(targetSourcePath)}\x1b[0m`);

      // Ensure catalog plugins are enabled in Antigravity configuration
      const plugins = getAvailablePlugins(REPO_ROOT);
      for (const p of plugins) {
        setPluginEnabled(p.id, true, HOME_DIR);
      }
      console.log(`\x1b[32m✔ Automatically activated all catalog plugins (enabled: true in config.json)\x1b[0m`);
      console.log('\n\x1b[36mRestart your Antigravity agent to mount the plugin source.\x1b[0m\n');
    } else {
      console.log(`\n\x1b[33mSource entry already exists in ${configPath}.\x1b[0m\n`);
    }

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
        if (p.workspaceNeedsUpdate) {
          console.log(`Upgrading ${p.name} (Workspace)...`);
          updatePlugin(p.id, REPO_ROOT, 'workspace', WORKSPACE_DIR, HOME_DIR);
          count++;
        }
        if (p.globalNeedsUpdate) {
          console.log(`Upgrading ${p.name} (Global)...`);
          updatePlugin(p.id, REPO_ROOT, 'global', WORKSPACE_DIR, HOME_DIR);
          count++;
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
      const targetSourcePath = resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
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
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : null;
  };
  const hasFlag = (flag) => args.includes(flag);

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

  if (hasFlag('--list')) {
    printInventoryReport();
    process.exit(0);
  }

  if (hasFlag('--check-updates')) {
    printUpdateAudit();
    process.exit(0);
  }

  const scopeArg = (getArg('--scope') || 'workspace').toLowerCase();
  const scope = (scopeArg === 'global' || scopeArg === 'g') ? 'global' : 'workspace';

  const enableArg = getArg('--enable');
  if (enableArg) {
    setPluginEnabled(enableArg, true, HOME_DIR);
    console.log(`\x1b[32m✔ Enabled plugin '${enableArg}' in Antigravity configuration.\x1b[0m`);
    process.exit(0);
  }

  const disableArg = getArg('--disable');
  if (disableArg) {
    setPluginEnabled(disableArg, false, HOME_DIR);
    console.log(`\x1b[32m✔ Disabled plugin '${disableArg}' in Antigravity configuration.\x1b[0m`);
    process.exit(0);
  }

  if (hasFlag('--source')) {
    const configPath = resolveSourceConfigPath(scope, WORKSPACE_DIR, HOME_DIR);
    const targetSourcePath = resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
    if (isNpxExecution(REPO_ROOT)) {
      ensurePermanentSourceClone(targetSourcePath);
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
  if (pluginArg) {
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

  const updateArg = getArg('--update');
  if (updateArg || hasFlag('--update')) {
    const target = (updateArg || 'all').toLowerCase();
    const inventory = getPluginInventory(REPO_ROOT, WORKSPACE_DIR, HOME_DIR);
    let count = 0;

    for (const p of inventory.items) {
      if (target === 'all' || target === p.id.toLowerCase()) {
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
      }
    }
    console.log(`Completed updates (${count} updated).`);
    process.exit(0);
  }

  const uninstallArg = getArg('--uninstall');
  if (uninstallArg) {
    if (uninstallArg.toLowerCase() === 'source') {
      const configPath = resolveSourceConfigPath(scope, WORKSPACE_DIR, HOME_DIR);
      const targetSourcePath = resolveSourceRegistrationPath(REPO_ROOT, HOME_DIR);
      const removed = removeSourceEntry(configPath, targetSourcePath);
      if (removed) {
        console.log(`\x1b[32m✔ Successfully removed source from ${configPath}.\x1b[0m`);
      } else {
        console.log(`\x1b[33mSource entry not found in ${configPath}.\x1b[0m`);
      }
    } else {
      const res = uninstallPlugin(uninstallArg, scope, WORKSPACE_DIR, HOME_DIR);
      if (res.success) {
        console.log(`\x1b[32m✔ Successfully uninstalled ${uninstallArg} from ${scope}.\x1b[0m`);
      } else {
        console.log(`\x1b[33mPlugin ${uninstallArg} was not found in ${scope}.\x1b[0m`);
      }
    }
    process.exit(0);
  }

  // Fallback to interactive wizard if no recognizable flag provided
  runInteractiveWizard();
}

// ==========================================
// ENTRY POINT
// ==========================================

const cliArgs = process.argv.slice(2);
if (cliArgs.length > 0) {
  runCliDispatcher(cliArgs);
} else {
  runInteractiveWizard();
}
