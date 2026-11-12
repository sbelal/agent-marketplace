/**
 * plugin-manager.js
 * 
 * Manages plugin discovery, cross-platform directory copying, installation,
 * uninstallation, and version comparison for Antigravity plugins.
 * Adheres strictly to Command-Query Separation (CQS) and Single Responsibility Principle (SRP).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const {
  getPluginsConfig,
  findSourceEntry,
  isMarketplaceSourceActive,
  findMarketplaceSourceEntry,
  normalizePath
} = require('./source-manager');

const DEFAULT_EXCLUDES = ['.git', 'node_modules', '.DS_Store', 'Thumbs.db'];
const VALID_PLUGIN_ID_RE = /^[a-zA-Z0-9_-]+$/;

function getDefaultHomeDir() {
  return process.env.USERPROFILE || process.env.HOME || os.homedir();
}

function assertValidPluginId(pluginId) {
  if (!pluginId || typeof pluginId !== 'string' || !VALID_PLUGIN_ID_RE.test(pluginId)) {
    throw new Error(`Invalid plugin ID '${pluginId}'. Must match ${VALID_PLUGIN_ID_RE}.`);
  }
}

// ==========================================
// PURE QUERIES (Resolution & Calculation)
// ==========================================

/**
 * Resolves the path to the user's Antigravity config.json.
 * 
 * @param {string} homeDir 
 * @returns {string} Path to ~/.gemini/config/config.json
 */
function resolveUserConfigPath(homeDir = getDefaultHomeDir()) {
  if (!homeDir) return '';
  return path.join(homeDir, '.gemini', 'config', 'config.json');
}

/**
 * Pure query: Reads the user's config.json without side-effects.
 * 
 * @param {string} configPath 
 * @returns {Object} Parsed configuration object
 */
function getUserConfig(configPath) {
  if (!configPath || !fs.existsSync(configPath)) {
    return { plugins: {} };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : { plugins: {} };
  } catch (err) {
    return { plugins: {} };
  }
}

/**
 * Pure query: Checks whether a plugin is explicitly enabled in config.json.
 * 
 * @param {string} pluginId 
 * @param {string} homeDir 
 * @returns {boolean}
 */
function isPluginEnabled(pluginId, homeDir = getDefaultHomeDir()) {
  const configPath = resolveUserConfigPath(homeDir);
  const cfg = getUserConfig(configPath);
  if (!cfg.plugins || !cfg.plugins[pluginId]) {
    return false;
  }
  return cfg.plugins[pluginId].enabled === true;
}

/**
 * Pure calculation: Returns updated configuration object with plugin enablement state.
 * Does not mutate the input config object.
 * 
 * @param {Object} currentConfig 
 * @param {string} pluginId 
 * @param {boolean} enabled 
 * @returns {Object}
 */
function calculateConfigWithPluginState(currentConfig, pluginId, enabled) {
  const updated = JSON.parse(JSON.stringify(currentConfig || {}));
  if (!updated.plugins) {
    updated.plugins = {};
  }
  updated.plugins[pluginId] = {
    ...(updated.plugins[pluginId] || {}),
    enabled: Boolean(enabled)
  };
  return updated;
}

/**
 * Pure calculation: Returns updated configuration object with plugin removed.
 * 
 * @param {Object} currentConfig 
 * @param {string} pluginId 
 * @returns {Object}
 */
function calculateConfigWithRemovedPlugin(currentConfig, pluginId) {
  const updated = JSON.parse(JSON.stringify(currentConfig || {}));
  if (updated.plugins && updated.plugins[pluginId]) {
    delete updated.plugins[pluginId];
  }
  return updated;
}

/**
 * Resolves the destination directory for an installed plugin.
 * 
 * @param {string} pluginId 
 * @param {'workspace'|'global'} scope 
 * @param {string} workspaceDir 
 * @param {string} homeDir 
 * @returns {string} Absolute install destination path
 */
