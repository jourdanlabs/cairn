// CAIRN scale layer — an approximate-nearest-neighbor (ANN) index in pure Node,
// zero deps. It replaces the O(n²) all-pairs cosine scan in lib/contradict.mjs:
// for a 100k+ chunk corpus, comparing every vector to every other is ~5e9 cosine
// ops — minutes of CPU. This index finds the SAME high-similarity pairs by only
// comparing vectors that are likely neighbors, at a large constant-factor win.
//
// APPROACH: random-projection LSH for cosine (a.k.a. SimHash / Charikar 2002).
// Draw K random hyperplanes; the sign of a vector's dot with each plane is one
// bit, so K bits form a bucket signature. For a random hyperplane the chance two
// unit vectors land on the same side is  p = 1 - θ/π,  where θ is the angle
// between them — a MONOTONIC function of cosine. So similar vectors collide often,
// dissimilar ones rarely. Probability a pair shares all K bits in one table is
// p^K; with L independent tables, recall of a pair = 1 - (1 - p^K)^L. We tune
// (K, L) so pairs at/above the target cosine are recovered with high probability
// while keeping buckets small (candidate set ≪ n²).
//
// Why LSH over IVF/k-means here: no training pass, no iteration-count / seeding
// pitfalls, fully deterministic from one seed, and the near-duplicate scan falls
// straight out of the bucket structure (compare only within-bucket pairs). The
// trade-off is honest: it is APPROXIMATE — a few true pairs can be missed (bounded
// by the recall formula above), which for contradiction *candidate* generation is
// fine since a model/second pass adjudicates the survivors.

// ---- seeded PRNG (exported so tests/benches build reproducible vectors) --------
// mulberry32: tiny, fast, decent-quality 32-bit generator. Deterministic per seed.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Standard-normal sample via Box–Muller, driven by a uniform rng in [0,1).
export function randn(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng(); // avoid log(0)
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// L2-normalize into a Float32Array of length `dims` so cosine(a,b) == dot(a,b).
function normalize(vec, dims) {
  const out = new Float32Array(dims);
  let n = 0;
  for (let i = 0; i < dims; i++) { const x = vec[i] || 0; out[i] = x; n += x * x; }
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < dims; i++) out[i] /= n;
  return out;
}

// Dot product of two equal-length vectors (== cosine when both are unit-norm).
function dot(a, b, dims) {
  let s = 0;
  for (let i = 0; i < dims; i++) s += a[i] * b[i];
  return s;
}

export class VectorIndex {
  /**
   * @param {object} opts
   * @param {number} opts.dims          vector dimensionality (required)
   * @param {number} [opts.bits=16]     hyperplanes per table (signature bits, ≤31)
   * @param {number} [opts.tables=10]   number of independent hash tables (L)
   * @param {number} [opts.seed=1]      PRNG seed for the hyperplanes (determinism)
   */
  constructor({ dims, bits = 16, tables = 10, seed = 1 } = {}) {
    if (!dims || dims < 1) throw new Error('VectorIndex: dims is required');
    if (bits < 1 || bits > 31) throw new Error('VectorIndex: bits must be 1..31');
    this.dims = dims;
    this.bits = bits;
    this.tables = tables;
    this.seed = seed;

    this.items = [];        // [{ id, vec:Float32Array(unit) }]
    this.buckets = null;    // [ Map<sig:int, idx[]> ] per table, after build()
    this.built = false;

    // Draw L*bits Gaussian hyperplanes up front. planes[t] packs `bits` planes of
    // length `dims` contiguously (row b at offset b*dims) for cache-friendly dots.
    const rng = mulberry32(seed);
    this.planes = [];
    for (let t = 0; t < tables; t++) {
      const P = new Float32Array(bits * dims);
      for (let i = 0; i < P.length; i++) P[i] = randn(rng);
      this.planes.push(P);
    }
  }

  get size() { return this.items.length; }

  // Add one vector under `id`. Stores a normalized copy so query/pairs use dots.
  add(id, vec) {
    this.items.push({ id, vec: normalize(vec, this.dims) });
    this.built = false; // adding invalidates any prior build
    return this;
  }

