import { generateDenseEmbedding, computeDenseCosineSimilarity } from './heuristic-provider.js';
import { generateEmbedding } from './onnx-provider.js';

/**
 * Generates synchronous multi-vector representation (128-d heuristic fallback).
 */
export function generateMultiVector(entry) {
  const triggerText = `${entry.trigger || entry.description || ''}`;
  const contentText = typeof entry.body === 'string' ? entry.body : (entry.content || '');
  const entityText = `${entry.slug || ''} ${entry.domain || ''} ${entry.type || ''} ${(entry.related || []).join(' ')}`;

  return {
    trigger_vector: generateDenseEmbedding(triggerText, 128),
    content_vector: generateDenseEmbedding(contentText, 128),
    entity_vector: generateDenseEmbedding(entityText, 128)
  };
}

/**
 * Generates asynchronous multi-vector representation across 3 facets: trigger, content, entity.
 * Uses active embedding provider (Local ONNX 384-d or Heuristic 128-d).
 */
export async function generateMultiVectorAsync(entry) {
  const triggerText = `${entry.trigger || entry.description || ''}`;
  const contentText = typeof entry.body === 'string' ? entry.body : (entry.content || '');
  const entityText = `${entry.slug || ''} ${entry.domain || ''} ${entry.type || ''} ${(entry.related || []).join(' ')}`;

  const [tVec, cVec, eVec] = await Promise.all([
    generateEmbedding(triggerText),
    generateEmbedding(contentText),
    generateEmbedding(entityText)
  ]);

  return {
    trigger_vector: tVec,
    content_vector: cVec,
    entity_vector: eVec
  };
}

/**
 * Computes composite Multi-Vector similarity between query vector and memory multi-vector facets.
 * Weights: 50% trigger/intent, 35% content/rule, 15% entity/metadata.
 */
export function computeMultiVectorSimilarity(queryVec, multiVec) {
  if (!queryVec || !multiVec) return 0;
  const sTrigger = computeDenseCosineSimilarity(queryVec, multiVec.trigger_vector);
  const sContent = computeDenseCosineSimilarity(queryVec, multiVec.content_vector);
  const sEntity = computeDenseCosineSimilarity(queryVec, multiVec.entity_vector);

  return (sTrigger * 0.50) + (sContent * 0.35) + (sEntity * 0.15);
}
