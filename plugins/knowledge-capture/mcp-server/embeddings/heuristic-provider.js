/**
 * Tokenizes text into a normalized set of lowercase words.
 */
export function tokenizeText(str) {
  if (!str || typeof str !== 'string') return [];
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter(tok => tok.length > 1);
}

/**
 * Computes Cosine Similarity between two token frequency bags.
 */
export function computeCosineSimilarity(tokensA, tokensB) {
  if (!tokensA.length || !tokensB.length) return 0;
  const freqA = new Map();
  const freqB = new Map();

  for (const t of tokensA) freqA.set(t, (freqA.get(t) || 0) + 1);
  for (const t of tokensB) freqB.set(t, (freqB.get(t) || 0) + 1);

  let dotProduct = 0;
  for (const [t, countA] of freqA.entries()) {
    if (freqB.has(t)) {
      dotProduct += countA * freqB.get(t);
    }
  }

  let magA = 0;
  for (const count of freqA.values()) magA += count * count;
  let magB = 0;
  for (const count of freqB.values()) magB += count * count;

  const magnitude = Math.sqrt(magA) * Math.sqrt(magB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}

/**
 * Generates a deterministic dense 128-dimensional embedding vector from text.
 * Uses subword n-grams, bigrams, double hashing with sign hashing and L2 normalization.
 * Pure JS, zero external dependencies, deterministic across all platforms.
 */
export function generateDenseEmbedding(text, dimensions = 128) {
  const vec = new Float64Array(dimensions);
  if (!text || typeof text !== 'string') return Array.from(vec);

  const clean = text.toLowerCase().replace(/[^\w\s-]/g, ' ');
  const words = clean.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return Array.from(vec);

  const features = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    features.push(`w:${w}`);
    if (w.length >= 3) {
      for (let j = 0; j <= w.length - 3; j++) {
        features.push(`3:${w.slice(j, j + 3)}`);
      }
    }
    if (w.length >= 4) {
      for (let j = 0; j <= w.length - 4; j++) {
        features.push(`4:${w.slice(j, j + 4)}`);
      }
    }
    if (i < words.length - 1) {
      features.push(`b:${w}_${words[i + 1]}`);
    }
  }

  // Double-hash: bucket index + sign hashing to avoid collision bias
  for (const feat of features) {
    let h1 = 5381;
    let h2 = 2166136261;
    for (let i = 0; i < feat.length; i++) {
      const code = feat.charCodeAt(i);
      h1 = ((h1 << 5) + h1) ^ code;
      h2 = (h2 ^ code) * 16777619;
    }
    const idx = Math.abs(h1) % dimensions;
    const sign = (h2 & 1) === 0 ? 1 : -1;
    vec[idx] += sign;
  }

  // L2 Normalization
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vec[i] * vec[i];
  }
  norm = Math.sqrt(norm);

  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vec[i] /= norm;
    }
  }

  return Array.from(vec);
}

/**
 * Computes dot product (cosine similarity between L2-normalized dense vectors).
 */
export function computeDenseCosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1.0, dot));
}
