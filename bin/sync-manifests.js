#!/usr/bin/env node

/**
 * bin/sync-manifests.js
 * 
 * Single-Source Manifest Build & Sync Script (DRY Cross-Platform Config).
 * Reads canonical plugin.manifest.json files from each plugin directory and generates:
 * 1. plugin.json (Antigravity plugin manifest)
 * 2. .claude-plugin/plugin.json (Claude Code manifest)
 * 3. mcp_config.json (Antigravity MCP server configuration)
 * 4. .mcp.json (Claude Code MCP server configuration)
 * 5. hooks.json (Antigravity lifecycle hooks configuration)
 * 6. hooks/hooks.json (Claude Code lifecycle hooks configuration)
 * 7. .claude-plugin/marketplace.json (Root marketplace catalog)
 *
 * Supports --check flag for CI validation.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(REPO_ROOT, 'plugins');
const isCheckMode = process.argv.includes('--check');

function syncManifests() {
  if (!fs.existsSync(PLUGINS_DIR)) {
    console.error('Plugins directory not found.');
    process.exit(1);
  }

  const pluginEntries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true });
  const plugins = [];
  let driftCount = 0;

  for (const entry of pluginEntries) {
    if (!entry.isDirectory()) continue;
    const pluginId = entry.name;
    const pluginDir = path.join(PLUGINS_DIR, pluginId);
    const manifestPath = path.join(pluginDir, 'plugin.manifest.json');

    if (!fs.existsSync(manifestPath)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    plugins.push({ pluginId, pluginDir, manifest });

    // 1. Antigravity plugin.json
    const agPlugin = {
      name: manifest.name || pluginId,
      displayName: manifest.displayName || manifest.name || pluginId,
      description: manifest.description || '',
      version: manifest.version || '1.0.0',
      author: typeof manifest.author === 'object' ? manifest.author.name : (manifest.author || 'Author'),
      repository: manifest.repository || 'https://github.com/sbelal/agent-marketplace'
    };
    driftCount += syncFile(path.join(pluginDir, 'plugin.json'), JSON.stringify(agPlugin, null, 2) + '\n');

    // 2. Claude Code .claude-plugin/plugin.json
    const ccPlugin = {
      name: manifest.name || pluginId,
      version: manifest.version || '1.0.0',
      description: manifest.description || '',
      author: typeof manifest.author === 'object' ? manifest.author : { name: manifest.author || 'Author' },
      repository: manifest.repository || 'https://github.com/sbelal/agent-marketplace'
    };
    driftCount += syncFile(path.join(pluginDir, '.claude-plugin', 'plugin.json'), JSON.stringify(ccPlugin, null, 2) + '\n');

    // 3 & 4. MCP Servers: mcp_config.json & .mcp.json
    if (manifest.mcpServers) {
      const mcpContent = JSON.stringify({ mcpServers: manifest.mcpServers }, null, 2) + '\n';
      driftCount += syncFile(path.join(pluginDir, 'mcp_config.json'), mcpContent);
      driftCount += syncFile(path.join(pluginDir, '.mcp.json'), mcpContent);
    }

    // 5. Antigravity hooks.json
    if (manifest.hooks) {
      const agHooks = {
        [`${manifest.name || pluginId}-session`]: {}
      };
      for (const [event, hookList] of Object.entries(manifest.hooks)) {
        agHooks[`${manifest.name || pluginId}-session`][event] = hookList.map(h => ({
          type: h.type || 'command',
          command: h.command,
          ...(h.timeout ? { timeout: h.timeout } : {})
        }));
      }
      driftCount += syncFile(path.join(pluginDir, 'hooks.json'), JSON.stringify(agHooks, null, 2) + '\n');

      // 6. Claude Code hooks/hooks.json
      const ccHooks = {
        hooks: {}
      };
      for (const [event, hookList] of Object.entries(manifest.hooks)) {
        ccHooks.hooks[event] = [
          {
            matcher: '',
            hooks: hookList.map(h => ({
              type: h.type || 'command',
              command: h.command
            }))
          }
        ];
      }
      driftCount += syncFile(path.join(pluginDir, 'hooks', 'hooks.json'), JSON.stringify(ccHooks, null, 2) + '\n');
    }
  }

  // 7. Marketplace Catalog (.claude-plugin/marketplace.json)
  const marketplacePath = path.join(REPO_ROOT, '.claude-plugin', 'marketplace.json');
  if (fs.existsSync(marketplacePath)) {
    const market = JSON.parse(fs.readFileSync(marketplacePath, 'utf8'));
    market.plugins = plugins.map(p => ({
      name: p.manifest.name || p.pluginId,
      description: p.manifest.description || '',
      source: `./plugins/${p.pluginId}`,
      version: p.manifest.version || '1.0.0'
    }));
    driftCount += syncFile(marketplacePath, JSON.stringify(market, null, 2) + '\n');
  }

  if (isCheckMode) {
    if (driftCount > 0) {
      console.error(`\x1b[31mSync check failed: ${driftCount} file(s) out of sync with plugin.manifest.json.\x1b[0m`);
      console.error('Run "npm run sync-manifests" to regenerate derived configuration files.');
      process.exit(1);
    } else {
      console.log('\x1b[32m✔ All derived plugin configuration files are in sync!\x1b[0m');
    }
  } else {
    console.log(`\x1b[32m✔ Plugin manifests synchronized successfully across Antigravity and Claude Code targets.\x1b[0m`);
  }
}

function syncFile(targetPath, expectedContent) {
  const parent = path.dirname(targetPath);
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent, { recursive: true });
  }

  let currentContent = '';
  if (fs.existsSync(targetPath)) {
    currentContent = fs.readFileSync(targetPath, 'utf8');
  }

  if (currentContent !== expectedContent) {
    if (isCheckMode) {
      console.warn(`[DRIFT] ${path.relative(REPO_ROOT, targetPath)} is out of sync.`);
      return 1;
    }
    fs.writeFileSync(targetPath, expectedContent, 'utf8');
  }
  return 0;
}

syncManifests();