function resolvePluginInstallPath(pluginId, scope, workspaceDir = process.cwd(), homeDir = getDefaultHomeDir()) {
  assertValidPluginId(pluginId);
  if (scope === 'workspace') {
    return path.join(workspaceDir, '.agents', 'plugins', pluginId);
  }
  if (!homeDir) {
    throw new Error('Could not resolve user home directory for global scope.');
  }
  return path.join(homeDir, '.gemini', 'config', 'plugins', pluginId);
}

/**
 * Pure query: Scans plugins directory to find all deployable plugins.
 * 
 * @param {string} repoRoot 
 * @returns {Array<{ id: string, name: string, displayName: string, version: string, description: string, srcPath: string }>}
 */
function getAvailablePlugins(repoRoot) {
  const pluginsDir = path.join(repoRoot, 'plugins');
  if (!fs.existsSync(pluginsDir)) {
    return [];
  }

  const entries = fs.readdirSync(pluginsDir, { withFileTypes: true });
  const plugins = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pluginId = entry.name;
    const pluginDirPath = path.join(pluginsDir, pluginId);
    const manifestPath = path.join(pluginDirPath, 'plugin.json');

    let manifest = {};
    if (fs.existsSync(manifestPath)) {
      try {
        const raw = fs.readFileSync(manifestPath, 'utf8');
        manifest = JSON.parse(raw);
      } catch (err) {
        // Fallback to defaults if json parse fails
      }
    }

    plugins.push({
      id: pluginId,
      name: manifest.name || pluginId,
      displayName: manifest.displayName || manifest.name || pluginId,
      version: manifest.version || '1.0.0',
      description: manifest.description || '',
      srcPath: pluginDirPath
    });
  }

  return plugins;
}

/**
 * Pure query: Inspects a target directory for an installed plugin's metadata.
 * 
 * @param {string} installPath 
 * @returns {{ installed: boolean, version: string|null, path: string }}
 */
function getInstalledPluginInfo(installPath) {
  if (!fs.existsSync(installPath)) {
    return { installed: false, version: null, path: installPath };
  }

  const manifestPath = path.join(installPath, 'plugin.json');
  let version = 'unknown';

  if (fs.existsSync(manifestPath)) {
    try {
      const raw = fs.readFileSync(manifestPath, 'utf8');
      const manifest = JSON.parse(raw);
      version = manifest.version || '1.0.0';
    } catch (err) {
      version = '1.0.0';
    }
  }

  return {
    installed: true,
    version,
    path: installPath
  };
}

/**
 * Pure calculation: Compares two semantic version strings.
 * 
 * @param {string} v1 Installed version
 * @param {string} v2 Available/Latest version
 * @returns {number} 1 if v2 > v1 (upgrade available), 0 if identical, -1 if v2 < v1
 */
function compareVersions(v1, v2) {
  if (!v1 || v1 === 'unknown') return 1;
  if (!v2 || v2 === 'unknown') return 0;

  const parts1 = v1.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const parts2 = v2.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);

  const maxLen = Math.max(parts1.length, parts2.length);
  for (let i = 0; i < maxLen; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;
    if (num2 > num1) return 1;
    if (num2 < num1) return -1;
  }
  return 0;
}

/**
 * Pure query: Retrieves complete inventory of available plugins, installed states,
 * and active plugins.json source entries.
 * 
 * @param {string} repoRoot 
 * @param {string} workspaceDir 
 * @param {string} homeDir 
 * @returns {Object} Full inventory report
 */
/**
 * Pure query: Retrieves complete inventory of available plugins, installed states,
 * and active plugins.json source entries.
 * 
 * @param {string} repoRoot 
 * @param {string} workspaceDir 
 * @param {string} homeDir 
 * @returns {Object} Full inventory report
 */
