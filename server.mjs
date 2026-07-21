// CAIRN — zero-dependency Node server (Node 18+). Indexes an Obsidian vault in
// memory and serves grounded search + audit. Everything runs local; the vault
// never leaves the machine. AI answers are off until you set MODEL_API_KEY.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, basename } from 'node:path';

import { buildIndex } from './lib/index.mjs';
import { search } from './lib/search.mjs';
import { audit } from './lib/audit.mjs';
import { groundedAnswer, answerConfigured } from './lib/ground.mjs';

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

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/api/status') {
      return send(res, 200, {
        vault: VAULT_DIR || null,
        vault_name: VAULT_NAME,
        notes: INDEX?.notes.length || 0,
        chunks: INDEX?.N || 0,
        built_at: INDEX?.builtAt || null,
        ai: answerConfigured(),
        ready: Boolean(INDEX),
      });
    }

    if (req.method === 'POST' && req.url === '/api/search') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const { q = '' } = await readBody(req);
      if (!String(q).trim()) return send(res, 400, { error: 'query required' });
      return send(res, 200, { q, ...search(INDEX, q, { k: 10 }) });
    }

    if (req.method === 'POST' && req.url === '/api/answer') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const { q = '' } = await readBody(req);
      if (!String(q).trim()) return send(res, 400, { error: 'query required' });
      const r = search(INDEX, q, { k: 10 });
      // Nothing to ground on → refuse up front, never call the model to fill a gap.
      if (r.weak || !r.hits.length) {
        return send(res, 200, { q, mode: 'refused', refused: true, reason: 'Nothing in your vault matched that with enough confidence.', hits: r.hits, confidence: r.confidence });
      }
      if (!answerConfigured()) {
        return send(res, 200, { q, mode: 'passages', hits: r.hits, confidence: r.confidence, weak: r.weak });
      }
      try {
        const contexts = contextsFrom(r.hits);
        const ans = await groundedAnswer({ q, query: q, contexts });
        return send(res, 200, { q, mode: 'answer', ...ans, hits: r.hits, confidence: r.confidence });
      } catch (e) {
        return send(res, 200, { q, mode: 'passages', hits: r.hits, confidence: r.confidence, answer_error: String(e.message || e) });
      }
    }

    if (req.method === 'POST' && req.url === '/api/audit') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const body = await readBody(req).catch(() => ({}));
      return send(res, 200, audit(INDEX, { staleDays: body.stale_days || 180 }));
    }

    if (req.method === 'POST' && req.url === '/api/reindex') {
      if (!VAULT_DIR) return send(res, 400, { error: 'VAULT_DIR not set' });
      INDEX = await buildIndex(VAULT_DIR);
      return send(res, 200, { ok: true, notes: INDEX.notes.length, chunks: INDEX.N });
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
    INDEX = await buildIndex(VAULT_DIR);
    console.log(`${INDEX.notes.length} notes · ${INDEX.N} chunks`);
  }
  server.listen(PORT, () =>
    console.log(`CAIRN → http://localhost:${PORT}  (AI answers ${answerConfigured() ? 'on' : 'off — grounded search only'})`),
  );
}
start();
