// CAIRN reranker — when Ask is on, the model re-scores the retrieved passages for
// answer-bearing-ness BEFORE grounding. Retrieval ranking optimizes term/semantic
// similarity; "actually contains the answer" is a different question, and the grounded
// answer only reads the top few contexts — a passage sitting at rank 7 with the answer
// in it loses to six near-misses. One extra model call at temperature 0 fixes that.
//
// Fail-open by design: any error, timeout, or malformed output returns the original
// order untouched — reranking may only ever improve the contexts, never break Ask.

const clip = (s, n) => (s.length > n ? s.slice(0, n) + '…' : s);

export function rerankPrompt(query, passages) {
  const listed = passages.map((p, i) => `[${i}] ${clip(p.replace(/\s+/g, ' '), 700)}`).join('\n\n');
  return [
    { role: 'system', content: 'You score search passages for whether they contain information that DIRECTLY answers a query. Output STRICT JSON only — no prose, no code fences.' },
    { role: 'user', content: `Query: ${query}\n\nPassages:\n${listed}\n\nScore each passage 0-10 for how directly it answers the query (10 = contains the answer verbatim; 0 = unrelated). Output exactly: {"scores":[<number per passage, in order>]}` },
  ];
}

export function parseScores(raw, n) {
  const text = String(raw).replace(/```json|```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON');
  const j = JSON.parse(text.slice(start, end + 1));
  const scores = Array.isArray(j.scores) ? j.scores.map(Number) : null;
  if (!scores || scores.length !== n || scores.some((s) => !Number.isFinite(s))) throw new Error('bad scores shape');
  return scores.map((s) => Math.max(0, Math.min(10, s)));
}

/**
 * Reorder hits by model-judged answer-bearing-ness (stable: retrieval score breaks ties).
 * @param query      the user's question
 * @param hits       search hits (kept intact; each gains .rr when reranked)
 * @param textOf     hit -> full passage text (falls back to snippet)
 * @param chatFn     messages -> model text (temperature-0 chat)
 */
export async function rerankHits(query, hits, textOf, chatFn) {
  if (!hits || hits.length <= 2) return { hits, reranked: false };
  try {
    const passages = hits.map((h) => String(textOf(h) || h.snippet || ''));
    const scores = parseScores(await chatFn(rerankPrompt(query, passages)), hits.length);
    const order = hits
      .map((h, i) => ({ h: { ...h, rr: scores[i] }, i }))
      .sort((a, b) => (b.h.rr - a.h.rr) || (b.h.score - a.h.score) || (a.i - b.i));
    return { hits: order.map((o) => o.h), reranked: true };
  } catch {
    return { hits, reranked: false }; // fail-open: original retrieval order
  }
}
