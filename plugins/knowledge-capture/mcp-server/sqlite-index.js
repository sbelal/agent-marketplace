/**
 * Façade for Knowledge Capture SQLite Index & Semantic Graph Services.
 * Decomposed under db/, embeddings/, retrieval/, graph/, and audit/ following SRP.
 */

export {
  isSqliteAvailable,
  getDbPath,
  resetDatabaseInstance,
  getDatabase
} from './db/connection.js';

export {
  getStorageDir,
  getTelemetryJsonPath,
  normalizeWorkspaceId
} from './core/storage-paths.js';

export {
  tokenizeText,
  computeCosineSimilarity,
  generateDenseEmbedding,
  computeDenseCosineSimilarity
} from './embeddings/heuristic-provider.js';

export {
  resetOnnxState,
  getActiveEmbeddingConfig,
  getOnnxExtractor,
  generateEmbedding
} from './embeddings/onnx-provider.js';

export {
  generateMultiVector,
  generateMultiVectorAsync,
  computeMultiVectorSimilarity
} from './embeddings/multi-vector.js';

export {
  syncSqliteMetadata,
  getKnowledgeGraphData,
  getMemoryGraphNeighbors,
  getMemorySpanningTree
} from './graph/graph-service.js';

export {
  isIndexDirty,
  syncSqliteIndex,
  searchMemoriesFileBasedFallback,
  searchMemoriesHybrid
} from './retrieval/hybrid-search.js';

export {
  recordTelemetryEvent,
  recordMemoryEfficacy,
  correlateTestExecutionEfficacy
} from './db/telemetry.js';

export {
  proactiveMemoryProbe
} from './core/session-sentinel.js';

export {
  generateKnowledgeGraphHtml
} from './graph/memory-studio-html.js';

export {
  renderVisualMemoryStudio,
  stopStudioService
} from './graph/studio-launcher.js';

export {
  detectContradictionsAndDrift,
  detectContradictionsAndDriftAsync
} from './audit/drift-detector.js';

export {
  dreamMemoryConsolidation,
  dreamMemoryConsolidationAsync
} from './audit/dream-synthesizer.js';
