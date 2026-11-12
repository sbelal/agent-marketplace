import fs from 'node:fs';
import path from 'node:path';
import { getStorageDir } from '../core/storage-paths.js';
import { generateDenseEmbedding } from './heuristic-provider.js';

let onnxPipelinePromise = null;
let onnxLoadFailed = false;

export function resetOnnxState() {
  onnxPipelinePromise = null;
  onnxLoadFailed = false;
}

/**
 * Returns active embedding configuration from environment or settings.json.
 * Defaults to 'onnx' (384 dimensions) with automatic graceful fallback to 'heuristic' (128 dimensions).
 */
export function getActiveEmbeddingConfig() {
  const envChoice = process.env.KC_EMBEDDING_ENGINE;
  if (envChoice) {
    if (envChoice === 'onnx') return { engine: 'onnx', dimensions: 384 };
    return { engine: 'heuristic', dimensions: 128 };
  }

  try {
    const settingsPath = path.join(getStorageDir(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      if (settings.embeddingEngine === 'onnx') {
        return { engine: 'onnx', dimensions: 384 };
      }
      if (settings.embeddingEngine === 'heuristic') {
        return { engine: 'heuristic', dimensions: 128 };
      }
    }
  } catch {}

  return { engine: 'onnx', dimensions: 384 };
}

/**
 * Dynamically loads the ONNX feature extraction pipeline on demand.
 * Caches the pipeline promise and model locally. If loading fails, marks failure and returns null.
 */
export async function getOnnxExtractor() {
  if (onnxLoadFailed) return null;
  if (onnxPipelinePromise) return onnxPipelinePromise;

  onnxPipelinePromise = (async () => {
    try {
      const { pipeline, env } = await import('@xenova/transformers');
      env.cacheDir = path.join(getStorageDir(), 'models');
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        quantized: true
      });
      return extractor;
    } catch (err) {
      onnxLoadFailed = true;
      return null;
    }
  })();

  return onnxPipelinePromise;
}

/**
 * Generates an embedding vector using the configured engine.
 * Primary: Local ONNX Transformer (all-MiniLM-L6-v2, 384-d).
 * Fallback: Heuristic Vector Engine (subword & bigram double-hash, 128-d).
 */
export async function generateEmbedding(text, targetDimensions = null) {
  const config = getActiveEmbeddingConfig();
  if (config.engine === 'onnx') {
    try {
      const extractor = await getOnnxExtractor();
      if (extractor && text && typeof text === 'string' && text.trim().length > 0) {
        const out = await extractor(text.slice(0, 2048), { pooling: 'mean', normalize: true });
        return Array.from(out.data);
      }
    } catch {
      // Graceful fallback to heuristic
    }
  }
  const dim = targetDimensions || (config.engine === 'onnx' ? 384 : 128);
  return generateDenseEmbedding(text, dim);
}
