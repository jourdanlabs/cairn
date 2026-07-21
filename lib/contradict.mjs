// CAIRN contradiction / overlap detection — the piece almost no vault tool does.
// Two tiers:
//   1. Embeddings find chunk pairs from DIFFERENT notes that are highly similar
//      (same topic) — cheap, deterministic, offline.
//   2. If a model is configured, it adjudicates the top pairs: do they CONTRADICT,
//      DUPLICATE, or merely relate? That turns "these look similar" into a verdict.

import { cosine, chat, modelEnabled } from './model.mjs';

const short = (t, n = 60) => t.split(/\s+/).slice(0, n).join(' ') + (t.split(/\s+/).length > n ? ' …' : '');

export function similarPairs(index, { threshold = 0.82, maxPairs = 25 } = {}) {
  if (!index.embedded) return { available: false, pairs: [], threshold };
  const chunks = index.chunks.filter((c) => Array.isArray(c.vec) && c.vec.length);
  const bestByNotePair = new Map(); // "a|b" -> {i,j,sim}
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      if (chunks[i].noteRel === chunks[j].noteRel) continue;
      const sim = cosine(chunks[i].vec, chunks[j].vec);
      if (sim < threshold) continue;
      const key = [chunks[i].noteRel, chunks[j].noteRel].sort().join('|');
      const prev = bestByNotePair.get(key);
      if (!prev || sim > prev.sim) bestByNotePair.set(key, { a: chunks[i], b: chunks[j], sim });
    }
  }
  const pairs = [...bestByNotePair.values()]
    .sort((x, y) => y.sim - x.sim)
    .slice(0, maxPairs)
    .map((p) => {
      // A contradiction between two CONTROLLED (authoritative) notes is the worst
      // kind — surface that so the report can escalate it.
      const aCtrl = Boolean(index.byRel.get(p.a.noteRel)?.controlled);
      const bCtrl = Boolean(index.byRel.get(p.b.noteRel)?.controlled);
      return {
        similarity: Math.round(p.sim * 1000) / 1000,
        both_controlled: aCtrl && bCtrl,
        a: { note: p.a.noteRel, heading: p.a.heading, snippet: short(p.a.text), text: p.a.text.slice(0, 900), controlled: aCtrl },
        b: { note: p.b.noteRel, heading: p.b.heading, snippet: short(p.b.text), text: p.b.text.slice(0, 900), controlled: bCtrl },
      };
    });
  return { available: true, pairs, threshold };
}

// Ask the model to classify each pair. Bounded to `limit` pairs to keep it fast.
export async function adjudicatePairs(pairs, { limit = 6 } = {}) {
  if (!modelEnabled()) return { adjudicated: false, pairs };
  const out = [];
  for (const p of pairs.slice(0, limit)) {
    try {
      const raw = await chat([
        {
          role: 'system',
          content:
            'You compare two notes from one person\'s knowledge base. Decide their relation and reply with STRICT JSON only: ' +
            '{"relation":"contradict|duplicate|related|unrelated","why":"one short sentence"}. ' +
            '"contradict" = they assert incompatible facts/decisions. "duplicate" = same content, redundant. ' +
            '"related" = same topic, complementary. Be strict about "contradict".',
        },
        { role: 'user', content: `NOTE A (${p.a.note}${p.a.heading ? ' › ' + p.a.heading : ''}):\n${p.a.text}\n\nNOTE B (${p.b.note}${p.b.heading ? ' › ' + p.b.heading : ''}):\n${p.b.text}` },
      ]);
      const m = raw.match(/\{[\s\S]*\}/);
      const v = m ? JSON.parse(m[0]) : { relation: 'related', why: '' };
      out.push({ ...p, relation: v.relation || 'related', why: v.why || '' });
    } catch (e) {
      out.push({ ...p, relation: 'unknown', why: `adjudication failed: ${e.message}` });
    }
  }
  // Any pairs beyond the limit are returned as unadjudicated candidates.
  for (const p of pairs.slice(limit)) out.push({ ...p, relation: 'candidate', why: '' });
  return { adjudicated: true, pairs: out };
}
