// CAIRN — zero-dependency Node server (Node 18+). Indexes an Obsidian vault in
// memory and serves grounded search + audit. Everything runs local; the vault
// never leaves the machine. AI answers are off until you set MODEL_API_KEY.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync, watch } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, basename } from 'node:path';

import { buildIndex } from './lib/index.mjs';
import { search } from './lib/search.mjs';
import { audit } from './lib/audit.mjs';
import { groundedAnswer } from './lib/ground.mjs';
import { modelEnabled, embeddingsEnabled } from './lib/model.mjs';
import { embedIndex, embedQuery, semanticScores } from './lib/embed.mjs';
import { similarPairs, adjudicatePairs } from './lib/contradict.mjs';
import { integrityReport } from './lib/integrity.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  const p = join(__dir, '.env');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const PUBLIC = join(__dir, 'public');
const PORT = process.env.PORT || 4600;
const VAULT_DIR = process.env.VAULT_DIR ? process.env.VAULT_DIR.replace(/^~/, process.env.HOME || '~') : '';
const VAULT_NAME = process.env.OBSIDIAN_VAULT_NAME || (VAULT_DIR ? basename(VAULT_DIR) : '');
const EXTS = (process.env.INDEX_EXT || '.md,.markdown').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Compliance: top-level folders whose notes are "controlled" (authoritative).
const CONTROLLED_DIRS = (process.env.CONTROLLED_DIRS || '').split(',').map((s) => s.trim()).filter(Boolean);
const WATCH = (process.env.WATCH || 'on').toLowerCase() !== 'off';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };

let INDEX = null;

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
async function serveStatic(req, res) {
  let path = normalize(decodeURIComponent(req.url.split('?')[0]));
  if (path === '/' || path === '') path = '/index.html';
  if (path.includes('..')) return send(res, 400, 'bad path', 'text/plain');
  try {
    return send(res, 200, await readFile(join(PUBLIC, path)), MIME[extname(path)] || 'application/octet-stream');
  } catch { return send(res, 404, 'not found', 'text/plain'); }
}

function contextsFrom(hits, kctx = 6) {
  return hits.slice(0, kctx).map((h, i) => {
    const c = INDEX.chunks[h.id];
    return { n: i + 1, note: h.note, heading: h.heading, text: (c?.text || h.snippet).slice(0, 1200) };
  });
}

// Semantic scores for a query when the index is embedded (enables hybrid search).
async function semFor(q) {
  return INDEX?.embedded ? semanticScores(INDEX, await embedQuery(q)) : null;
}

const sha256 = (o) => createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex');

// The compliance artifact: a hashed record of an answer (or refusal) that ties it
// to the exact sources considered, with a content hash of each cited passage so
// you can prove WHAT the source said at answer time. Refusals are receipted too —
// a record that the system correctly declined rather than guessed.
function answerReceipt({ q, r, ans }) {
  const refused = !ans || ans.refused;
  const citations = (ans?.citations || []).map((c) => {
    const hit = r.hits.find((h) => h.note === c.note && h.heading === c.heading) || r.hits.find((h) => h.note === c.note);
    const text = hit ? INDEX.chunks[hit.id]?.text || '' : '';
    return { note: c.note, heading: c.heading || null, content_sha256: sha256(text), source_mtime: hit?.mtime || null, controlled: Boolean(INDEX?.byRel.get(c.note)?.controlled) };
  });
  // Grounding on a non-controlled (non-authoritative) source is a compliance flag.
  const allControlled = citations.length > 0 && citations.every((c) => c.controlled);
  const receipt = {
    tool: 'cairn',
    kind: 'answer',
    verdict: refused ? 'REFUSED_UNGROUNDED' : 'GROUNDED',
    question: q,
    answer: ans?.answer ?? null,
    model: ans?.model ?? null,
    confidence: r.confidence,
    sources: citations,
    all_sources_controlled: allControlled,
    uncontrolled_source_warning: !refused && citations.some((c) => !c.controlled),
    retrieved_considered: r.hits.slice(0, 8).map((h) => ({ note: h.note, heading: h.heading || null, score: h.score })),
    vault: VAULT_NAME,
    index_built_at: INDEX?.builtAt || null,
    at: new Date().toISOString(),
  };
  return { ...receipt, receipt_sha256: sha256(receipt) };
}

