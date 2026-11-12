/**
 * Façade for Knowledge Capture Storage & Inspection Service.
 * Decomposed under core/, retrieval/, and audit/ following the Single Responsibility Principle.
 */

export {
  getHomeDir,
  resolveStoragePaths,
  getStorageDir,
  getDbPath,
  getTelemetryJsonPath,
  normalizeWorkspaceId,
  getSettings,
  deriveTeamRepoSlug
} from './core/storage-paths.js';

export {
  atomicWriteFileSync,
  evaluateEntryStaleness,
  queryGitRepoStatus,
  getMemorySummary,
  getLayerStatistics,
  getMemoryContent,
  rewireMemoryReferences,
  cleanDanglingReferences,
  saveMemoryEntry,
  mergeMemoryEntries,
  deleteMemoryEntry,
  syncMemoryLayer,
  prepareTeamPromotion
} from './core/memory-store.js';

export {
  parseYamlFrontmatter,
  serializeYamlFrontmatter,
  stripQuotes,
  parseInlineArrayOrList
} from './core/yaml-parser.js';

export {
  getTeamRepositories,
  addTeamRepository,
  setTeamRepositoryActive,
  removeTeamRepository,
  syncTeamRepositories
} from './core/team-sync.js';

export {
  autoElicitSessionKnowledge
} from './core/session-sentinel.js';

export {
  findMarkdownFiles,
  scanLayerEntries
} from './retrieval/shadow-resolver.js';

export {
  mineGitHistoryMemories
} from './audit/archeology-scanner.js';

export {
  ingestTeamAdr,
  bootstrapRepoMemories
} from './audit/bootstrap-scanner.js';
