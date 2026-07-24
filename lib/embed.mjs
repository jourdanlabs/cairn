// CAIRN semantic layer — embed every chunk once (cached to disk by content hash),
// so restarts are instant and only new/changed notes get re-embedded. Powers
// hybrid search and contradiction detection. Optional: only runs when a model
// endpoint + embeddings are configured. Vectors never leave the machine on a
// local endpoint.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embed, cosine, modelCfg, embeddingsCacheOnly } from './model.mjs';

// Embed cache lives in the writable state dir when one is set (the packaged Studio app
// bundles the core read-only, so a repo-relative .cache can't be written there) — this is
// what lets a big corpus embed ONCE and come back as hybrid instantly on the next launch.
const CACHE_DIR = process.env.CAIRN_STATE_DIR
  ? join(process.env.CAIRN_STATE_DIR, 'embed-cache')
  : join(dirname(fileURLToPath(import.meta.url)), '..', '.cache');
const BATCH = 64;

const keyFor = (model, text) => createHash('sha1').update(`${model} ${text}`).digest('hex');

async function loadCache(file) {
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { return {}; }
}
async function saveCache(file, obj) {
  try { if (!existsSync(CACHE_DIR)) await mkdir(CACHE_DIR, { recursive: true }); await writeFile(file, JSON.stringify(obj)); } catch { /* cache is best-effort */ }
}

// Embed all chunks; attach `.vec` to each. Returns { embedded, model, cached, fresh }.
export async function embedIndex(index, log = () => {}) {
  const model = modelCfg().embedModel;
  // Keyed on the vault's BASENAME, not its absolute path — a cache baked on the
  // builder's machine must be findable by a box that mounts the same corpus at a
  // different path (entries are content-hashed per chunk, so this is just namespacing).
  const cacheFile = join(CACHE_DIR, `emb-${createHash('sha1').update(basename(index.vaultDir || '') + ':' + model).digest('hex').slice(0, 12)}.json`);
  const cache = await loadCache(cacheFile);

  // What each chunk embeds: its note title + heading + text (retrieval unit).
  const textOf = (c) => `${c.noteTitle} ${c.heading} ${c.text}`.slice(0, 2000);

  const missing = [];
  for (const c of index.chunks) {
    const k = keyFor(model, textOf(c));
    c._ek = k;
    if (cache[k]) c.vec = cache[k];
    else missing.push(c);
  }

  // Cache-only mode (model-free boxes with baked vectors): NEVER fetch. Full cache hit
  // → embedded index, contradictions live. Any miss → stay honestly lexical.
  if (embeddingsCacheOnly()) {
    index.embedded = missing.length === 0 && index.chunks.length > 0;
    index.embedModel = model;
    if (!index.embedded) log(`cache-only: ${missing.length} chunks not in cache — staying lexical`);
    return { embedded: index.embedded, model, cached: index.chunks.length - missing.length, fresh: 0 };
  }

  let fresh = 0;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    log(`embedding ${i + batch.length}/${missing.length}…`);
    let vecs;
    try { vecs = await embed(batch.map(textOf)); }
    catch (e) { throw new Error(`embeddings failed (${e.message}) — check MODEL_EMBED / endpoint`); }
    batch.forEach((c, j) => { c.vec = vecs[j]; cache[c._ek] = vecs[j]; fresh++; });
  }

  if (fresh) await saveCache(cacheFile, cache);
  index.embedded = index.chunks.every((c) => Array.isArray(c.vec) && c.vec.length);
  index.embedModel = model;
  return { embedded: index.embedded, model, cached: index.chunks.length - fresh, fresh };
}

export async function embedQuery(text) {
  const [v] = await embed([text]);
  return v;
}

export function semanticScores(index, queryVec) {
  const out = new Float64Array(index.chunks.length);
  for (let i = 0; i < index.chunks.length; i++) {
    out[i] = index.chunks[i].vec ? cosine(queryVec, index.chunks[i].vec) : 0;
  }
  return out;
}