// Debounced auto-reindex when the vault changes (the embedding cache makes only
// new/changed chunks re-embed, so this is cheap).
let reindexTimer = null;
function scheduleReindex() {
  clearTimeout(reindexTimer);
  reindexTimer = setTimeout(async () => {
    try {
      const idx = await buildIndex(VAULT_DIR, { exts: EXTS, controlledDirs: CONTROLLED_DIRS });
      if (embeddingsEnabled()) await embedIndex(idx).catch(() => {});
      INDEX = idx;
      console.log(`↻ reindexed: ${INDEX.notes.length} notes · ${INDEX.N} chunks${INDEX.embedded ? ' (embedded)' : ''}`);
    } catch (e) { console.error('reindex failed:', e.message); }
  }, 1500);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') {
      return send(res, 200, {
        vault: VAULT_DIR || null,
        vault_name: VAULT_NAME,
        notes: INDEX?.notes.length || 0,
        chunks: INDEX?.N || 0,
        built_at: INDEX?.builtAt || null,
        ai: modelEnabled(),
        embedded: Boolean(INDEX?.embedded),
        search_mode: INDEX?.embedded ? 'hybrid (BM25 + semantic)' : 'lexical (BM25)',
        ready: Boolean(INDEX),
      });
    }

    if (req.method === 'POST' && req.url === '/api/search') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const { q = '' } = await readBody(req);
      if (!String(q).trim()) return send(res, 400, { error: 'query required' });
      const sem = await semFor(q);
      return send(res, 200, { q, ...search(INDEX, q, { k: 10, semScores: sem }) });
    }

    if (req.method === 'POST' && req.url === '/api/answer') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const { q = '' } = await readBody(req);
      if (!String(q).trim()) return send(res, 400, { error: 'query required' });
      const sem = await semFor(q);
      const r = search(INDEX, q, { k: 10, semScores: sem });
      // Nothing to ground on → refuse up front, never call the model to fill a gap.
      if (r.weak || !r.hits.length) {
        return send(res, 200, { q, mode: 'refused', refused: true, reason: 'Nothing in your vault matched that with enough confidence.', hits: r.hits, confidence: r.confidence, receipt: answerReceipt({ q, r, ans: null }) });
      }
      if (!modelEnabled()) {
        return send(res, 200, { q, mode: 'passages', hits: r.hits, confidence: r.confidence, weak: r.weak });
      }
      try {
        const contexts = contextsFrom(r.hits);
        const ans = await groundedAnswer({ q, query: q, contexts });
        return send(res, 200, { q, mode: 'answer', ...ans, hits: r.hits, confidence: r.confidence, receipt: answerReceipt({ q, r, ans }) });
      } catch (e) {
        return send(res, 200, { q, mode: 'passages', hits: r.hits, confidence: r.confidence, answer_error: String(e.message || e) });
      }
    }

    if (req.method === 'POST' && req.url === '/api/audit') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const body = await readBody(req).catch(() => ({}));
      return send(res, 200, audit(INDEX, { staleDays: body.stale_days || 180 }));
    }

    if (req.method === 'POST' && req.url === '/api/integrity') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const body = await readBody(req).catch(() => ({}));
      const rep = await integrityReport(INDEX, { vaultName: VAULT_NAME, staleDays: body.stale_days || 180, adjudicate: Boolean(body.adjudicate), adjudicateLimit: body.limit || 8 });
      return send(res, 200, rep);
    }

    if (req.method === 'POST' && req.url === '/api/contradictions') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      if (!INDEX.embedded) return send(res, 200, { available: false, reason: 'Needs embeddings — set a model endpoint + MODEL_EMBED (e.g. local Ollama).', pairs: [] });
      const body = await readBody(req).catch(() => ({}));
      const found = similarPairs(INDEX, { threshold: body.threshold || 0.82, maxPairs: body.max || 20 });
      if (body.adjudicate && modelEnabled()) {
        const adj = await adjudicatePairs(found.pairs, { limit: body.limit || 6 });
        return send(res, 200, { ...found, ...adj });
      }
      return send(res, 200, { ...found, adjudicated: false });
    }

    if (req.method === 'POST' && req.url === '/api/reindex') {
      if (!VAULT_DIR) return send(res, 400, { error: 'VAULT_DIR not set' });
      INDEX = await buildIndex(VAULT_DIR, { exts: EXTS, controlledDirs: CONTROLLED_DIRS });
      if (embeddingsEnabled()) await embedIndex(INDEX).catch(() => {});
      return send(res, 200, { ok: true, notes: INDEX.notes.length, chunks: INDEX.N, embedded: Boolean(INDEX.embedded) });
    }

    if (req.url.startsWith('/api/')) return send(res, 404, { error: 'unknown endpoint' });
    return serveStatic(req, res);
  } catch (e) {
    return send(res, 500, { error: String(e.message || e) });
  }
});

async function start() {
  if (!VAULT_DIR) {
    console.error('\n  VAULT_DIR is not set. Copy .env.example to .env and point VAULT_DIR at your Obsidian vault:\n      VAULT_DIR=/path/to/your/vault\n  Then: node server.mjs\n');
  } else if (!existsSync(VAULT_DIR)) {
    console.error(`\n  VAULT_DIR does not exist: ${VAULT_DIR}\n  Fix it in .env, then re-run.\n`);
  } else {
    process.stdout.write(`Indexing vault: ${VAULT_DIR} … `);
    INDEX = await buildIndex(VAULT_DIR, { exts: EXTS, controlledDirs: CONTROLLED_DIRS });
    console.log(`${INDEX.notes.length} notes · ${INDEX.N} chunks`);
    if (embeddingsEnabled()) {
      process.stdout.write('Embedding (semantic search) … ');
      try {
        const r = await embedIndex(INDEX, (m) => process.stdout.write(`\rEmbedding … ${m}   `));
        console.log(`\rEmbedded ${INDEX.N} chunks (${r.fresh} new, ${r.cached} cached) via ${r.model}        `);
      } catch (e) {
        console.log(`\n  embeddings unavailable (${e.message}) — falling back to lexical search.`);
      }
    }
  }
  server.listen(PORT, () =>
    console.log(`CAIRN → http://localhost:${PORT}  · search: ${INDEX?.embedded ? 'hybrid' : 'lexical'} · Ask: ${modelEnabled() ? 'on' : 'off'}`),
  );

  if (WATCH && VAULT_DIR && existsSync(VAULT_DIR)) {
    try {
      watch(VAULT_DIR, { recursive: true }, (_ev, file) => {
        if (file && EXTS.includes(extname(String(file)).toLowerCase())) scheduleReindex();
      });
      console.log('watching for changes — edits reindex automatically');
    } catch (e) { console.log('file-watch unavailable:', e.message); }
  }
}
start();
