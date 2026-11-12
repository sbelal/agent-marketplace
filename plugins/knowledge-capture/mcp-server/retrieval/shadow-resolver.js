import fs from 'node:fs';
import path from 'node:path';
import { resolveStoragePaths } from '../core/storage-paths.js';
import { parseYamlFrontmatter, parseInlineArrayOrList } from '../core/yaml-parser.js';

export function findMarkdownFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  const results = [];
  function scan(currentDir) {
    try {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
            scan(fullPath);
          }
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          results.push(fullPath);
        }
      }
    } catch {}
  }
  scan(dirPath);
  return results.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

/**
 * Scans memory directories across layers in precedence order: Workspace > Private > Team.
 * Supports multi-team repositories dynamically from settings.json.
 */
export function scanLayerEntries(workspaceRoot, targetLayer = 'all') {
  const paths = resolveStoragePaths(workspaceRoot);
  const layersToScan = [];

  const normalized = (targetLayer || 'all').toLowerCase();
  if (normalized === 'all' || normalized === 'workspace') {
    layersToScan.push({ name: 'Workspace', key: 'workspace', dir: paths.workspaceDir });
  }
  if (normalized === 'all' || normalized === 'private') {
    layersToScan.push({ name: 'Private', key: 'private', dir: paths.privateDir });
  }
  const targetTeamSlug = normalized.startsWith('team/')
    ? normalized.slice(5)
    : (normalized !== 'all' && normalized !== 'team' && normalized !== 'workspace' && normalized !== 'private' ? normalized : null);

  if (normalized === 'all' || normalized === 'team' || targetTeamSlug) {
    // Scan active team repositories
    if (paths.activeTeamDirs && paths.activeTeamDirs.length > 0) {
      for (const tRepo of paths.activeTeamDirs) {
        if (targetTeamSlug && tRepo.slug.toLowerCase() !== targetTeamSlug.toLowerCase()) continue;
        layersToScan.push({
          name: `Team (${tRepo.slug})`,
          key: 'team',
          teamSlug: tRepo.slug,
          dir: tRepo.dir
        });
      }
    } else if (!paths.settings?.teamRepos || paths.settings.teamRepos.length === 0) {
      if (!targetTeamSlug || targetTeamSlug === 'default') {
        layersToScan.push({ name: 'Team', key: 'team', teamSlug: 'default', dir: paths.teamDir });
      }
    }
  }

  const allEntries = [];
  const activeEntries = [];
  const shadowedEntries = [];

  const seenSlugs = new Map(); // slug -> { byLayer, bySlug }
  const overriddenSlugs = new Map(); // targetSlug -> { byLayer, bySlug }

  for (const layer of layersToScan) {
    const files = findMarkdownFiles(layer.dir);
    const layerParsed = [];

    for (const file of files) {
      const base = path.basename(file, '.md');
      if (base.toUpperCase() === 'README') continue;

      try {
        const content = fs.readFileSync(file, 'utf8');
        const parsed = parseYamlFrontmatter(content);
        const slug = (parsed.frontmatter.slug || parsed.frontmatter.name || base).replace(/\.md$/i, '');
        const type = parsed.frontmatter.type || 'general';
        const domain = parsed.frontmatter.domain || 'general';
        const overridesRaw = parsed.frontmatter.overrides || '';
        const overridesList = parseInlineArrayOrList(overridesRaw);
        const related = Array.isArray(parsed.frontmatter.related)
          ? parsed.frontmatter.related
          : [];
        const verified = parsed.frontmatter.verified || '';
        const trigger =
          parsed.frontmatter.trigger ||
          parsed.frontmatter.description ||
          'General guideline';

        const entry = {
          layer: layer.name,
          layerKey: layer.key,
          teamSlug: layer.teamSlug || null,
          slug,
          type,
          domain,
          overrides: overridesList.join(', '),
          overridesList,
          related,
          verified,
          trigger,
          file,
          frontmatter: parsed.frontmatter
        };

        allEntries.push(entry);
        layerParsed.push(entry);
      } catch {}
    }

    for (const entry of layerParsed) {
      const slugKey = entry.slug.toLowerCase();
      const directShadow = seenSlugs.get(slugKey);
      const overrideShadow = overriddenSlugs.get(slugKey);

      if (directShadow || overrideShadow) {
        const shadowedBy = directShadow || overrideShadow;
        shadowedEntries.push({
          ...entry,
          shadowedByLayer: shadowedBy.byLayer,
          shadowedBySlug: shadowedBy.bySlug
        });
        continue;
      }

      activeEntries.push(entry);
      seenSlugs.set(slugKey, { byLayer: entry.layer, bySlug: entry.slug });
      for (const target of entry.overridesList) {
        const targetKey = target.toLowerCase();
        if (!overriddenSlugs.has(targetKey)) {
          overriddenSlugs.set(targetKey, { byLayer: entry.layer, bySlug: entry.slug });
        }
      }
    }
  }

  return { allEntries, activeEntries, shadowedEntries };
}
