// CAIRN ANN benchmark — quantifies why the LSH index (core/vector-index.mjs)
// replaces the O(n²) all-pairs cosine scan for near-duplicate / contradiction
// candidate generation at enterprise scale.
//
// Everything is SEEDED (mulberry32) so numbers are reproducible run-to-run.
//
// Honesty notes, printed below too:
//  * The full O(n²) baseline at N=20000 is ~2e11 cosine multiply-adds (minutes),
//    so we TIME it on a smaller N0 subset and EXTRAPOLATE by (N/N0)². Labeled.
//  * The index is APPROXIMATE. We measure recall vs an EXACT brute-force pass on
//    the N0 subset and print it — that is the real trade-off for the speedup.
//
// Run from the repo root:  node examples/bench-ann.mjs [threshold]

import { VectorIndex, mulberry32, randn } from '../core/vector-index.mjs';

const DIMS = 768;
const N = 20000;             // full corpus for the speed measurement
const N0 = 2000;             // subset used for the exact brute-force baseline
const THRESHOLD = Number(process.argv[2] || 0.9);
const BITS = 14, TABLES = 12, SEED = 7;
const NOISE = 0.2; // cluster spread → near-dup cosines straddle ~0.88..0.98

// Seeded corpus: `clusters` tight near-duplicate groups (center + small noise →
// cosine ≫ threshold) placed FIRST, then unrelated singletons. Clustered-first so
// the N0 subset contains real pairs for the baseline.
function genCorpus({ seed, n, clusters, perCluster, noise = NOISE }) {
  const rng = mulberry32(seed);
  const randVec = () => { const v = new Float32Array(DIMS); for (let i = 0; i < DIMS; i++) v[i] = randn(rng); return v; };
  const centers = []; for (let c = 0; c < clusters; c++) centers.push(randVec());
  const vecs = [], ids = [];
  for (let c = 0; c < clusters; c++)
    for (let m = 0; m < perCluster; m++) {
      const base = centers[c], v = new Float32Array(DIMS);
      for (let i = 0; i < DIMS; i++) v[i] = base[i] + noise * randn(rng);
      vecs.push(v); ids.push(`c${c}_m${m}`);
    }
  while (vecs.length < n) { vecs.push(randVec()); ids.push(`s${vecs.length}`); }
  return { vecs, ids };
}

function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Exact O(n²) near-duplicate pairs — the baseline the index must reproduce.
function bruteForcePairs(vecs, threshold) {
  const set = new Set();
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++)
      if (cosine(vecs[i], vecs[j]) >= threshold) set.add(i + '|' + j);
  return set;
}

function buildIndex(corpus) {
  const idx = new VectorIndex({ dims: DIMS, bits: BITS, tables: TABLES, seed: SEED });
  const t0 = performance.now();
  corpus.vecs.forEach((v, i) => idx.add(corpus.ids[i], v));
  idx.build();
  return { idx, buildMs: performance.now() - t0 };
}

const ms = (x) => `${x.toFixed(1)} ms`;
const fmt = (x) => x.toLocaleString('en-US');

console.log('CAIRN ANN benchmark — random-projection LSH vs brute-force cosine');
console.log('─'.repeat(66));
console.log(`corpus:     N=${fmt(N)} vectors, dims=${DIMS}, cosine threshold=${THRESHOLD}`);
console.log(`index:      LSH bits=${BITS}, tables=${TABLES}, seed=${SEED}`);
console.log('');

// ---- FULL N: build + index-driven near-duplicate pass --------------------------
const full = genCorpus({ seed: 1, n: N, clusters: 40, perCluster: 25 });
const { idx, buildMs } = buildIndex(full);
const tp = performance.now();
const pairs = idx.nearDuplicatePairs(THRESHOLD, { maxPerItem: 50 });
const pairsMs = performance.now() - tp;
console.log(`[index] build:            ${ms(buildMs)}`);
console.log(`[index] nearDuplicatePairs: ${ms(pairsMs)}  → ${fmt(pairs.length)} pairs`);
console.log(`[index] total:            ${ms(buildMs + pairsMs)}`);
console.log('');

// ---- N0 SUBSET: exact brute-force baseline (timed) + recall check --------------
const sub = genCorpus({ seed: 1, n: N0, clusters: 8, perCluster: 25 });
const tb = performance.now();
const truth = bruteForcePairs(sub.vecs, THRESHOLD);
const bruteMsN0 = performance.now() - tb;

// Recall: build the index over the SAME subset and compare its pairs to truth.
const subIdx = new VectorIndex({ dims: DIMS, bits: BITS, tables: TABLES, seed: SEED });
sub.vecs.forEach((v, i) => subIdx.add(sub.ids[i], v));
subIdx.build();
const subFound = new Set(subIdx.nearDuplicatePairs(THRESHOLD).map((p) => {
  const i = sub.ids.indexOf(p.a), j = sub.ids.indexOf(p.b);
  return Math.min(i, j) + '|' + Math.max(i, j);
}));
let hit = 0; for (const k of truth) if (subFound.has(k)) hit++;
const recall = truth.size ? hit / truth.size : 1;
const precision = subFound.size ? hit / subFound.size : 1; // index pairs are exact-scored, so ~1

// Extrapolate the full brute-force time from the N0 timing: cost ∝ n².
const bruteMsFullEst = bruteMsN0 * (N / N0) ** 2;
const speedup = bruteMsFullEst / (buildMs + pairsMs);

console.log(`[brute] baseline on N0=${fmt(N0)}: ${ms(bruteMsN0)}  → ${fmt(truth.size)} exact pairs`);
console.log(`[brute] extrapolated to N=${fmt(N)}: ~${ms(bruteMsFullEst)}  (= N0 time × (N/N0)² = ×${(N / N0) ** 2})`);
console.log('');
console.log('─'.repeat(66));
console.log(`HEADLINE`);
console.log(`  speedup (index build+pairs vs extrapolated brute): ~${speedup.toFixed(0)}×`);
console.log(`  recall  (index pairs vs exact brute on N0):         ${(recall * 100).toFixed(1)}%`);
console.log(`  precision (index pairs that truly meet threshold):  ${(precision * 100).toFixed(1)}%`);
console.log('─'.repeat(66));
console.log('trade-off: the index is APPROXIMATE — it scores only within-bucket');
console.log('candidate pairs, so it can miss a few true pairs (recall < 100%).');
console.log('For contradiction *candidate* generation this is the right trade: a');
console.log(`~${speedup.toFixed(0)}× speedup for ${((1 - recall) * 100).toFixed(1)}% missed candidates, which a later`);
console.log('model/second pass adjudicates anyway. Precision stays ~100% because');
console.log('every returned pair is scored with an exact cosine before it is kept.');