function getPluginInventory(repoRoot, workspaceDir = process.cwd(), homeDir = getDefaultHomeDir()) {
  const available = getAvailablePlugins(repoRoot);
  const pluginsSrcDir = path.join(repoRoot, 'plugins');

  // Check Workspace Scope
  const wsConfigPath = path.join(workspaceDir, '.agents', 'plugins.json');
  const wsConfig = getPluginsConfig(wsConfigPath);
  const wsSourceActive = isMarketplaceSourceActive(wsConfig, repoRoot, homeDir);

  // Check Global Scope
  const globalConfigPath = homeDir ? path.join(homeDir, '.gemini', 'config', 'plugins.json') : '';
  const globalConfig = globalConfigPath ? getPluginsConfig(globalConfigPath) : { entries: [] };
  const globalSourceActive = isMarketplaceSourceActive(globalConfig, repoRoot, homeDir);

  const items = available.map(plugin => {
    const wsPath = resolvePluginInstallPath(plugin.id, 'workspace', workspaceDir, homeDir);
    const glPath = homeDir ? resolvePluginInstallPath(plugin.id, 'global', workspaceDir, homeDir) : null;

    const wsInfo = getInstalledPluginInfo(wsPath);
    const glInfo = glPath ? getInstalledPluginInfo(glPath) : { installed: false, version: null };
    const enabled = isPluginEnabled(plugin.id, homeDir);

    return {
      ...plugin,
      enabled,
      workspaceInstalled: wsInfo.installed,
      workspaceVersion: wsInfo.version,
      workspacePath: wsPath,
      workspaceNeedsUpdate: wsInfo.installed && compareVersions(wsInfo.version, plugin.version) > 0,

      globalInstalled: glInfo.installed,
      globalVersion: glInfo.version,
      globalPath: glPath,
      globalNeedsUpdate: glInfo.installed && compareVersions(glInfo.version, plugin.version) > 0,

      sourceActive: wsSourceActive || globalSourceActive
    };
  });

  return {
    items,
    sources: {
      workspace: {
        path: wsConfigPath,
        active: wsSourceActive,
        entries: wsConfig.entries
      },
      global: {
        path: globalConfigPath,
        active: globalSourceActive,
        entries: globalConfig.entries
      }
    }
  };
}

/**
 * Pure query: Inspects the environment to calculate the current installation state
 * and derives strictly relevant, contextual actions (filtering out redundant options
 * such as offering source-based global install when it is already active).
 * 
 * @param {string} repoRoot 
 * @param {string} workspaceDir 
 * @param {string} homeDir 
 * @returns {Object} State and filtered relevant actions
 */
