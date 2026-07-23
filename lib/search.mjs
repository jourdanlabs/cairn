// CAIRN retrieval — BM25 over heading chunks, boosted by Obsidian structure
// (title / heading / tag / link-authority), optionally blended with semantic
// similarity (embeddings) so synonyms surface too. A confidence score lets weak
// matches be refused instead of dressed up. Deterministic given the same index.

import { tokenize, stemOf } from './index.mjs';

const K1 = 1.5;
const B = 0.75;
const SEM_W = 0.45; // semantic weight in the hybrid blend
const SEM_MIN = 0.5; // a chunk with no lexical hit still qualifies if sem >= this
// Hybrid weak-gate cosine floor, scaled by strictness. Calibrated on live nomic-embed
// data (2026-07-23): a real-but-paraphrased question landed at sem 0.50 while a
// fabricated-case query landed at 0.60 — cosine ALONE cannot separate those two, and
// the margins at these floors are honestly razor-thin (paraphrase passes default by
// 0.01; fabrication refuses at law by 0.008). Do not mistake this for precision: the
// real walls are the info-share OR-arm and the model's grounded refusal — hybrid mode
// implies a model endpoint exists (the embeddings came from somewhere), so this gate
// is defense-in-depth, never the only wall.
const SEM_GATE = 0.49;

function idf(df, N) { return Math.log(1 + (N - df + 0.5) / (df + 0.5)); }

function snippet(text, qterms) {
  const words = text.split(/\s+/);
  // qterms are stemmed — stem the document words the same way or centering misses.
  const low = words.map((w) => stemOf(w.toLowerCase().replace(/[^a-z0-9]/g, '')));
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
  // Phrase proximity: BM25 is a bag of words — "white rust" scores the same whether the
  // passage says the phrase or scatters the words. Consecutive query-word pairs found
  // verbatim in a passage get a ranking boost (×1.3 each, capped ×1.6). Applied to the
  // top candidates only (contained cost on a 90k-chunk corpus); a below-cutoff chunk
  // with a phrase match stays put — accepted trade. Ranking signal only: confidence and
  // the weak gate never see it (a boost is not evidence).
  scored.sort((a, b) => b.score - a.score);
  // Raw (unstemmed) words for verbatim phrase matching; tokenize() doubles as the
  // stopword test (it returns [] for stopwords) so "of the" never becomes a bigram.
  const qwords = qraw.split(/[^a-z0-9]+/).filter((w) => w.length > 1 && tokenize(w).length > 0);
  const bigrams = [];
  for (let i = 0; i + 1 < qwords.length; i++) bigrams.push(`${qwords[i]} ${qwords[i + 1]}`);
  if (bigrams.length) {
    const CAND = Math.min(scored.length, 150);
    for (let i = 0; i < CAND; i++) {
      const textLow = (scored[i].c.text || '').toLowerCase();
      // A verbatim phrase is title-boost-class evidence (×1.8 > the 1.6 title boost's
      // neighborhood) — strong enough to beat a passage that merely tf-stuffs the
      // individual words. Capped so multi-bigram queries can't run away.
      let boost = 1;
      for (const bg of bigrams) if (textLow.includes(bg)) { boost *= 1.8; if (boost >= 2.5) { boost = 2.5; break; } }
      scored[i].score *= boost;
    }
    scored.sort((a, b) => b.score - a.score);
  }

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
  // Info-share (both modes): the idf-weighted share of the query's information found in
  // the top passage — the honest lexical substantiation signal.
  const idfTotalAll = uniq.reduce((s, t) => s + idfs.get(t), 0) || 1;
  const infoShare = Math.max(0, Math.min(1, topMi / idfTotalAll));
  let confidence, weak;
  if (hybrid) {
    // Displayed confidence is the blended top score DISCOUNTED by substantiation —
    // a raw blend of 0.82 on a fabricated query is arithmetic, not confidence. The
    // discount floor is 0.5 so a genuine pure-synonym match (info-share ≈ 0) still
    // reports half its blended strength rather than zero.
    confidence = Math.min(1, Math.round(top * (0.5 + 0.5 * infoShare) * 100) / 100); // clamp: phrase boost can push the blended top past 1
    // The blend arithmetic makes the old top-score gate unreachable: the top lexical hit
    // always has normalized BM25 = 1.0, so final ≥ (1-SEM_W) = 0.55 > any threshold —
    // hybrid mode could never refuse on its own. Honest gate: a top hit must be EITHER
    // semantically strong (top cosine) OR lexically substantiated (info-share). A hit
    // that is neither is blend arithmetic, not evidence.
    const semTop = hits[0]?.sem ?? 0;
    weak = hits.length === 0 || (semTop < SEM_GATE * Math.min(m, 1.3) && infoShare < 0.28 * m);
  } else {
    // Lexical confidence = the info-share. A query whose distinctive terms exist
    // nowhere in the corpus ("Zenith Corp v. Balfour") can never score high off one
    // common word — absent terms drag confidence down by exactly their information
    // weight. Ranking boosts and term frequency deliberately play no part: they order
    // results, they are not evidence. (The old formula normalized a boosted score
    // against a ceiling the boosts could exceed, clamping to 1.0 at 1/5 coverage.)
    confidence = Math.round(infoShare * 100) / 100;
    // 0.28·m: loose enough that a residual morphological miss doesn't refuse a fair
    // question, tight enough that a query carried only by its common words refuses.
    weak = hits.length === 0 || confidence < 0.28 * m;
  }

  return { hits, confidence, weak, info_share: Math.round(infoShare * 100) / 100, qterms: uniq, mode: hybrid ? 'hybrid' : 'lexical' };
}
