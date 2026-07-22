// Parity: the ANN path in similarPairs must recover the same contradiction
// candidates as the exact O(n²) scan. Uses seeded vectors so it's deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarPairs } from '../lib/contradict.mjs';
import { mulberry32, randn } from '../core/vector-index.mjs';

const DIMS = 64;

// A synthetic embedded index: one chunk per note. A planted cluster of 4 notes
// sits near a shared base vector (mutually similar); the rest are random noise
// that stays below threshold.
function syntheticIndex(seed = 42) {
  const rng = mulberry32(seed);
  const rvec = () => Array.from({ length: DIMS }, () => randn(rng));
  const chunks = [];
  const byRel = new Map();
  const add = (name, vec) => {
    const noteRel = `${name}.md`;
    chunks.push({ vec, noteRel, heading: '', text: `${name} body text here` });
    byRel.set(noteRel, { controlled: false });
  };

  const base = rvec();
  for (let c = 0; c < 4; c++) {
    // base + small noise → high mutual cosine (a real near-duplicate cluster)
    const noise = rvec();
    add(`cluster-${c}`, base.map((x, k) => x + 0.05 * noise[k]));
  }
  for (let n = 0; n < 40; n++) add(`noise-${n}`, rvec());

  return { embedded: true, chunks, byRel };
}

const notePairSet = (res) =>
  new Set(res.pairs.map((p) => [p.a.note, p.b.note].sort().join('|')));

test('ANN path recovers the same note-pairs as the exact scan', () => {
  const index = syntheticIndex();
  const exact = similarPairs(index, { threshold: 0.82, maxPairs: 50, ann: false });
  const ann = similarPairs(index, { threshold: 0.82, maxPairs: 50, ann: true });

  assert.equal(exact.method, 'exact');
  assert.equal(ann.method, 'ann');

  const E = notePairSet(exact);
  const A = notePairSet(ann);
  assert.ok(E.size >= 6, `expected ≥6 cluster pairs, got ${E.size}`); // 4 choose 2

  // Every exact candidate is recovered by ANN (recall == 1 on this planted set).
  for (const k of E) assert.ok(A.has(k), `ANN missed note-pair ${k}`);
});

test('ANN is deterministic across runs (seeded hyperplanes)', () => {
  const index = syntheticIndex();
  const a = similarPairs(index, { threshold: 0.82, ann: true });
  const b = similarPairs(index, { threshold: 0.82, ann: true });
  assert.deepEqual(notePairSet(a), notePairSet(b));
});
