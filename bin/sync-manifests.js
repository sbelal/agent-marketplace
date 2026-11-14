#!/usr/bin/env node

/**
 * bin/sync-manifests.js
 *
 * Single Canonical Hook & Plugin Config Sync Engine (DRY Cross-Platform Config).
 * Reads canonical plugin.manifest.json files from each plugin directory, validates
 * schemas & entrypoint paths, and generates/synchronizes:
 * 1. plugin.json (Antigravity plugin manifest)
 * 2. .claude-plugin/plugin.json (Claude Code manifest)
 * 3. mcp_config.json (Antigravity MCP server configuration)
 * 4. .mcp.json (Claude Code MCP server configuration)
 * 5. hooks.json (Antigravity lifecycle hooks configuration)
 * 6. hooks/hooks.json (Claude Code lifecycle hooks configuration)
 * 7. package.json & mcp-server/package.json (canonical version sync)
 * 8. .claude-plugin/marketplace.json (Root marketplace catalog)
 *
 * Supports --check flag for CI validation.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VALID_PLATFORMS = new Set(['antigravity', 'claude-code']);

function extractPluginRootRefs(str) {
  if (typeof str !== 'string') return [];
  const refs = [];
  const re = /\$\{CLAUDE_PLUGIN_ROOT\}\/([^\s"']+)/g;
  let m;
  while ((m = re.exec(str)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

function validateCanonicalManifest(pluginId, pluginDir, manifest, options = {}) {
  const errors = [];
  if (!manifest || typeof manifest !== 'object') {
    return [`[${pluginId}] plugin.manifest.json must be a JSON object`];
  }
  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push(`[${pluginId}] Missing required string field "name"`);
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push(`[${pluginId}] Missing required string field "version"`);
  }

  const referencedPaths = new Set();
  if (manifest.mcpServers && typeof manifest.mcpServers === 'object') {
    for (const [serverName, cfg] of Object.entries(manifest.mcpServers)) {
      if (!cfg || !cfg.command) {
        errors.push(`[${pluginId}] mcpServers.${serverName} must specify a "command"`);
      }
      if (Array.isArray(cfg?.args)) {
        for (const arg of cfg.args) {
          for (const rel of extractPluginRootRefs(arg)) {
            referencedPaths.add(rel);
          }
        }
      }
    }
  }

  if (manifest.hooks && typeof manifest.hooks === 'object') {
    for (const [event, hookList] of Object.entries(manifest.hooks)) {
      if (!Array.isArray(hookList)) {
        errors.push(`[${pluginId}] hooks.${event} must be an array`);
        continue;
      }
      for (const h of hookList) {
        if (!h || !h.command) {
          errors.push(`[${pluginId}] hooks.${event} entry missing "command"`);
          continue;
        }
        if (h.platforms !== undefined) {
          if (!Array.isArray(h.platforms) || h.platforms.some(p => !VALID_PLATFORMS.has(p))) {
            errors.push(`[${pluginId}] hooks.${event} has invalid platforms: ${JSON.stringify(h.platforms)}`);
          }
        }
        for (const rel of extractPluginRootRefs(h.command)) {
          referencedPaths.add(rel);
        }
      }
    }
  }

  if (!options.skipPathCheck) {
    for (const rel of referencedPaths) {
      const resolved = path.resolve(pluginDir, rel);
      const relCheck = path.relative(pluginDir, resolved);
      if (relCheck.startsWith('..') || path.isAbsolute(relCheck) || !fs.existsSync(resolved)) {
        errors.push(`[${pluginId}] Referenced entrypoint does not exist inside plugin directory: ${rel}`);
      }
    }
  }

  return errors;
}

function buildDerivedConfigs(pluginId, manifest) {
  const name = manifest.name || pluginId;
  const version = manifest.version || '1.0.0';
  const description = manifest.description || '';
  const repository = manifest.repository || 'https://github.com/sbelal/agent-marketplace';

  const isAuthorObj = manifest.author !== null && typeof manifest.author === 'object' && !Array.isArray(manifest.author);

  const agPlugin = {
    name,
    displayName: manifest.displayName || name,
    description,
    version,
    author: isAuthorObj ? (manifest.author.name || 'Author') : (manifest.author || 'Author'),
    repository
  };

  const ccPlugin = {
    name,
    version,
    description,
    author: isAuthorObj ? manifest.author : { name: manifest.author || 'Author' },
    repository
  };

  const mcpContent = manifest.mcpServers
    ? JSON.stringify({ mcpServers: manifest.mcpServers }, null, 2) + '\n'
    : null;

  let agHooks = null;
  let ccHooks = null;
  if (manifest.hooks && typeof manifest.hooks === 'object') {
    agHooks = { [`${name}-session`]: {} };
    ccHooks = { hooks: {} };

    for (const [event, hookList] of Object.entries(manifest.hooks)) {
      if (!Array.isArray(hookList)) continue;
      const agFiltered = hookList.filter(h => h && (!h.platforms || (Array.isArray(h.platforms) && h.platforms.includes('antigravity'))));
      if (agFiltered.length > 0) {
        agHooks[`${name}-session`][event] = agFiltered.map(h => ({
          type: h.type || 'command',
          command: h.command,
          ...(h.matcher !== undefined && h.matcher !== '' ? { matcher: h.matcher } : {}),
          ...(h.timeout !== undefined ? { timeout: h.timeout } : {})
        }));
      }

      const ccFiltered = hookList.filter(h => h && (!h.platforms || (Array.isArray(h.platforms) && h.platforms.includes('claude-code'))));
      if (ccFiltered.length > 0) {
        const matcherGroups = new Map();
        for (const h of ccFiltered) {
          const matcherKey = h.matcher !== undefined ? String(h.matcher) : '';
          if (!matcherGroups.has(matcherKey)) {
            matcherGroups.set(matcherKey, []);
          }
          matcherGroups.get(matcherKey).push({
            type: h.type || 'command',
            command: h.command,
            ...(h.timeout !== undefined ? { timeout: h.timeout } : {})
          });
        }
        ccHooks.hooks[event] = Array.from(matcherGroups.entries()).map(([matcher, hooks]) => ({
          matcher,
          hooks
        }));
      }
    }
  }

  return { agPlugin, ccPlugin, mcpContent, agHooks, ccHooks };
}

function syncFile(targetPath, expectedContent, { checkMode = false, repoRoot = REPO_ROOT } = {}) {
  const parent = path.dirname(targetPath);
  if (!checkMode && !fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  let currentContent = '';
  if (fs.existsSync(targetPath)) {
    currentContent = fs.readFileSync(targetPath, 'utf8');
  }

  if (currentContent !== expectedContent) {
    if (checkMode) {
      console.warn(`[DRIFT] ${path.relative(repoRoot, targetPath)} is out of sync.`);
      return 1;
    }
    fs.writeFileSync(targetPath, expectedContent, 'utf8');
  }
  return 0;
}

function syncPackageVersion(pkgPath, version, options) {
  if (!fs.existsSync(pkgPath) || !version) return 0;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    if (pkg.version === version) return 0;
    const updated = { ...pkg, version };
    return syncFile(pkgPath, JSON.stringify(updated, null, 2) + '\n', options);
  } catch {
    return 0;
  }
}

function syncManifests(options = {}) {
  const repoRoot = options.repoRoot || REPO_ROOT;
  const pluginsDir = path.join(repoRoot, 'plugins');
  const checkMode = options.checkMode !== undefined ? options.checkMode : process.argv.includes('--check');

  if (!fs.existsSync(pluginsDir)) {
    throw new Error(`Plugins directory not found: ${pluginsDir}`);
  }

  const pluginEntries = fs
    .readdirSync(pluginsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  const plugins = [];
  const validationErrors = [];
  let driftCount = 0;

  for (const entry of pluginEntries) {
    const pluginId = entry.name;
    const pluginDir = path.join(pluginsDir, pluginId);
    const manifestPath = path.join(pluginDir, 'plugin.manifest.json');

    if (!fs.existsSync(manifestPath)) continue;

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (err) {
      validationErrors.push(`[${pluginId}] Invalid JSON in plugin.manifest.json: ${err.message}`);
      continue;
    }
    const pluginErrors = validateCanonicalManifest(pluginId, pluginDir, manifest, options);
    if (pluginErrors.length > 0) {
      validationErrors.push(...pluginErrors);
      continue;
    }
    plugins.push({ pluginId, pluginDir, manifest });

    const { agPlugin, ccPlugin, mcpContent, agHooks, ccHooks } = buildDerivedConfigs(pluginId, manifest);
    const syncOpts = { checkMode, repoRoot };

    // 1. Antigravity plugin.json
    driftCount += syncFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(agPlugin, null, 2) + '\n', syncOpts);

    // 2. Claude Code .claude-plugin/plugin.json
    driftCount += syncFile(path.join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify(ccPlugin, null, 2) + '\n', syncOpts);

    // 3 & 4. MCP Servers: mcp_config.json & .mcp.json
    if (mcpContent) {
      driftCount += syncFile(path.join(pluginDir, 'mcp_config.json'), mcpContent, syncOpts);
      driftCount += syncFile(path.join(pluginDir, '.mcp.json'), mcpContent, syncOpts);
    }

    // 5 & 6. Hooks: Antigravity hooks.json & Claude Code hooks/hooks.json
    if (agHooks && ccHooks) {
      driftCount += syncFile(path.join(pluginDir, 'hooks.json'), JSON.stringify(agHooks, null, 2) + '\n', syncOpts);
      driftCount += syncFile(path.join(pluginDir, 'hooks', 'hooks.json'), JSON.stringify(ccHooks, null, 2) + '\n', syncOpts);
    }

    // 7. Keep package.json & mcp-server/package.json versions synchronized with canonical manifest
    driftCount += syncPackageVersion(path.join(pluginDir, 'package.json'), manifest.version, syncOpts);
    driftCount += syncPackageVersion(path.join(pluginDir, 'mcp-server', 'package.json'), manifest.version, syncOpts);
  }

  // 8. Marketplace Catalog (.claude-plugin/marketplace.json)
  const marketplacePath = path.join(repoRoot, '.claude-plugin', 'marketplace.json');
  if (validationErrors.length === 0 && fs.existsSync(marketplacePath)) {
    const market = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
    market.plugins = plugins.map(p => ({
      name: p.manifest.name || p.pluginId,
      description: p.manifest.description || '',
      source: `./plugins/${p.pluginId}`,
      version: p.manifest.version || '1.0.0'
    }));
    driftCount += syncFile(marketplacePath, JSON.stringify(market, null, 2) + '\n', { checkMode, repoRoot });
  }

  return { driftCount, validationErrors, pluginCount: plugins.length };
}

if (require.main === module) {
  const checkMode = process.argv.includes('--check');
  const { driftCount, validationErrors } = syncManifests({ checkMode });

  if (validationErrors.length > 0) {
    console.error('\x1b[31mCanonical manifest validation failed:\x1b[0m');
    for (const err of validationErrors) {
      console.error(`  - ${err}`);
    }
    process.exit(1);
  }

  if (checkMode) {
    if (driftCount > 0) {
      console.error(`\x1b[31mSync check failed: ${driftCount} file(s) out of sync with plugin.manifest.json.\x1b[0m`);
      console.error('Run "npm run sync-manifests" to regenerate derived configuration files.');
      process.exit(1);
    } else {
      console.log('\x1b[32m✔ All derived plugin configuration files are in sync!\x1b[0m');
    }
  } else {
    console.log('\x1b[32m✔ Plugin manifests synchronized successfully across Antigravity and Claude Code targets.\x1b[0m');
  }
}

module.exports = {
  syncManifests,
  validateCanonicalManifest,
  buildDerivedConfigs,
  extractPluginRootRefs
};