  // Signature of `vec` in table `t`: sign bits packed MSB-first into an int.
  _sig(vec, t) {
    const P = this.planes[t], D = this.dims, B = this.bits;
    let sig = 0;
    for (let b = 0; b < B; b++) {
      let d = 0; const off = b * D;
      for (let k = 0; k < D; k++) d += P[off + k] * vec[k];
      sig = (sig << 1) | (d >= 0 ? 1 : 0);
    }
    return sig >>> 0; // treat as unsigned for a stable Map key
  }

  // Build L bucket tables: group item indices by their per-table signature.
  build() {
    this.buckets = [];
    for (let t = 0; t < this.tables; t++) {
      const m = new Map();
      for (let i = 0; i < this.items.length; i++) {
        const sig = this._sig(this.items[i].vec, t);
        const arr = m.get(sig);
        if (arr) arr.push(i); else m.set(sig, [i]);
      }
      this.buckets.push(m);
    }
    this.built = true;
    return this;
  }

  // Approximate top-k neighbors of `vec` by cosine. Candidates = items sharing a
  // bucket with the query in any table; we rank those exactly and return the best.
  query(vec, k = 10) {
    if (!this.built) this.build();
    const q = normalize(vec, this.dims);
    const cand = new Set();
    for (let t = 0; t < this.tables; t++) {
      const arr = this.buckets[t].get(this._sig(q, t));
      if (arr) for (let i = 0; i < arr.length; i++) cand.add(arr[i]);
    }
    const scored = [];
    for (const i of cand) scored.push({ id: this.items[i].id, score: dot(q, this.items[i].vec, this.dims) });
    // Deterministic tie-break by id so equal scores order the same every run.
    scored.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return scored.slice(0, k);
  }

  /**
   * Cross-item near-duplicate pairs with cosine ≥ `threshold`, found via the
   * index (only within-bucket pairs are ever scored — never brute force). Each
   * unordered pair is returned once. This is the scale replacement for the
   * O(n²) contradiction candidate pass.
   * @param {number} threshold                cosine cutoff (e.g. 0.9)
   * @param {object} [opts]
   * @param {number} [opts.maxPerItem]         cap kept pairs per item (bounds
   *   output when a huge dense bucket would otherwise emit ~m² pairs). Highest-
   *   scoring pairs are kept first.
   * @returns {{a:*, b:*, score:number}[]}     sorted by score desc, deterministic
   */
  nearDuplicatePairs(threshold = 0.9, { maxPerItem = Infinity } = {}) {
    if (!this.built) this.build();
    const n = this.items.length;
    const seen = new Set();      // candidate pairs already scored (any table)
    const kept = new Map();      // key -> score, only pairs ≥ threshold
    for (let t = 0; t < this.tables; t++) {
      for (const arr of this.buckets[t].values()) {
        const m = arr.length;
        if (m < 2) continue;
        for (let x = 0; x < m; x++) {
          for (let y = x + 1; y < m; y++) {
            let i = arr[x], j = arr[y];
            if (i > j) { const s = i; i = j; j = s; }
            const key = i * n + j; // unique per unordered pair; safe for n≲9e7
            if (seen.has(key)) continue;
            seen.add(key);
            const sc = dot(this.items[i].vec, this.items[j].vec, this.dims);
            if (sc >= threshold) kept.set(key, sc);
          }
        }
      }
    }
    // Deterministic order: score desc, then (i, j) asc.
    const out = [];
    for (const [key, score] of kept) out.push({ i: Math.floor(key / n), j: key % n, score });
    out.sort((a, b) => b.score - a.score || a.i - b.i || a.j - b.j);

    let final = out;
    if (maxPerItem !== Infinity) {
      const per = new Int32Array(n);
      final = [];
      for (const p of out) {
        if (per[p.i] >= maxPerItem || per[p.j] >= maxPerItem) continue;
        per[p.i]++; per[p.j]++;
        final.push(p);
      }
    }
    return final.map((p) => ({ a: this.items[p.i].id, b: this.items[p.j].id, score: p.score }));
  }
}

export default VectorIndex;
