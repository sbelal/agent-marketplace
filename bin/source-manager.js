/**
 * source-manager.js
 * 
 * Manages Antigravity plugins.json declarative configuration.
 * Adheres strictly to Command-Query Separation (CQS) and Single Responsibility Principle (SRP).
 */

const fs = require('fs');
const path = require('path');

// ==========================================
// PURE QUERIES (Resolution & Calculation)
// ==========================================

/**
 * Normalizes filesystem path strings for cross-platform JSON storage.
 * Converts Windows backslashes to forward slashes.
 * 
 * @param {string} inputPath 
 * @returns {string} Normalized path
 */
function normalizePath(inputPath) {
  if (!inputPath) return '';
  return path.resolve(inputPath).replace(/\\/g, '/');
}

/**
 * Resolves the absolute path to plugins.json for a given scope.
 * 
 * @param {'workspace'|'global'} scope 
 * @param {string} workspaceDir 
 * @param {string} homeDir 
 * @returns {string} Absolute path to plugins.json
 */
function resolveSourceConfigPath(scope, workspaceDir = process.cwd(), homeDir = (process.env.USERPROFILE || process.env.HOME || '')) {
  if (scope === 'workspace') {
    return path.join(workspaceDir, '.agents', 'plugins.json');
  }
  if (!homeDir) {
    throw new Error('Could not resolve user home directory for global scope.');
  }
  return path.join(homeDir, '.gemini', 'config', 'plugins.json');
}

/**
 * Pure query: Reads and parses plugins.json from disk without side-effects.
 * 
 * @param {string} configPath 
 * @returns {{ entries: Array<{ path: string, include_only?: string[], exclude?: string[] }> }}
 */
function getPluginsConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return { entries: [] };
  }
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      entries: Array.isArray(parsed.entries) ? parsed.entries : []
    };
  } catch (err) {
    return { entries: [] };
  }
}

/**
 * Pure query: Checks whether targetPath is already registered in the given config.
 * 
 * @param {{ entries: Array<{ path: string }> }} config 
 * @param {string} targetPath 
 * @returns {boolean}
 */
function findSourceEntry(config, targetPath) {
  if (!config || !Array.isArray(config.entries)) return false;
  const targetNorm = normalizePath(targetPath).toLowerCase();
  return config.entries.some(entry => normalizePath(entry.path).toLowerCase() === targetNorm);
}

/**
 * Pure query: Checks whether an entry path corresponds to this agent marketplace repository.
 * Accounts for local clone paths, npx permanent cache clones, and relative/absolute variations.
 * 
 * @param {string} entryPath 
 * @param {string} repoRoot 
 * @param {string} homeDir 
 * @returns {boolean}
 */
function isMarketplaceSourceEntry(entryPath, repoRoot = '', homeDir = '') {
  if (!entryPath) return false;
  const normEntry = normalizePath(entryPath).toLowerCase();

  if (repoRoot) {
    const normRepoPlugins = normalizePath(path.join(repoRoot, 'plugins')).toLowerCase();
    if (normEntry === normRepoPlugins) return true;
  }

  if (homeDir) {
    const normCachePlugins = normalizePath(path.join(homeDir, '.gemini', 'sources', 'agent-marketplace', 'plugins')).toLowerCase();
    if (normEntry === normCachePlugins) return true;
  }

  if (normEntry.endsWith('/agent-marketplace/plugins') || normEntry.endsWith('\\agent-marketplace\\plugins')) {
    return true;
  }

  // Filesystem inspection if directory exists
  try {
    if (fs.existsSync(entryPath)) {
      if (fs.existsSync(path.join(entryPath, 'knowledge-capture', 'plugin.json')) ||
          fs.existsSync(path.join(entryPath, 'syran-persona', 'plugin.json'))) {
        return true;
      }
    }
  } catch {
    // Ignore fs errors
  }

  return false;
}

/**
 * Pure query: Finds the marketplace source entry in the given config if present.
 * 
 * @param {{ entries: Array<{ path: string }> }} config 
 * @param {string} repoRoot 
 * @param {string} homeDir 
 * @returns {{ path: string }|null}
 */
function findMarketplaceSourceEntry(config, repoRoot = '', homeDir = '') {
  if (!config || !Array.isArray(config.entries)) return null;
  return config.entries.find(entry => isMarketplaceSourceEntry(entry.path, repoRoot, homeDir)) || null;
}

