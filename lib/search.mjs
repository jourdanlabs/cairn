// CAIRN retrieval — BM25 over heading chunks, boosted by Obsidian structure
// (title / heading / tag / link-authority), optionally blended with semantic
// similarity (embeddings) so synonyms surface too. A confidence score lets weak
// matches be refused instead of dressed up. Deterministic given the same index.

import { tokenize } from './index.mjs';

const K1 = 1.5;
const B = 0.75;
const SEM_W = 0.45; // semantic weight in the hybrid blend
const SEM_MIN = 0.5; // a chunk with no lexical hit still qualifies if sem >= this

function idf(df, N) { return Math.log(1 + (N - df + 0.5) / (df + 0.5)); }

function snippet(text, qterms) {
  const words = text.split(/\s+/);
  const low = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
  let best = 0, bestHit = -1;
  for (let i = 0; i < words.length; i++) {
    if (qterms.has(low[i])) {
      let hits = 0;
      for (let j = Math.max(0, i - 12); j < Math.min(words.length, i + 12); j++) if (qterms.has(low[j])) hits++;
      if (hits > best) { best = hits; bestHit = i; }
    }
  }
  const center = bestHit >= 0 ? bestHit : 0;
  const start = Math.max(0, center - 18);
  const end = Math.min(words.length, start + 44);
  return (start > 0 ? '… ' : '') + words.slice(start, end).join(' ') + (end < words.length ? ' …' : '');
}

// semScores: optional Float array (cosine per chunk index) to enable hybrid mode.
// strictness (0..1) tunes the confidence gate: how sure CAIRN must be before it
// answers rather than refuses. 0.5 is the calibrated default (thresholds unchanged);
// higher = refuses more (stricter), lower = answers more readily.
export function search(index, query, { k = 8, perNote = 2, semScores = null, strictness = 0.5 } = {}) {
  const qtokens = tokenize(query);
  const qset = new Set(qtokens);
  const qraw = query.toLowerCase();
  const uniq = [...qset];
  const hybrid = Array.isArray(semScores) || ArrayBuffer.isView(semScores);
  if (!uniq.length && !hybrid) return { hits: [], confidence: 0, weak: true, qterms: [], mode: 'lexical' };

  const idfs = new Map(uniq.map((t) => [t, idf(index.df.get(t) || 0, index.N)]));
  const now = Date.now();

  // Pass 1: raw BM25 (+ structural boosts) per chunk. `mi` tracks the idf mass of the
  // MATCHED query terms per chunk — the honest basis for confidence: boosts and term
  // frequency are ranking signals, not evidence that the query's information was found.
  let maxBm = 0;
  const bm = new Float64Array(index.chunks.length);
  const matched = new Int16Array(index.chunks.length);
  const mi = new Float64Array(index.chunks.length);
  for (let i = 0; i < index.chunks.length; i++) {
    const c = index.chunks[i];
    let score = 0, m = 0;
    for (const t of uniq) {
      const tf = c.tf.get(t); if (!tf) continue; m++;
      mi[i] += idfs.get(t);
      const denom = tf + K1 * (1 - B + B * (c.len / index.avgLen));
      score += idfs.get(t) * (tf * (K1 + 1)) / denom;
    }
    if (m) {
      const titleLow = c.noteTitle.toLowerCase();
      const headLow = (c.heading || '').toLowerCase();
      if (titleLow.includes(qraw)) score *= 1.6;
      else if (uniq.some((t) => titleLow.includes(t))) score *= 1.25;
      if (headLow && uniq.some((t) => headLow.includes(t))) score *= 1.2;
      if (c.tags.some((tg) => uniq.some((t) => tg.includes(t)))) score *= 1.15;
      score *= 1 + 0.15 * (m / uniq.length);
      const ageDays = (now - c.mtimeMs) / 86400000;
      score *= 1 + 0.08 * Math.max(0, 1 - ageDays / 90);
      const note = index.byRel?.get(c.noteRel);
      score *= 1 + 0.12 * Math.log1p(note?.inbound || 0);
    }
    bm[i] = score; matched[i] = m;
    if (score > maxBm) maxBm = score;
  }

  // Pass 2: final score (blend if semantic available).
  const scored = [];
  for (let i = 0; i < index.chunks.length; i++) {
    const c = index.chunks[i];
    const sem = hybrid ? Math.max(0, semScores[i]) : 0;
    let final;
    if (hybrid) {
      const bmn = maxBm ? bm[i] / maxBm : 0;
      if (matched[i] === 0 && sem < SEM_MIN) continue; // neither lexical nor semantic
      final = (1 - SEM_W) * bmn + SEM_W * sem;
    } else {
      if (matched[i] === 0) continue;
      final = bm[i];
    }
    scored.push({ c, score: final, matched: matched[i], mi: mi[i], sem, note: index.byRel?.get(c.noteRel) });
  }
  scored.sort((a, b) => b.score - a.score);

  const seen = new Map();
  const hits = [];
  let topMi = 0; // matched-idf mass of the top hit — drives lexical confidence
  for (const s of scored) {
    const n = seen.get(s.c.noteRel) || 0;
    if (n >= perNote) continue;
    seen.set(s.c.noteRel, n + 1);
    hits.push({
      id: s.c.id,
      note: s.c.noteRel,
      title: s.c.noteTitle,
      heading: s.c.heading,
      headingPath: s.c.headingPath,
      tags: s.c.tags,
      score: Math.round(s.score * 1000) / 1000,
      sem: hybrid ? Math.round(s.sem * 100) / 100 : undefined,
      coverage: `${s.matched}/${uniq.length || 0}`,
      snippet: snippet(s.c.text, qset),
      mtime: new Date(s.c.mtimeMs).toISOString().slice(0, 10),
      folder: s.note?.folder || '',
      inbound: s.note?.inbound || 0,
      outlinks: (s.note?.outlinks || []).length,
    });
    if (hits.length === 1) topMi = s.mi;
    if (hits.length >= k) break;
  }

  const top = hits[0]?.score || 0;
  const m = 0.4 + 1.2 * Math.max(0, Math.min(1, strictness)); // 0.5 → 1.0 (unchanged)
  let confidence, weak;
  if (hybrid) {
    confidence = Math.round(top * 100) / 100;
    weak = hits.length === 0 || top < 0.24 * m;
  } else {
    // Lexical confidence = the idf-weighted SHARE of the query's information found in
    // the top passage. A query whose distinctive terms exist nowhere in the corpus
    // ("Zenith Corp v. Balfour") can never score high off one common word — absent
    // terms drag confidence down by exactly their information weight. Ranking boosts
    // and term frequency deliberately play no part: they order results, they are not
    // evidence. (The old formula normalized a boosted score against a ceiling the
    // boosts could exceed, clamping to confidence 1.0 at 1-of-5 term coverage.)
    const idfTotal = uniq.reduce((s, t) => s + idfs.get(t), 0) || 1;
    confidence = Math.round(Math.max(0, Math.min(1, topMi / idfTotal)) * 100) / 100;
    // 0.28·m: loose enough that a single morphological miss ("certify" vs "certified" —
    // no stemming) doesn't refuse a fair question, tight enough that a query carried
    // only by its common words still gets refused.
    weak = hits.length === 0 || confidence < 0.28 * m;
  }

  return { hits, confidence, weak, qterms: uniq, mode: hybrid ? 'hybrid' : 'lexical' };
}
