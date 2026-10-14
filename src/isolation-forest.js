'use strict';

// Isolation Forest: random feature splits; anomalies have shorter mean path lengths.
// Seeded training is reproducible. Training data are synthetic classroom baselines.
const FEATURES = ['failedLogins15m', 'deniedAccess15m', 'cipherRequests1m', 'accountChanges15m'];
function seeded(seed) {
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let x = Math.imul(seed ^ seed >>> 15, 1 | seed); x ^= x + Math.imul(x ^ x >>> 7, 61 | x); return ((x ^ x >>> 14) >>> 0) / 4294967296; };
}
function averagePath(n) {
  if (n <= 1) return 0;
  if (n === 2) return 1;
  return 2 * (Math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n;
}
function buildTree(rows, depth, maxDepth, random) {
  if (rows.length <= 1 || depth >= maxDepth) return { size: rows.length };
  const ranges = FEATURES.map((_, index) => [Math.min(...rows.map(row => row[index])), Math.max(...rows.map(row => row[index]))]);
  const varying = ranges.map((range, index) => range[0] < range[1] ? index : -1).filter(index => index >= 0);
  if (!varying.length) return { size: rows.length };
  const feature = varying[Math.floor(random() * varying.length)];
  const [min, max] = ranges[feature];
  const split = min + (0.000001 + random() * 0.999998) * (max - min);
  return { feature, split, left: buildTree(rows.filter(row => row[feature] < split), depth + 1, maxDepth, random), right: buildTree(rows.filter(row => row[feature] >= split), depth + 1, maxDepth, random) };
}
function pathLength(row, tree, depth = 0) {
  return tree.size !== undefined ? depth + averagePath(tree.size) : pathLength(row, row[tree.feature] < tree.split ? tree.left : tree.right, depth + 1);
}
class IsolationForest {
  constructor(rows, { seed = 42, trees = 96, sampleSize = 128 } = {}) {
    if (!rows.length || rows.some(row => row.length !== FEATURES.length || row.some(value => !Number.isFinite(value)))) throw new Error('Invalid training samples');
    const random = seeded(seed);
    this.sampleSize = Math.min(sampleSize, rows.length);
    this.trees = Array.from({ length: trees }, () => {
      const sample = [...rows];
      for (let i = sample.length - 1; i > 0; i -= 1) { const j = Math.floor(random() * (i + 1)); [sample[i], sample[j]] = [sample[j], sample[i]]; }
      return buildTree(sample.slice(0, this.sampleSize), 0, Math.ceil(Math.log2(this.sampleSize)), random);
    });
  }
  score(row) {
    const length = this.trees.reduce((sum, tree) => sum + pathLength(row, tree), 0) / this.trees.length;
    return 2 ** (-length / averagePath(this.sampleSize));
  }
}
function syntheticBaseline(seed = 12, count = 640) {
  const random = seeded(seed);
  return Array.from({ length: count }, () => [
    random() < 0.8 ? 0 : Math.floor(random() * 3),
    random() < 0.95 ? 0 : 1,
    Math.floor(random() * 13),
    random() < 0.9 ? 0 : Math.floor(random() * 3)
  ]);
}
function createMonitor() {
  const model = new IsolationForest(syntheticBaseline());
  const scores = syntheticBaseline(987, 240).map(row => model.score(row)).sort((a, b) => a - b);
  const threshold = scores[Math.floor(scores.length * 0.975)];
  return {
    metadata: { algorithm: 'Isolation Forest', version: 'iforest-synthetic-v1', trainingSource: 'Synthetic classroom baseline; not validated on real attacks', trainingSamples: 640, trees: 96, threshold, features: FEATURES },
    assess(values) { const row = FEATURES.map(feature => values[feature] || 0); const score = model.score(row); return { score: Number(score.toFixed(4)), anomalous: score > threshold, modelVersion: this.metadata.version, features: values }; }
  };
}
module.exports = { IsolationForest, createMonitor, syntheticBaseline, FEATURES };