/**
 * Pure query: Checks whether marketplace source is active in config.
 * 
 * @param {{ entries: Array<{ path: string }> }} config 
 * @param {string} repoRoot 
 * @param {string} homeDir 
 * @returns {boolean}
 */
function isMarketplaceSourceActive(config, repoRoot = '', homeDir = '') {
  return Boolean(findMarketplaceSourceEntry(config, repoRoot, homeDir));
}


/**
 * Pure calculation: Returns a new configuration object with targetPath added.
 * Does not mutate the input config object.
 * 
 * @param {{ entries: Array<{ path: string }> }} config 
 * @param {string} targetPath 
 * @param {Object} options Optional include_only / exclude patterns
 * @returns {{ entries: Array<{ path: string }> }}
 */
function calculateConfigWithAddedSource(config, targetPath, options = {}) {
  const currentEntries = (config && Array.isArray(config.entries)) ? [...config.entries] : [];
  const targetNorm = normalizePath(targetPath);

  const alreadyExists = currentEntries.some(e => normalizePath(e.path).toLowerCase() === targetNorm.toLowerCase());
  if (alreadyExists) {
    return { entries: currentEntries };
  }

  const newEntry = { path: targetNorm };
  if (options.include_only && options.include_only.length > 0) {
    newEntry.include_only = options.include_only;
  }
  if (options.exclude && options.exclude.length > 0) {
    newEntry.exclude = options.exclude;
  }

  return {
    entries: [...currentEntries, newEntry]
  };
}

/**
 * Pure calculation: Returns a new configuration object with targetPath removed.
 * Does not mutate the input config object.
 * 
 * @param {{ entries: Array<{ path: string }> }} config 
 * @param {string} targetPath 
 * @returns {{ entries: Array<{ path: string }> }}
 */
function calculateConfigWithRemovedSource(config, targetPath) {
  const currentEntries = (config && Array.isArray(config.entries)) ? config.entries : [];
  const targetNorm = normalizePath(targetPath).toLowerCase();

  const filtered = currentEntries.filter(e => normalizePath(e.path).toLowerCase() !== targetNorm);
  return { entries: filtered };
}

// ==========================================
// EXPLICIT COMMANDS (State Mutation & I/O)
// ==========================================

/**
 * Explicit command: Writes configuration object to disk formatted with 2 spaces.
 * 
 * @param {string} configPath 
 * @param {Object} config 
 */
function writePluginsConfig(configPath, config) {
  const parentDir = path.dirname(configPath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

/**
 * Explicit command: Adds targetPath to plugins.json idempotently.
 * 
 * @param {string} configPath 
 * @param {string} targetPath 
 * @param {Object} options 
 * @returns {boolean} True if added, false if already existed
 */
function addSourceEntry(configPath, targetPath, options = {}) {
  const current = getPluginsConfig(configPath);
  if (findSourceEntry(current, targetPath)) {
    return false; // Already registered
  }
  const updated = calculateConfigWithAddedSource(current, targetPath, options);
  writePluginsConfig(configPath, updated);
  return true;
}

/**
 * Explicit command: Removes targetPath from plugins.json idempotently.
 * Cleans up empty config file if no entries remain.
 * 
 * @param {string} configPath 
 * @param {string} targetPath 
 * @returns {boolean} True if removed, false if not found
 */
function removeSourceEntry(configPath, targetPath) {
  const current = getPluginsConfig(configPath);
  if (!findSourceEntry(current, targetPath)) {
    return false;
  }
  const updated = calculateConfigWithRemovedSource(current, targetPath);
  if (updated.entries.length === 0) {
    if (fs.existsSync(configPath)) {
      fs.unlinkSync(configPath);
    }
  } else {
    writePluginsConfig(configPath, updated);
  }
  return true;
}

module.exports = {
  // Pure Queries
  normalizePath,
  resolveSourceConfigPath,
  getPluginsConfig,
  findSourceEntry,
  isMarketplaceSourceEntry,
  findMarketplaceSourceEntry,
  isMarketplaceSourceActive,
  calculateConfigWithAddedSource,
  calculateConfigWithRemovedSource,

  // Commands
  writePluginsConfig,
  addSourceEntry,
  removeSourceEntry
};