function getSystemInstallationState(repoRoot, workspaceDir = process.cwd(), homeDir = getDefaultHomeDir()) {
  const inventory = getPluginInventory(repoRoot, workspaceDir, homeDir);
  const isGlobalSource = inventory.sources.global.active;
  const isWorkspaceSource = inventory.sources.workspace.active;
  const anySourceActive = isGlobalSource || isWorkspaceSource;

  const installedWorkspace = inventory.items.filter(p => p.workspaceInstalled);
  const installedGlobal = inventory.items.filter(p => p.globalInstalled);

  const updatesAvailable = inventory.items.some(p => p.workspaceNeedsUpdate || p.globalNeedsUpdate);

  // Compute primary installation mode
  let primaryMode = 'none';
  if (isGlobalSource && isWorkspaceSource) primaryMode = 'dual-source';
  else if (isGlobalSource) primaryMode = 'global-source';
  else if (isWorkspaceSource) primaryMode = 'workspace-source';
  else if (installedWorkspace.length > 0 || installedGlobal.length > 0) primaryMode = 'copy-deployment';

  // Compute contextual, filtered options based strictly on state
  const relevantActions = [];

  if (isGlobalSource) {
    // Current state is Global Source mode.
    // FILTER OUT: "Install source-based global install (repo clone)" because that is what is currently active!
    // FILTER OUT: "Install individual plugins globally" because all plugins are mounted globally!
    relevantActions.push({
      id: 'check-updates',
      title: 'Check for Updates & Sync Plugins',
      description: 'Audit and pull latest plugin updates from git repository',
      recommended: updatesAvailable
    });
    relevantActions.push({
      id: 'toggle-activation',
      title: 'Enable / Disable Plugins',
      description: 'Activate or deactivate individual plugins in Antigravity config',
      recommended: false
    });
    relevantActions.push({
      id: 'configure-settings',
      title: 'Configure Plugin Settings',
      description: 'Configure Knowledge Capture Git remotes or plugin parameters',
      recommended: false
    });
    if (!isWorkspaceSource) {
      relevantActions.push({
        id: 'copy-to-workspace',
        title: 'Pin / Copy Plugin to Workspace',
        description: 'Bundle specific plugin in .agents/plugins/ for project-level isolation or team commits',
        recommended: false
      });
    }
    relevantActions.push({
      id: 'view-inventory',
      title: 'View Active Plugins & Inventory',
      description: 'List installed plugins, active sources, and versions',
      recommended: false
    });
    relevantActions.push({
      id: 'remove-source',
      title: 'Remove Global Source Mode',
      description: 'Unlink marketplace source from ~/.gemini/config/plugins.json',
      recommended: false
    });
  } else if (isWorkspaceSource) {
    // Current state is Workspace Source mode.
    relevantActions.push({
      id: 'check-updates',
      title: 'Check for Updates & Sync Workspace',
      description: 'Pull latest plugin updates for this repository',
      recommended: updatesAvailable
    });
    relevantActions.push({
      id: 'toggle-activation',
      title: 'Enable / Disable Plugins',
      description: 'Activate or deactivate plugins in Antigravity configuration',
      recommended: false
    });
    relevantActions.push({
      id: 'configure-settings',
      title: 'Configure Plugin Settings',
      description: 'Configure Knowledge Capture storage or persona settings',
      recommended: false
    });
    relevantActions.push({
      id: 'add-global-source',
      title: 'Promote Marketplace to Global Scope',
      description: 'Link repository globally in ~/.gemini/config/plugins.json to use across all workspaces',
      recommended: false
    });
    relevantActions.push({
      id: 'remove-source',
      title: 'Remove Workspace Source Mode',
      description: 'Unlink marketplace source from .agents/plugins.json',
      recommended: false
    });
  } else if (installedWorkspace.length > 0 || installedGlobal.length > 0) {
    // Current state is Copy Deployment mode.
    relevantActions.push({
      id: 'check-updates',
      title: 'Upgrade Outdated Plugins',
      description: 'Update copied plugins to latest version',
      recommended: updatesAvailable
    });
    relevantActions.push({
      id: 'switch-to-source',
      title: 'Switch to Source-Mode (Recommended)',
      description: 'Replace copied folders with live plugins.json link for zero-copy git updates',
      recommended: true
    });
    relevantActions.push({
      id: 'install-plugin',
      title: 'Install Additional Plugins',
      description: 'Copy additional plugins from catalog',
      recommended: false
    });
    relevantActions.push({
      id: 'toggle-activation',
      title: 'Enable / Disable Plugins',
      description: 'Activate or deactivate installed plugins',
      recommended: false
    });
    relevantActions.push({
      id: 'uninstall-plugin',
      title: 'Uninstall Plugins',
      description: 'Remove copied plugin directories',
      recommended: false
    });
  } else {
    // Clean installation (nothing installed yet)
    relevantActions.push({
      id: 'add-global-source',
      title: 'Global Source Mode (Recommended)',
      description: 'Links monorepo in ~/.gemini/config/plugins.json. Auto-mounts all plugins and auto-updates via git',
      recommended: true
    });
    relevantActions.push({
      id: 'add-workspace-source',
      title: 'Workspace Source Mode',
      description: 'Links monorepo in .agents/plugins.json for current project only',
      recommended: false
    });
    relevantActions.push({
      id: 'install-copy',
      title: 'Individual Plugin Copy',
      description: 'Copies specific plugins directly into workspace or global directory without linking monorepo',
      recommended: false
    });
  }

  return {
    primaryMode,
    isGlobalSource,
    isWorkspaceSource,
    anySourceActive,
    installedWorkspaceCount: installedWorkspace.length,
    installedGlobalCount: installedGlobal.length,
    updatesAvailable,
    inventory,
    relevantActions
  };
}

