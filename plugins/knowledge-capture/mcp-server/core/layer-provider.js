import fs from 'node:fs';
import path from 'node:path';
import { resolveStoragePaths, getStorageDir, getSettings, GIT_EXEC_ENV } from './storage-paths.js';
import { findMarkdownFiles } from '../retrieval/shadow-resolver.js';
import { parseYamlFrontmatter, serializeYamlFrontmatter } from './yaml-parser.js';
import { atomicWriteFileSync } from './memory-store.js';

/**
 * Unified Layer Provider Pattern (Decoupling Filesystem & Multi-Team Routing from Memory Operations).
 * Provides a uniform interface across Workspace, Private, and multi-team repositories.
 */
export class LayerProvider {
  constructor(workspaceRoot = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.paths = resolveStoragePaths(workspaceRoot);
    this.settings = getSettings(this.paths.baseDir);
  }

  getWorkspaceDir() {
    return this.paths.workspaceDir;
  }

  getPrivateDir() {
    return this.paths.privateDir;
  }

  getTeamBaseDir() {
    return this.paths.teamDir;
  }

  /**
   * Returns list of all active layer descriptors.
   * Order reflects precedence: Workspace > Private > Team.
   */
  getActiveLayers() {
    const layers = [
      {
        key: 'workspace',
        name: 'Workspace',
        dir: this.paths.workspaceDir,
        isGit: fs.existsSync(path.join(this.workspaceRoot, '.git')),
        isWritable: true,
        scope: 'workspace'
      },
      {
        key: 'private',
        name: 'Private',
        dir: this.paths.privateDir,
        isGit: fs.existsSync(path.join(this.paths.privateDir, '.git')),
        isWritable: true,
        scope: 'global'
      }
    ];

    if (this.paths.activeTeamDirs && this.paths.activeTeamDirs.length > 0) {
      for (const tRepo of this.paths.activeTeamDirs) {
        layers.push({
          key: 'team',
          teamSlug: tRepo.slug,
          name: `Team (${tRepo.name || tRepo.slug})`,
          dir: tRepo.dir,
          url: tRepo.url,
          isGit: fs.existsSync(path.join(tRepo.dir, '.git')),
          isWritable: false,
          scope: 'global'
        });
      }
    } else {
      layers.push({
        key: 'team',
        teamSlug: 'default',
        name: 'Team (Default)',
        dir: this.paths.teamDir,
        url: this.settings.teamRepoUrl || '',
        isGit: fs.existsSync(path.join(this.paths.teamDir, '.git')),
        isWritable: false,
        scope: 'global'
      });
    }

    return layers;
  }

  /**
   * Resolves a target team repository directory by slug.
   * If slug is omitted, returns the first active team repo or default team directory.
   */
  resolveTeamRepoDir(teamSlug = null) {
    if (this.paths.activeTeamDirs && this.paths.activeTeamDirs.length > 0) {
      if (teamSlug) {
        const match = this.paths.activeTeamDirs.find(r => r.slug.toLowerCase() === teamSlug.toLowerCase());
        return match ? match.dir : null;
      }
      return this.paths.activeTeamDirs[0].dir;
    }
    return teamSlug ? null : this.paths.teamDir;
  }

  /**
   * Finds a memory file on disk given slug and optional layer filter.
   * If layer is 'all', resolves according to precedence: Workspace > Private > Team.
   * In multi-team setups, scans all active team repository directories, or a specific team slug.
   */
  findMemoryFile(slug, targetLayer = 'all') {
    if (!slug) return null;
    const cleanSlug = path.basename(slug.trim()).replace(/\.md$/i, '');
    const normLayer = (targetLayer || 'all').toLowerCase();
    const fileName = `${cleanSlug}.md`;

    // 1. Workspace
    if (normLayer === 'all' || normLayer === 'workspace') {
      const p = path.join(this.paths.workspaceDir, fileName);
      if (fs.existsSync(p)) {
        return { layer: 'workspace', teamSlug: null, path: p, slug: cleanSlug };
      }
    }

    // 2. Private
    if (normLayer === 'all' || normLayer === 'private') {
      const p = path.join(this.paths.privateDir, fileName);
      if (fs.existsSync(p)) {
        return { layer: 'private', teamSlug: null, path: p, slug: cleanSlug };
      }
    }

    // 3. Team (or specific team repository slug)
    const targetTeamSlug = normLayer.startsWith('team/')
      ? normLayer.slice(5)
      : (normLayer !== 'all' && normLayer !== 'team' && normLayer !== 'workspace' && normLayer !== 'private' ? normLayer : null);

    if (normLayer === 'all' || normLayer === 'team' || targetTeamSlug) {
      if (this.paths.activeTeamDirs && this.paths.activeTeamDirs.length > 0) {
        for (const tRepo of this.paths.activeTeamDirs) {
          if (targetTeamSlug && tRepo.slug.toLowerCase() !== targetTeamSlug) continue;
          const p = path.join(tRepo.dir, fileName);
          if (fs.existsSync(p)) {
            return { layer: 'team', teamSlug: tRepo.slug, path: p, slug: cleanSlug };
          }
        }
      }
      if (!targetTeamSlug || targetTeamSlug === 'default') {
        const flatTeamPath = path.join(this.paths.teamDir, fileName);
        if (fs.existsSync(flatTeamPath)) {
          return { layer: 'team', teamSlug: 'default', path: flatTeamPath, slug: cleanSlug };
        }
      }
    }

    return null;
  }
}

export function createLayerProvider(workspaceRoot = process.cwd()) {
  return new LayerProvider(workspaceRoot);
}
