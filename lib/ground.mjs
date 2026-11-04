// CAIRN grounded answer (optional) — synthesize an answer LOCKED to the retrieved
// notes: every claim cites a source [n], and if the notes do not cover it the
// model must say "Not in your vault." Uses the shared model layer (Ollama or any
// OpenAI-compatible endpoint); on a local endpoint nothing leaves the machine.

import { chat, modelEnabled, modelCfg } from './model.mjs';

export function answerConfigured() { return modelEnabled(); }

// Citation forms real models write, all meaning "these individual notes":
// [1], [1, 4], [1,4], [1][4], [1-3], [1–3] (en dash), [1-3, 7].
// The old parser only matched "[n]", so a grouped citation vanished without a
// trace — four GROUNDED receipts in the real ledger lost sources that way.
// Dashes accepted: hyphen, figure, non-breaking hyphen, en, em, minus.
const DASH = '[-‐‑‒–—−]';
const CITE_GROUP = new RegExp(`\\[([0-9][0-9\\s,]*(?:${DASH}[0-9\\s,]*)?)\\]`, 'g');
const CITE_RANGE = new RegExp(`^([0-9]+)\\s*${DASH}\\s*([0-9]+)$`);

// A citation group that names NO note: a reversed range, or one wider than the
// contexts supplied. It is reported as dangling, so the verdict refuses — and it
// is never expanded. Contexts are numbered from 1, so this marker can never
// collide with a real note.
export const INVALID_CITATION = -1;

// The widest range that may be expanded when no context count is given.
export const MAX_RANGE_SPAN = 64;

// Every citation number in the text, and the groups that name no note.
//
// A range is never expanded wider than the contexts it could name (or
// MAX_RANGE_SPAN when no count is given). A model coaxed by a document in the
// corpus can write "[1-999999999]"; expanding that built millions of numbers
// and then threw RangeError: Set maximum size exceeded — a memory spike the
// model could trigger on a small public box. A wider or reversed range now
// names no note at all, so it dangles and the answer is refused.
export function parseCitationGroups(text, { contextCount = null } = {}) {
  const limit = Number.isInteger(contextCount) && contextCount >= 0 ? contextCount : MAX_RANGE_SPAN;
  const numbers = new Set();
  const invalid = [];
  for (const m of String(text || '').matchAll(CITE_GROUP)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const range = seg.match(CITE_RANGE);
      if (range) {
        const lo = Number(range[1]);
        const hi = Number(range[2]);
        if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
          invalid.push({ text: seg, lo, hi, reason: 'not_a_number' });
          continue;
        }
        if (lo > hi) {
          invalid.push({ text: seg, lo, hi, reason: 'reversed' });
          continue;
        }
        if (hi - lo + 1 > limit) {
          invalid.push({ text: seg, lo, hi, reason: 'too_wide', limit });
          continue;
        }
        for (let i = lo; i <= hi; i++) numbers.add(i);
        continue;
      }
      for (const piece of seg.split(/\s+/)) {
        if (/^[0-9]+$/.test(piece)) numbers.add(Number(piece));
      }
    }
  }
  return { numbers: [...numbers].sort((a, b) => a - b), invalid };
}

// The citation numbers of a text, with one marker for a group that names no
// note. A citation that names no context is still a citation — it is reported
// as dangling, never dropped here (that is the receipt's job, not the
// parser's).
export function citedFromGroups(groups) {
  if (!groups.invalid.length) return groups.numbers;
  return [...groups.numbers, INVALID_CITATION].sort((a, b) => a - b);
}

export function parseCitations(text, opts = {}) {
  return citedFromGroups(parseCitationGroups(text, opts));
}

// Sentences in the answer that carry no citation at all. MEASURED, not
// enforced: the receipt reports the number so an operator can see how much of
// an answer is unbacked. Enforcement is the operator's call, not the parser's.
export function countUncitedSentences(text, opts = {}) {
  const sentences = String(text || '')
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let n = 0;
  for (const s of sentences) if (!parseCitations(s, opts).length) n++;
  return n;
}

// contexts: [{ n, note, heading, text }]
export async function groundedAnswer({ query, contexts }) {
  const block = contexts
    .map((c) => `[${c.n}] ${c.note}${c.heading ? ' › ' + c.heading : ''}\n${c.text}`)
    .join('\n\n');

  const answer = await chat([
    {
      role: 'system',
      content:
        'You answer strictly from the NOTES provided by the user and nothing else. ' +
        'Every factual sentence must end with a citation like [1] or [2] pointing to the note it came from. ' +
        'Cite each source in its own brackets — [1] [2], never [1, 2]. ' +
        'If the notes do not contain the answer, reply with exactly: "Not in your vault." — nothing more. ' +
        'Do not use outside knowledge. Do not guess. Do not invent citations. Be concise.',
    },
    { role: 'user', content: `NOTES:\n${block}\n\nQUESTION: ${query}` },
  ]);

  const refused = /^not in your vault\.?$/i.test(answer.trim());
  // A range may never be wider than the number of contexts the model was given.
  const groups = parseCitationGroups(answer, { contextCount: contexts.length });
  const cited = citedFromGroups(groups);
  // A citation is only evidence if it names a note the model was actually given.
  // valid = the ones that resolve; dangling = the ones that name nothing.
  const byN = new Map(contexts.map((c) => [c.n, c]));
  const valid = cited.filter((n) => byN.has(n));
  const dangling = cited.filter((n) => !byN.has(n));
  // Grounded means: the model made a claim, every citation it made resolves,
  // and it made at least one. A refusal grounds nothing.
  const grounded = !refused && valid.length >= 1 && dangling.length === 0;
  return {
    answer,
    refused,
    grounded,
    cited,
    valid,
    dangling,
    citations: valid.map((n) => { const c = byN.get(n); return { n: c.n, note: c.note, heading: c.heading }; }),
    // The citation groups that name no note — a reversed range, or one wider
    // than the contexts. They dangle, and the receipt names them.
    invalid_citations: groups.invalid,
    uncited_sentences: refused ? 0 : countUncitedSentences(answer, { contextCount: contexts.length }),
    model: modelCfg().chatModel,
  };
}
