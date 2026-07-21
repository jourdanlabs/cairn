// CAIRN grounded answer (optional) — synthesize an answer that is LOCKED to the
// retrieved notes: every claim cites a source [n], and if the notes do not cover
// it, the model must say "Not in your vault." A second model can independently
// check the answer stays grounded. Any OpenAI-compatible endpoint; off unless
// MODEL_API_KEY is set. Nothing is sent anywhere until you configure it.

function cfg() {
  const base = (process.env.MODEL_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const key = process.env.MODEL_API_KEY || '';
  const model = process.env.MODEL_NAME || process.env.MODEL_ANSWER || 'gpt-4o-mini';
  return { base, key, model };
}

export function answerConfigured() {
  return Boolean(process.env.MODEL_API_KEY);
}

async function chat(messages, model) {
  const { base, key } = cfg();
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, temperature: 0 }),
  });
  if (!res.ok) throw new Error(`model endpoint ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  const j = await res.json();
  const c = j?.choices?.[0]?.message?.content;
  if (typeof c !== 'string') throw new Error('model returned no content');
  return c.trim();
}

// contexts: [{ n, note, heading, text }]
export async function groundedAnswer({ query, contexts }) {
  const { model } = cfg();
  const block = contexts
    .map((c) => `[${c.n}] ${c.note}${c.heading ? ' › ' + c.heading : ''}\n${c.text}`)
    .join('\n\n');

  const messages = [
    {
      role: 'system',
      content:
        'You answer strictly from the NOTES provided by the user and nothing else. ' +
        'Every factual sentence must end with a citation like [1] or [2] pointing to the note it came from. ' +
        'If the notes do not contain the answer, reply with exactly: "Not in your vault." — nothing more. ' +
        'Do not use outside knowledge. Do not guess. Do not invent citations. Be concise.',
    },
    { role: 'user', content: `NOTES:\n${block}\n\nQUESTION: ${query}` },
  ];

  const answer = await chat(messages, model);
  const refused = /^not in your vault\.?$/i.test(answer.trim());
  const cited = [...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const usedNs = [...new Set(cited)];
  return {
    answer,
    refused,
    grounded: refused || usedNs.length > 0,
    citations: usedNs
      .map((n) => contexts.find((c) => c.n === n))
      .filter(Boolean)
      .map((c) => ({ n: c.n, note: c.note, heading: c.heading })),
    model,
  };
}
