// CAIRN grounded answer (optional) — synthesize an answer LOCKED to the retrieved
// notes: every claim cites a source [n], and if the notes do not cover it the
// model must say "Not in your vault." Uses the shared model layer (Ollama or any
// OpenAI-compatible endpoint); on a local endpoint nothing leaves the machine.

import { chat, modelEnabled, modelCfg } from './model.mjs';

export function answerConfigured() { return modelEnabled(); }

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
  const usedNs = [...new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))];
  return {
    answer,
    refused,
    grounded: refused || usedNs.length > 0,
    citations: usedNs.map((n) => contexts.find((c) => c.n === n)).filter(Boolean).map((c) => ({ n: c.n, note: c.note, heading: c.heading })),
    model: modelCfg().chatModel,
  };
}
