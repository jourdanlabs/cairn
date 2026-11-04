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

// Every citation number in the text, de-duplicated and sorted. A citation that
// names no context is still a citation — it is reported as dangling, never
// dropped here (that is the receipt's job, not the parser's).
export function parseCitations(text) {
  const out = new Set();
  for (const m of String(text || '').matchAll(CITE_GROUP)) {
    for (const part of m[1].split(',')) {
      const seg = part.trim();
      if (!seg) continue;
      const range = seg.match(new RegExp(`^([0-9]+)\\s*${DASH}\\s*([0-9]+)$`));
      if (range) {
        let lo = Number(range[1]); let hi = Number(range[2]);
        if (lo > hi) { const t = lo; lo = hi; hi = t; }
        for (let i = lo; i <= hi; i++) out.add(i);
        continue;
      }
      for (const piece of seg.split(/\s+/)) {
        if (/^[0-9]+$/.test(piece)) out.add(Number(piece));
      }
    }
  }
  return [...out].sort((a, b) => a - b);
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
        'If the notes do not contain the answer, reply with exactly: "Not in your vault." — nothing more. ' +
        'Do not use outside knowledge. Do not guess. Do not invent citations. Be concise.',
    },
    { role: 'user', content: `NOTES:\n${block}\n\nQUESTION: ${query}` },
  ]);

  const refused = /^not in your vault\.?$/i.test(answer.trim());
  const cited = parseCitations(answer);
  return {
    answer,
    refused,
    grounded: refused || cited.length > 0,
    cited,
    citations: cited.map((n) => contexts.find((c) => c.n === n)).filter(Boolean).map((c) => ({ n: c.n, note: c.note, heading: c.heading })),
    model: modelCfg().chatModel,
  };
}
