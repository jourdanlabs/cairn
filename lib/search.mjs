// CAIRN retrieval — BM25 over heading chunks, boosted by Obsidian structure
// (title / heading / tag hits), with a confidence score so weak matches can be
// refused instead of dressed up. Pure Node, deterministic, offline.

import { tokenize } from './index.mjs';

const K1 = 1.5;
const B = 0.75;

function idf(df, N) {
  return Math.log(1 + (N - df + 0.5) / (df + 0.5));
}

function snippet(text, qterms) {
  const words = text.split(/\s+/);
  const low = words.map((w) => w.toLowerCase().replace(/[^a-z0-9]/g, ''));
  let best = 0, bestHit = -1;
  for (let i = 0; i < words.length; i++) {
    if (qterms.has(low[i])) {
      // small window density
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

export function search(index, query, { k = 8, perNote = 2 } = {}) {
  const qtokens = tokenize(query);
  const qset = new Set(qtokens);
  const qraw = query.toLowerCase();
  if (!qtokens.length) return { hits: [], confidence: 0, weak: true, qterms: [] };

  const uniq = [...qset];
  const idfs = new Map(uniq.map((t) => [t, idf(index.df.get(t) || 0, index.N)]));
  const maxScore = uniq.reduce((s, t) => s + idfs.get(t), 0) * (K1 + 1) / (K1 + 1); // upper reference

  const now = Date.now();
  const scored = [];
  for (const c of index.chunks) {
    let score = 0, matched = 0;
    for (const t of uniq) {
      const tf = c.tf.get(t);
      if (!tf) continue;
      matched++;
      const denom = tf + K1 * (1 - B + B * (c.len / index.avgLen));
      score += idfs.get(t) * (tf * (K1 + 1)) / denom;
    }
    if (!matched) continue;

    // Structural boosts — Obsidian structure is signal.
    const titleLow = c.noteTitle.toLowerCase();
    const headLow = (c.heading || '').toLowerCase();
    if (titleLow.includes(qraw)) score *= 1.6;
    else if (uniq.some((t) => titleLow.includes(t))) score *= 1.25;
    if (headLow && uniq.some((t) => headLow.includes(t))) score *= 1.2;
    if (c.tags.some((tg) => uniq.some((t) => tg.includes(t)))) score *= 1.15;
    score *= 1 + 0.15 * (matched / uniq.length); // coverage bonus
    // mild recency: within ~90 days gets up to +8%
    const ageDays = (now - c.mtimeMs) / 86400000;
    score *= 1 + 0.08 * Math.max(0, 1 - ageDays / 90);
    // link authority: well-connected notes are more central — mild tiebreak boost.
    const note = index.byRel?.get(c.noteRel);
    score *= 1 + 0.12 * Math.log1p(note?.inbound || 0);

    scored.push({ c, score, matched, note });
  }

  scored.sort((a, b) => b.score - a.score);

  // Diversify: cap chunks per note.
  const seen = new Map();
  const hits = [];
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
      coverage: `${s.matched}/${uniq.length}`,
      snippet: snippet(s.c.text, qset),
      mtime: new Date(s.c.mtimeMs).toISOString().slice(0, 10),
      folder: s.note?.folder || '',
      inbound: s.note?.inbound || 0,
      outlinks: (s.note?.outlinks || []).length,
    });
    if (hits.length >= k) break;
  }

  const top = hits[0]?.score || 0;
  const confidence = Math.max(0, Math.min(1, top / (maxScore || 1)));
  // Weak if nothing scored well or query terms were mostly absent from the vault.
  const coverageTop = hits[0] ? Number(hits[0].coverage.split('/')[0]) / uniq.length : 0;
  const weak = hits.length === 0 || (confidence < 0.16 && coverageTop < 0.5);

  return { hits, confidence: Math.round(confidence * 100) / 100, weak, qterms: uniq };
}
