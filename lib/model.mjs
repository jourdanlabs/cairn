// Shared model layer — one place that talks to an OpenAI-compatible endpoint for
// BOTH chat (Ask) and embeddings (semantic search, contradiction detection).
// Works with a local Ollama (http://localhost:11434/v1, no key) or any hosted
// compatible gateway. Local endpoints need no API key.

export function modelCfg() {
  const base = (process.env.MODEL_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const key = process.env.MODEL_API_KEY || '';
  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|:11434/.test(base);
  // Fully-local lock (a user preference): refuse any non-local endpoint outright,
  // so a misconfiguration can't phone home. When set, external models are disabled.
  const localOnly = process.env.MODEL_LOCAL_ONLY === '1';
  const embSetting = (process.env.EMBEDDINGS || '').toLowerCase();
  return {
    base, key, isLocal, localOnly,
    chatModel: process.env.MODEL_NAME || process.env.MODEL_ANSWER || 'gpt-4o-mini',
    embedModel: process.env.MODEL_EMBED || 'nomic-embed-text',
    enabled: (Boolean(key) || isLocal) && (!localOnly || isLocal), // local servers need no key
    // embeddings on if explicitly on, or a local endpoint is set (and not turned off)
    embeddingsOn: embSetting === 'on' || (isLocal && embSetting !== 'off' && Boolean(process.env.MODEL_EMBED || isLocal)),
  };
}

export function modelEnabled() { return modelCfg().enabled; }
// EMBEDDINGS=cache — load vectors from the on-disk embed cache ONLY, no endpoint needed
// or contacted. Lets a model-free demo box ship pre-baked chunk vectors so contradiction
// detection runs live (similarPairs needs chunk vectors, never a query embedding).
export function embeddingsCacheOnly() { return (process.env.EMBEDDINGS || '').toLowerCase() === 'cache'; }
export function embeddingsEnabled() {
  if (embeddingsCacheOnly()) return true;
  const c = modelCfg(); return c.enabled && c.embeddingsOn;
}

async function post(path, body, timeoutMs = 120000) {
  const { base, key } = modelCfg();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key || 'local'}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

export async function chat(messages, model) {
  const j = await post('/chat/completions', { model: model || modelCfg().chatModel, messages, temperature: 0, stream: false });
  const c = j?.choices?.[0]?.message?.content;
  if (typeof c !== 'string') throw new Error('model returned no content');
  return c.trim();
}

// Embed a batch of strings → array of vectors. Falls back to one-at-a-time if the
// endpoint rejects array input (some local servers only take a single string).
export async function embed(texts) {
  const model = modelCfg().embedModel;
  try {
    const j = await post('/embeddings', { model, input: texts });
    const vecs = (j.data || []).map((d) => d.embedding);
    if (vecs.length === texts.length && vecs.every(Array.isArray)) return vecs;
    throw new Error('shape');
  } catch {
    const out = [];
    for (const t of texts) {
      const j = await post('/embeddings', { model, input: t });
      out.push(j.data?.[0]?.embedding || []);
    }
    return out;
  }
}

export function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}