/**
 * Checks for available updates across installed plugins and upstream repository.
 * Safe, non-blocking check with timeout.
 * 
 * @param {string} repoRoot 
 * @param {string} homeDir 
 * @returns {{ hasUpdate: boolean, details: Array<{ id: string, name: string, currentVersion: string, availableVersion: string, scope: string }> }}
 */
function checkMarketplaceUpdates(repoRoot, workspaceDir = process.cwd(), homeDir = getDefaultHomeDir()) {
  const inventory = getPluginInventory(repoRoot, workspaceDir, homeDir);
  const details = [];

  // Check individual copied plugins
  for (const item of inventory.items) {
    if (item.workspaceNeedsUpdate) {
      details.push({
        id: item.id,
        name: item.displayName || item.name,
        currentVersion: item.workspaceVersion,
        availableVersion: item.version,
        scope: 'workspace'
      });
    }
    if (item.globalNeedsUpdate) {
      details.push({
        id: item.id,
        name: item.displayName || item.name,
        currentVersion: item.globalVersion,
        availableVersion: item.version,
        scope: 'global'
      });
    }
  }

  // Check if source repo clone has upstream commits
  let sourceHasUpdate = false;
  let sourceCommitsBehind = 0;

  const checkGitDir = (dir) => {
    if (!fs.existsSync(path.join(dir, '.git'))) return 0;
    const gitEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=3' };
    try {
      execFileSync('git', ['fetch', '--dry-run', 'origin'], {
        cwd: dir,
        timeout: 2500,
        env: gitEnv,
        stdio: ['ignore', 'pipe', 'ignore']
      });
      let upstreamRef = null;
      try {
        const symRef = execFileSync('git', ['symbolic-ref', 'refs/remotes/origin/HEAD'], {
          cwd: dir,
          timeout: 1500,
          encoding: 'utf8',
          env: gitEnv,
          stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (symRef.startsWith('refs/remotes/')) {
          upstreamRef = symRef.slice('refs/remotes/'.length);
        }
      } catch {}
      if (!upstreamRef) {
        for (const candidate of ['origin/main', 'origin/master']) {
          try {
            execFileSync('git', ['rev-parse', '--verify', '--quiet', candidate], {
              cwd: dir,
              timeout: 1500,
              env: gitEnv,
              stdio: 'ignore'
            });
            upstreamRef = candidate;
            break;
          } catch {}
        }
      }
      if (!upstreamRef) return 0;
      const behind = execFileSync('git', ['rev-list', `HEAD..${upstreamRef}`, '--count'], {
        cwd: dir,
        timeout: 1500,
        encoding: 'utf8',
        env: gitEnv,
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim();
      return parseInt(behind, 10) || 0;
    } catch {
      return 0;
    }
  };

  if (inventory.sources.global.active || inventory.sources.workspace.active) {
    const permanentClone = homeDir ? path.join(homeDir, '.gemini', 'sources', 'agent-marketplace') : '';
    if (permanentClone && fs.existsSync(permanentClone)) {
      sourceCommitsBehind = checkGitDir(permanentClone);
    } else if (fs.existsSync(path.join(repoRoot, '.git'))) {
      sourceCommitsBehind = checkGitDir(repoRoot);
    }
    if (sourceCommitsBehind > 0) {
      sourceHasUpdate = true;
    }
  }

  return {
    hasUpdate: details.length > 0 || sourceHasUpdate,
    sourceHasUpdate,
    sourceCommitsBehind,
    details
  };
}


// ==========================================
// EXPLICIT COMMANDS (State Mutation & I/O)
// ==========================================

/**
 * Cross-platform directory copier that safely ignores excluded items.
 * 
 * @param {string} src 
 * @param {string} dest 
 * @param {string[]} excludes 
 */
function copyDirectory(src, dest, excludes = DEFAULT_EXCLUDES) {
  if (!fs.existsSync(src)) {
    throw new Error(`Source path not found: ${src}`);
  }

  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    if (excludes.includes(entry.name)) {
      continue;
    }

    const srcEntryPath = path.join(src, entry.name);
    const destEntryPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirectory(srcEntryPath, destEntryPath, excludes);
    } else {
      fs.copyFileSync(srcEntryPath, destEntryPath);
    }
  }
}

/**
 * Explicit command: Removes an empty directory if no items exist inside it.
 * 
 * @param {string} dirPath 
 * @returns {boolean}
 */
function removeEmptyDirectory(dirPath) {
  try {
    if (fs.existsSync(dirPath)) {
      const files = fs.readdirSync(dirPath);
      if (files.length === 0) {
        fs.rmdirSync(dirPath);
        return true;
      }
    }
  } catch (err) {
    // Suppress cleanup failure
  }
  return false;
}

/**
 * Explicit command: Writes user config.json atomically formatted with 2 spaces.
 * 
 * @param {string} configPath 
 * @param {Object} config 
 */
function writeUserConfig(configPath, config) {
  if (!configPath) return;
  const parent = path.dirname(configPath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Explicit command: Activates or deactivates a plugin in config.json and native CLI.
 * 
 * @param {string} pluginId 
 * @param {boolean} enabled 
 * @param {string} homeDir 
 * @returns {boolean}
 */
function setPluginEnabled(pluginId, enabled = true, homeDir = getDefaultHomeDir()) {
  assertValidPluginId(pluginId);
  const configPath = resolveUserConfigPath(homeDir);
  if (!configPath) return false;

  const current = getUserConfig(configPath);
  const updated = calculateConfigWithPluginState(current, pluginId, enabled);
  writeUserConfig(configPath, updated);

  try {
    const subcmd = enabled ? 'enable' : 'disable';
    execFileSync('agy', ['plugin', subcmd, pluginId], { stdio: 'ignore' });
  } catch (err) {
    // Suppress CLI failure, config.json is already updated
  }

  return true;
}

/**
 * Explicit command: Removes plugin entry from config.json.
 * 
 * @param {string} pluginId 
 * @param {string} homeDir 
 * @returns {boolean}
 */
function removePluginFromConfig(pluginId, homeDir = getDefaultHomeDir()) {
  assertValidPluginId(pluginId);
  const configPath = resolveUserConfigPath(homeDir);
  if (!configPath) return false;

  const current = getUserConfig(configPath);
  const updated = calculateConfigWithRemovedPlugin(current, pluginId);
  writeUserConfig(configPath, updated);

  try {
    execFileSync('agy', ['plugin', 'disable', pluginId], { stdio: 'ignore' });
  } catch (err) {
    // Suppress CLI failure
  }

  return true;
}

/**
 * Explicit command: Installs a specific plugin to the specified scope and activates it.
 * 
 * @param {string} pluginId 
 * @param {string} repoRoot 
 * @param {'workspace'|'global'} scope 
 * @param {string} workspaceDir 
 * @param {string} homeDir 
 * @returns {{ success: boolean, targetPath: string, version: string, activated: boolean }}
 */
function installPlugin(pluginId, repoRoot, scope, workspaceDir = process.cwd(), homeDir = getDefaultHomeDir()) {
  const available = getAvailablePlugins(repoRoot);
  const plugin = available.find(p => p.id.toLowerCase() === pluginId.toLowerCase());

  if (!plugin) {
    throw new Error(`Plugin '${pluginId}' not found in repository at ${path.join(repoRoot, 'plugins')}`);
  }

  const targetPath = resolvePluginInstallPath(plugin.id, scope, workspaceDir, homeDir);

  // If previous installation exists, clean it out first
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  copyDirectory(plugin.srcPath, targetPath);

  // Automatically activate the plugin in Antigravity config
  const activated = setPluginEnabled(plugin.id, true, homeDir);

  return {
    success: true,
    targetPath,
    version: plugin.version,
    activated
  };
}

/**
 * Explicit command: Uninstalls a specific plugin from the specified scope.
 * 
 * @param {string} pluginId 
 * @param {'workspace'|'global'} scope 
 * @param {string} workspaceDir 
 * @param {string} homeDir 
 * @returns {{ success: boolean, targetPath: string }}
 */
function uninstallPlugin(pluginId, scope, workspaceDir = process.cwd(), homeDir = getDefaultHomeDir()) {
  const targetPath = resolvePluginInstallPath(pluginId, scope, workspaceDir, homeDir);

  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });

    // Clean up empty parent directories
    const pluginsParent = path.dirname(targetPath);
    removeEmptyDirectory(pluginsParent);
    const rootParent = path.dirname(pluginsParent);
    removeEmptyDirectory(rootParent);

    // Remove activation entry from config.json
    removePluginFromConfig(pluginId, homeDir);

    return { success: true, targetPath };
  }

  return { success: false, targetPath };
}

/**
 * Explicit command: Upgrades an installed plugin to match the latest repo version.
 * 
 * @param {string} pluginId 
 * @param {string} repoRoot 
 * @param {'workspace'|'global'} scope 
 * @param {string} workspaceDir 
 * @param {string} homeDir 
 * @returns {{ success: boolean, updated: boolean, fromVersion: string, toVersion: string, targetPath: string }}
 */
function updatePlugin(pluginId, repoRoot, scope, workspaceDir = process.cwd(), homeDir = getDefaultHomeDir()) {
  const targetPath = resolvePluginInstallPath(pluginId, scope, workspaceDir, homeDir);
  const info = getInstalledPluginInfo(targetPath);

  if (!info.installed) {
    throw new Error(`Plugin '${pluginId}' is not installed in ${scope} scope.`);
  }

  const available = getAvailablePlugins(repoRoot);
  const plugin = available.find(p => p.id.toLowerCase() === pluginId.toLowerCase());

  if (!plugin) {
    throw new Error(`Plugin '${pluginId}' not found in source repository.`);
  }

  const comp = compareVersions(info.version, plugin.version);
  if (comp <= 0) {
    return {
      success: true,
      updated: false,
      fromVersion: info.version,
      toVersion: plugin.version,
      targetPath
    };
  }

  // Execute update copy
  installPlugin(pluginId, repoRoot, scope, workspaceDir, homeDir);

  return {
    success: true,
    updated: true,
    fromVersion: info.version,
    toVersion: plugin.version,
    targetPath
  };
}

module.exports = {
  // Pure Queries
  resolvePluginInstallPath,
  resolveUserConfigPath,
  getUserConfig,
  isPluginEnabled,
  calculateConfigWithPluginState,
  calculateConfigWithRemovedPlugin,
  getAvailablePlugins,
  getInstalledPluginInfo,
  compareVersions,
  getPluginInventory,
  getSystemInstallationState,
  checkMarketplaceUpdates,

  // Commands
  copyDirectory,
  removeEmptyDirectory,
  writeUserConfig,
  setPluginEnabled,
  removePluginFromConfig,
  installPlugin,
  uninstallPlugin,
  updatePlugin
};

