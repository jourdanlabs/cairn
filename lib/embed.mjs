// CAIRN semantic layer — embed every chunk once (vectors persisted by content hash
// as the pass goes), so restarts resume hybrid without re-embedding and only
// new/changed notes get re-embedded. Powers hybrid search and contradiction
// detection. Optional: only runs when a model endpoint + embeddings are
// configured. Vectors never leave the machine on a local endpoint.

import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { appendFileSync, existsSync, renameSync, writeFileSync } from 'node:fs';
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

// ── sharded vector store ──────────────────────────────────────────────────────
// The old store wrote the whole cache as ONE JSON.stringify. Past ~90K chunks
// that string exceeds V8's maximum string length, the write throws, the
// best-effort catch swallowed it, and every restart re-embedded everything.
// New layout per namespace dir `emb-<hash>/`:
//   manifest.json — { model, dim, count, hashes: [<sha1>…] } (small JSON)
//   vectors.f32   — count × dim Float32 values, appended as the pass goes
// No single allocation ever scales with the corpus. A crash between a blob
// append and the manifest write leaves an orphan tail, truncated on load.
// A legacy single-file `emb-<hash>.json` (small corpora) is still read.
async function readStore(nsDir, log) {
  const fail = (m) => { try { log(`embed-cache: ${m}`); } catch {} console.error(`[embed-cache] ${m}`); };
  const manifestPath = join(nsDir, 'manifest.json');
  const blobPath = join(nsDir, 'vectors.f32');
  let manifest = null;
  try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* no manifest yet */ }
  if (manifest && Array.isArray(manifest.hashes) && Number.isInteger(manifest.dim)) {
    let buf;
    try { buf = await readFile(blobPath); }
    catch (e) { fail(`vectors.f32 unreadable (${e.message}) — cache ignored`); return { get: () => undefined, dim: 0 }; }
    const want = manifest.count * manifest.dim * 4;
    if (buf.length < want) { fail(`vectors.f32 short (${buf.length} < ${want}) — cache ignored`); return { get: () => undefined, dim: 0 }; }
    if (buf.length > want) {
      // Orphan tail from a killed pass: truncate the FILE, not just the view,
      // or the next append lands past the orphans and the new vectors are lost.
      try { await writeFile(blobPath, buf.subarray(0, want)); }
      catch (e) { fail(`orphan-tail truncate failed (${e.message})`); }
      buf = buf.subarray(0, want);
    }
    const vecs = new Float32Array(buf.buffer, buf.byteOffset, manifest.count * manifest.dim);
    const idx = new Map(manifest.hashes.map((h, i) => [h, i]));
    return {
      dim: manifest.dim,
      get: (h) => {
        const i = idx.get(h);
        return i === undefined ? undefined : Array.from(vecs.subarray(i * manifest.dim, (i + 1) * manifest.dim));
      },
    };
  }
  return { get: () => undefined, dim: 0 };
}

async function appendStore(nsDir, model, dim, pairs, log) {
  // pairs: [[hash, number[]]] — appended to the blob tails first, then the
  // manifest is rewritten atomically. Best-effort: failures are LOGGED, and the
  // in-memory vectors still stand, so the pass itself always succeeds.
  const fail = (m) => { try { log(`embed-cache: ${m}`); } catch {} console.error(`[embed-cache] ${m}`); };
  try {
    if (!existsSync(nsDir)) await mkdir(nsDir, { recursive: true });
    const manifestPath = join(nsDir, 'manifest.json');
    const blobPath = join(nsDir, 'vectors.f32');
    let manifest = null;
    try { manifest = JSON.parse(await readFile(manifestPath, 'utf8')); } catch { /* fresh */ }
    if (!manifest || manifest.model !== model || manifest.dim !== dim || !Array.isArray(manifest.hashes)) {
      manifest = { model, dim, count: 0, hashes: [] };
    }
    const buf = Buffer.alloc(pairs.length * dim * 4);
    pairs.forEach(([h, v], i) => {
      for (let j = 0; j < dim; j++) buf.writeFloatLE(v[j] || 0, (i * dim + j) * 4);
      manifest.hashes.push(h);
    });
    manifest.count += pairs.length;
    appendFileSync(blobPath, buf);
    const tmp = `${manifestPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(manifest));
    renameSync(tmp, manifestPath);
  } catch (e) { fail(`save failed (${e.message}) — vectors kept in memory only`); }
}

async function loadLegacy(nsDir) {
  // Small-corpus continuity: a pre-shard `emb-<hash>.json` next to (not inside)
  // the namespace dir is still honored. Returns a hash→vector object or {}.
  try { return JSON.parse(await readFile(`${nsDir}.json`, 'utf8')); } catch { return {}; }
}

// Embed all chunks; attach `.vec` to each. Returns { embedded, model, cached, fresh }.
// Vectors persist per namespace (sharded Float32 + manifest) AS THE PASS GOES,
// so a restart resumes hybrid without re-embedding and a crash can't lose more
// than the in-flight batch. Dim is pinned per namespace: a model change starts
// a fresh namespace instead of mixing vector spaces.
export async function embedIndex(index, log = () => {}, shouldAbort = () => false) {
  const model = modelCfg().embedModel;
  // Keyed on the vault's BASENAME, not its absolute path — a cache baked on the
  // builder's machine must be findable by a box that mounts the same corpus at a
  // different path (entries are content-hashed per chunk, so this is just namespacing).
  const ns = `emb-${createHash('sha1').update(basename(index.vaultDir || '') + ':' + model).digest('hex').slice(0, 12)}`;
  const nsDir = join(CACHE_DIR, ns);
  const store = await readStore(nsDir, log);
  const legacy = store.dim ? {} : await loadLegacy(nsDir);

  // What each chunk embeds: its note title + heading + text (retrieval unit).
  const textOf = (c) => `${c.noteTitle} ${c.heading} ${c.text}`.slice(0, 2000);

  let dim = store.dim;
  const missing = [];
  for (const c of index.chunks) {
    const k = keyFor(model, textOf(c));
    c._ek = k;
    const hit = store.get(k) || legacy[k];
    if (hit) {
      c.vec = hit;
      if (!dim) dim = hit.length;
    } else missing.push(c);
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
    // A superseded pass stops between batches instead of embedding a dead
    // index to completion. Vectors already written stay cached by content hash.
    if (shouldAbort()) {
      const cached = index.chunks.reduce((n, c) => n + (Array.isArray(c.vec) && c.vec.length ? 1 : 0), 0);
      return { embedded: false, model, cached, fresh, aborted: true };
    }
    const batch = missing.slice(i, i + BATCH);
    log(`embedding ${i + batch.length}/${missing.length}…`);
    let vecs;
    try { vecs = await embed(batch.map(textOf)); }
    catch (e) { throw new Error(`embeddings failed (${e.message}) — check MODEL_EMBED / endpoint`); }
    if (!dim && vecs.length && vecs[0].length) dim = vecs[0].length;
    const pairs = [];
    batch.forEach((c, j) => { c.vec = vecs[j]; pairs.push([c._ek, vecs[j]]); fresh++; });
    if (dim) await appendStore(nsDir, model, dim, pairs, log);
  }

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
