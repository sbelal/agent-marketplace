import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getStorageDir } from '../core/storage-paths.js';
import { generateDenseEmbedding } from './heuristic-provider.js';

let onnxPipelinePromise = null;
let onnxLoadFailed = false;
let onnxPackageChecked = null;

export function isOnnxPackageAvailable() {
  if (onnxPackageChecked !== null) return onnxPackageChecked;
  try {
    const req = createRequire(import.meta.url);
    req.resolve('@xenova/transformers');
    onnxPackageChecked = true;
  } catch {
    onnxPackageChecked = false;
  }
  return onnxPackageChecked;
}

export function resetOnnxState() {
  onnxPipelinePromise = null;
  onnxLoadFailed = false;
  onnxPackageChecked = null;
}

/**
 * Returns active embedding configuration from environment or settings.json.
 * Respects explicit 'onnx' / 'heuristic' selection; when unconfigured, uses 'onnx'
 * only if @xenova/transformers is installed and otherwise defaults to 'heuristic' (128-d).
 */
export function getActiveEmbeddingConfig() {
  const onnxPackageInstalled = isOnnxPackageAvailable();
  const onnxReady = onnxPackageInstalled && !onnxLoadFailed;
  const envChoice = typeof process.env.KC_EMBEDDING_ENGINE === 'string'
    ? process.env.KC_EMBEDDING_ENGINE.trim().toLowerCase()
    : '';
  if (envChoice) {
    if (envChoice === 'onnx') {
      return { engine: 'onnx', dimensions: 384, onnxAvailable: onnxReady, fallbackActive: !onnxReady };
    }
    return { engine: 'heuristic', dimensions: 128, onnxAvailable: onnxReady, fallbackActive: false };
  }

  try {
    const settingsPath = path.join(getStorageDir(), 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const settingEngine = typeof settings.embeddingEngine === 'string'
        ? settings.embeddingEngine.trim().toLowerCase()
        : '';
      if (settingEngine === 'onnx') {
        return { engine: 'onnx', dimensions: 384, onnxAvailable: onnxReady, fallbackActive: !onnxReady };
      }
      if (settingEngine === 'heuristic') {
        return { engine: 'heuristic', dimensions: 128, onnxAvailable: onnxReady, fallbackActive: false };
      }
    }
  } catch {}

  if (onnxPackageInstalled) {
    return { engine: 'onnx', dimensions: 384, onnxAvailable: onnxReady, fallbackActive: !onnxReady };
  }
  return { engine: 'heuristic', dimensions: 128, onnxAvailable: false, fallbackActive: false };
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
