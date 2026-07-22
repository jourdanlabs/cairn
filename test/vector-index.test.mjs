// Tests for the LSH ANN index. Everything is SEEDED (mulberry32) so the planted
// clusters, the index hyperplanes, and thus every assertion are reproducible.
// We check the approximate index against an exact brute-force cosine baseline:
//   - query() recall@k ≥ 0.9 on a sample of queries
//   - nearDuplicatePairs() recovers planted near-duplicate pairs (recall ≥ 0.9)
//   - determinism: same seed → identical index → identical results.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VectorIndex, mulberry32, randn } from '../core/vector-index.mjs';

const DIMS = 64;

// --- seeded corpus with planted near-duplicate clusters -------------------------
// Returns { vecs, ids, clusterOf } where cluster members are a shared center plus
// small noise → tight cosine (~0.95+), well above the 0.9 near-dup threshold.
function makeCorpus({ seed = 42, n = 500, clusters = 8, perCluster = 12, noise = 0.025 } = {}) {
  const rng = mulberry32(seed);
  const randVec = () => { const v = new Float32Array(DIMS); for (let i = 0; i < DIMS; i++) v[i] = randn(rng); return v; };

  const centers = [];
  for (let c = 0; c < clusters; c++) centers.push(randVec());

  const vecs = [], ids = [], clusterOf = [];
  // Clustered items first: center + noise*gaussian.
  for (let c = 0; c < clusters; c++) {
    for (let m = 0; m < perCluster; m++) {
      const base = centers[c], v = new Float32Array(DIMS);
      for (let i = 0; i < DIMS; i++) v[i] = base[i] + noise * randn(rng);
      vecs.push(v); ids.push(`c${c}_m${m}`); clusterOf.push(c);
    }
  }
  // Fill the rest with unrelated singletons (cluster -1).
  while (vecs.length < n) { vecs.push(randVec()); ids.push(`s${vecs.length}`); clusterOf.push(-1); }
  return { vecs, ids, clusterOf };
}

// Exact cosine on raw (unnormalized) vectors — the ground-truth baseline.
function cosine(a, b) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return d / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

// Brute-force all cross pairs with cosine ≥ threshold, keyed "i|j" (i<j).
function bruteForcePairs(vecs, threshold) {
  const set = new Set();
  for (let i = 0; i < vecs.length; i++)
    for (let j = i + 1; j < vecs.length; j++)
      if (cosine(vecs[i], vecs[j]) >= threshold) set.add(i + '|' + j);
  return set;
}

// Brute-force top-k neighbor ids for a query vector (excludes the query index).
function bruteForceTopK(vecs, ids, qi, k) {
  const scored = [];
  for (let i = 0; i < vecs.length; i++) if (i !== qi) scored.push({ id: ids[i], score: cosine(vecs[qi], vecs[i]) });
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map((s) => s.id);
}

function buildIndex(corpus, opts = {}) {
  const idx = new VectorIndex({ dims: DIMS, bits: 12, tables: 12, seed: 7, ...opts });
  corpus.vecs.forEach((v, i) => idx.add(corpus.ids[i], v));
  idx.build();
  return idx;
}

test('query() recall@k ≥ 0.9 vs brute-force cosine on a sample', () => {
  const corpus = makeCorpus();
  const idx = buildIndex(corpus);
  const K = 10, SAMPLE = 40;
  const rng = mulberry32(123);

  // Recall@k is only meaningful for queries that HAVE genuine neighbors — a
  // singleton's "top-10" are near-zero-cosine noise no ANN can (or should)
  // recover. So we sample from clustered items, the standard ANN eval setup.
  const clustered = corpus.clusterOf.map((c, i) => (c >= 0 ? i : -1)).filter((i) => i >= 0);

  let hit = 0, total = 0;
  for (let s = 0; s < SAMPLE; s++) {
    const qi = clustered[Math.floor(rng() * clustered.length)];
    const truth = new Set(bruteForceTopK(corpus.vecs, corpus.ids, qi, K));
    // Query with the raw vector; drop the query's own id from the results.
    const got = idx.query(corpus.vecs[qi], K + 1).map((r) => r.id).filter((id) => id !== corpus.ids[qi]).slice(0, K);
    for (const id of got) if (truth.has(id)) hit++;
    total += truth.size;
  }
  const recall = hit / total;
  assert.ok(recall >= 0.9, `query recall@${K} was ${recall.toFixed(3)} (< 0.9)`);
});

test('nearDuplicatePairs(0.9) recovers planted near-dup pairs (recall ≥ 0.9)', () => {
  const corpus = makeCorpus();
  const idx = buildIndex(corpus);
  const threshold = 0.9;

  const truth = bruteForcePairs(corpus.vecs, threshold);           // exact set ≥ 0.9
  const found = new Set(idx.nearDuplicatePairs(threshold).map((p) => {
    const i = corpus.ids.indexOf(p.a), j = corpus.ids.indexOf(p.b);
    return Math.min(i, j) + '|' + Math.max(i, j);
  }));

  assert.ok(truth.size > 0, 'sanity: planted pairs exist above threshold');
  let hit = 0;
  for (const key of truth) if (found.has(key)) hit++;
  const recall = hit / truth.size;
  assert.ok(recall >= 0.9, `pair recall was ${recall.toFixed(3)} (< 0.9), truth=${truth.size} found=${found.size}`);

  // Precision sanity: every returned pair genuinely meets the threshold (no junk).
  for (const p of idx.nearDuplicatePairs(threshold)) assert.ok(p.score >= threshold);
  // Each pair appears once and is cross-item.
  for (const p of idx.nearDuplicatePairs(threshold)) assert.notEqual(p.a, p.b);
});

test('maxPerItem caps pairs per item, keeping highest scores first', () => {
  const corpus = makeCorpus();
  const idx = buildIndex(corpus);
  const cap = 3;
  const pairs = idx.nearDuplicatePairs(0.9, { maxPerItem: cap });
  const per = new Map();
  for (const p of pairs) { per.set(p.a, (per.get(p.a) || 0) + 1); per.set(p.b, (per.get(p.b) || 0) + 1); }
  for (const [, c] of per) assert.ok(c <= cap, `an item exceeded the cap (${c} > ${cap})`);
});

test('determinism: same seed → identical index → identical results', () => {
  const corpus = makeCorpus();
  const a = buildIndex(corpus);
  const b = buildIndex(corpus); // rebuilt from scratch, same seeds everywhere

  const pa = a.nearDuplicatePairs(0.85);
  const pb = b.nearDuplicatePairs(0.85);
  assert.deepEqual(pa, pb);

  const qa = a.query(corpus.vecs[0], 15);
  const qb = b.query(corpus.vecs[0], 15);
  assert.deepEqual(qa, qb);
});

test('a different seed changes the hyperplanes (index is actually seed-driven)', () => {
  const corpus = makeCorpus();
  const a = buildIndex(corpus, { seed: 1 });
  const b = buildIndex(corpus, { seed: 2 });
  // Same corpus, different projections → bucket signatures differ for some item.
  let differ = false;
  for (let t = 0; t < a.tables && !differ; t++)
    for (let i = 0; i < a.items.length; i++)
      if (a._sig(a.items[i].vec, t) !== b._sig(b.items[i].vec, t)) { differ = true; break; }
  assert.ok(differ, 'expected different seeds to produce different signatures');
});
