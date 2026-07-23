// CAIRN — zero-dependency Node server (Node 18+). Indexes an Obsidian vault in
// memory and serves grounded search + audit. Everything runs local; the vault
// never leaves the machine. AI answers are off until you set MODEL_API_KEY.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { readFileSync, existsSync, watch, mkdirSync, writeFileSync, readdirSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { dirname, join, extname, normalize, basename } from 'node:path';

import { buildIndex, indexDocuments } from './lib/index.mjs';
import { search } from './lib/search.mjs';
import { audit } from './lib/audit.mjs';
import { groundedAnswer } from './lib/ground.mjs';
import { modelEnabled, embeddingsEnabled, chat } from './lib/model.mjs';
import { consolidateEntity, slugify } from './lib/consolidate.mjs';
import { getProfile, kindGuidance } from './lib/profiles.mjs';
import { embedIndex, embedQuery, semanticScores } from './lib/embed.mjs';
import { similarPairs, adjudicatePairs } from './lib/contradict.mjs';
import { integrityReport } from './lib/integrity.mjs';
import { makeAuth, permissionFor, auditRecord } from './core/auth.mjs';
import { Ledger } from './core/ledger.mjs';
import { runCycle, startSurveillance, consoleSink, fileSink, webhookSink } from './core/surveillance.mjs';
import { getConnector, listConnectors, collectDocuments } from './connectors/connector.mjs';
import './connectors/filesystem.mjs'; // self-registers "filesystem"
import './connectors/confluence.mjs'; // self-registers "confluence"

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
const HOST = process.env.HOST || '127.0.0.1'; // loopback by default; opt into LAN with HOST=0.0.0.0
const VAULT_DIR = process.env.VAULT_DIR ? process.env.VAULT_DIR.replace(/^~/, process.env.HOME || '~') : '';
const VAULT_NAME = process.env.OBSIDIAN_VAULT_NAME || (VAULT_DIR ? basename(VAULT_DIR) : '');
const EXTS = (process.env.INDEX_EXT || '.md,.markdown').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
// Compliance: top-level folders whose notes are "controlled" (authoritative).
const CONTROLLED_DIRS = (process.env.CONTROLLED_DIRS || '').split(',').map((s) => s.trim()).filter(Boolean);
const WATCH = (process.env.WATCH || 'on').toLowerCase() !== 'off';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.json': 'application/json' };

let INDEX = null;

// Enterprise controls (all no-op in local/open mode): auth/RBAC, a hash-chained
// receipt ledger, and a surveillance state file. Open unless CAIRN_API_KEYS is set.
const AUTH = makeAuth();
const STATE_DIR = process.env.CAIRN_STATE_DIR || join(__dir, '.cairn');
const LEDGER = new Ledger(join(STATE_DIR, 'ledger.jsonl'));
const STATE_PATH = join(STATE_DIR, 'surveillance.json');

// ── user preferences ── a small, persisted settings object the UI edits. Some are
// UI-only (hero art); others change server behavior (strictness gate, staleness,
// fully-local lock) and are applied on load + save.
const PREFS_PATH = join(STATE_DIR, 'preferences.json');
const USER_ART_DIR = join(STATE_DIR, 'art');
const HERO_DIR = join(PUBLIC, 'art', 'heroes');
const PREFS_DEFAULTS = { hero: 'manuscript', theme: 'light', strictness: 0.5, staleDays: 180, searchMode: 'search', localOnly: false, contradictionThreshold: 0.82, extensions: null, surveillanceIntervalMin: 0 };
// Who-did-what access log: every gated request appends a record here (tamper-plain
// JSONL, distinct from the receipt ledger). Powers GET /api/access-log for auditors.
const ACCESS_LOG = join(STATE_DIR, 'access.jsonl');
function logAccess(rec) {
  try { mkdirSync(dirname(ACCESS_LOG), { recursive: true }); appendFileSync(ACCESS_LOG, JSON.stringify(rec) + '\n'); } catch { /* best effort */ }
}
// Every file type CAIRN can index. Markdown/text are read directly; Office/PDF/RTF go
// through the zero-dep extractors. `extensions: null` means "use the env INDEX_EXT default".
const ALLOWED_EXTS = ['.md', '.markdown', '.txt', '.text', '.log', '.csv', '.tsv', '.rtf', '.docx', '.pptx', '.xlsx', '.pdf'];
let PREFS = { ...PREFS_DEFAULTS };
const effExts = () => (Array.isArray(PREFS.extensions) && PREFS.extensions.length) ? PREFS.extensions : EXTS;
// Edition: env wins, then preference, then personal. A profile changes vocabulary,
// default strictness, and card kinds — never the engine.
const profile = () => getProfile(process.env.CAIRN_PROFILE || PREFS.profile || 'personal');
// Strictness: an operator's non-default choice wins; otherwise the profile default;
// otherwise the calibrated 0.5. (A law matter file answers conservatively out of the box.)
const effStrictness = () => (PREFS.strictness !== PREFS_DEFAULTS.strictness ? PREFS.strictness : (profile().prefs.strictness ?? PREFS.strictness));
function applyPrefs() {
  if (PREFS.localOnly) process.env.MODEL_LOCAL_ONLY = '1'; else delete process.env.MODEL_LOCAL_ONLY;
}
function loadPrefs() {
  try { PREFS = { ...PREFS_DEFAULTS, ...JSON.parse(readFileSync(PREFS_PATH, 'utf8')) }; } catch { PREFS = { ...PREFS_DEFAULTS }; }
  applyPrefs();
}
function savePrefs() {
  try { mkdirSync(dirname(PREFS_PATH), { recursive: true }); writeFileSync(PREFS_PATH, JSON.stringify(PREFS, null, 2)); } catch { /* best effort */ }
}
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif']);
const titleize = (id) => id.replace(/[-_]/g, ' ').replace(/\.[a-z]+$/i, '').replace(/\b\w/g, (c) => c.toUpperCase());
function listHeroes() {
  const out = [];
  try { for (const f of readdirSync(HERO_DIR)) { if (f.includes('.thumb.') || !IMG_EXT.has(extname(f).toLowerCase())) continue; const id = f.replace(extname(f), ''); const thumb = `${id}.thumb.jpg`; out.push({ id, label: titleize(id), url: `/art/heroes/${f}`, thumb: existsSync(join(HERO_DIR, thumb)) ? `/art/heroes/${thumb}` : `/art/heroes/${f}`, custom: false }); } } catch { /* none */ }
  try { for (const f of readdirSync(USER_ART_DIR)) { if (!IMG_EXT.has(extname(f).toLowerCase())) continue; out.push({ id: `user:${f}`, label: titleize(f), url: `/user-art/${f}`, thumb: `/user-art/${f}`, custom: true }); } } catch { /* none */ }
  return out;
}
loadPrefs();
const surveillanceSinks = [consoleSink, fileSink(join(STATE_DIR, 'alerts.jsonl'))];
if (process.env.CAIRN_ALERT_WEBHOOK) surveillanceSinks.push(webhookSink(process.env.CAIRN_ALERT_WEBHOOK));

// Connector configs come from env (secrets never travel in request bodies). The
// filesystem connector points at the same vault; Confluence needs a tenant + token.
function connectorConfig(name) {
  const e = process.env;
  if (name === "filesystem") return { dir: VAULT_DIR, exts: effExts(), controlledDirs: CONTROLLED_DIRS };
  if (name === 'confluence') return {
    baseUrl: e.CONFLUENCE_BASE_URL, email: e.CONFLUENCE_EMAIL, token: e.CONFLUENCE_TOKEN,
    spaceKeys: (e.CONFLUENCE_SPACES || '').split(',').map((s) => s.trim()).filter(Boolean),
    controlledLabels: (e.CONFLUENCE_CONTROLLED_LABELS || '').split(',').map((s) => s.trim()).filter(Boolean).length
      ? (e.CONFLUENCE_CONTROLLED_LABELS).split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };
  return {};
}

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// Read Obsidian's own vault registry so onboarding can offer the user their existing
// vaults with one click. Read-only, best-effort; returns existing dirs, newest first.
function obsidianConfigPath() {
  const home = homedir();
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  if (process.platform === 'win32') return join(process.env.APPDATA || join(home, 'AppData', 'Roaming'), 'obsidian', 'obsidian.json');
  return join(home, '.config', 'obsidian', 'obsidian.json');
}
function readObsidianVaults() {
  try {
    const p = obsidianConfigPath();
    if (!existsSync(p)) return [];
    const j = JSON.parse(readFileSync(p, 'utf8'));
    return Object.values(j.vaults || {})
      .filter((v) => v && v.path && existsSync(v.path))
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .map((v) => ({ path: v.path, name: basename(v.path) }));
  } catch { return []; }
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
      const idx = await buildIndex(VAULT_DIR, { exts: effExts(), controlledDirs: CONTROLLED_DIRS });
      // Swap FIRST so edits are searchable (lexically) at once; embed behind. Waiting on
      // the embed to swap makes every vault edit invisible for the length of the pass.
      INDEX = idx;
      console.log(`↻ reindexed: ${INDEX.notes.length} notes · ${INDEX.N} chunks`);
      if (embeddingsEnabled()) embedIndex(idx).then(() => { if (INDEX === idx) console.log('↻ embeddings caught up — hybrid live'); }).catch(() => {});
    } catch (e) { console.error('reindex failed:', e.message); }
  }, 1500);
}

const server = createServer(async (req, res) => {
  try {
    // AuthZ gate — every known API route needs a permission; open mode passes all.
    const reqPath = req.url.split('?')[0];
    const perm = permissionFor(req.method, reqPath);
    if (perm) {
      const g = await AUTH.gate(req, perm);
      logAccess(auditRecord({ principal: g.principal, method: req.method, path: reqPath, permission: perm, allowed: g.ok, status: g.status }));
      if (!g.ok) return send(res, g.status, { error: g.reason });
    }

    // Ungated liveness probe (load balancers / k8s) — no sensitive detail leaks.
    if (req.method === 'GET' && reqPath === '/api/health') {
      return send(res, 200, { ok: true, ready: Boolean(INDEX) });
    }

    // Onboarding: auto-detect the user's Obsidian vaults (read Obsidian's own vault
    // list). Read-only; used by the desktop app's "connect your Obsidian" tour.
    if (req.method === 'GET' && reqPath === '/api/obsidian-vaults') {
      return send(res, 200, { vaults: readObsidianVaults(), current: VAULT_DIR || null });
    }

    // ── preferences ── the UI's settings; GET reads, POST merges + applies.
    if (req.method === 'GET' && reqPath === '/api/preferences') {
      return send(res, 200, { preferences: PREFS, allowed_extensions: ALLOWED_EXTS, effective_extensions: effExts() });
    }
    if (req.method === 'POST' && reqPath === '/api/preferences') {
      const body = await readBody(req).catch(() => ({}));
      const p = body.preferences || body || {};
      if (typeof p.hero === 'string') PREFS.hero = p.hero.slice(0, 200);
      if (p.theme === 'light' || p.theme === 'dark') PREFS.theme = p.theme;
      if (Number.isFinite(p.surveillanceIntervalMin)) PREFS.surveillanceIntervalMin = Math.max(0, Math.min(10080, Math.round(p.surveillanceIntervalMin)));
      if (Number.isFinite(p.strictness)) PREFS.strictness = Math.max(0, Math.min(1, p.strictness));
      if (Number.isFinite(p.staleDays)) PREFS.staleDays = Math.max(1, Math.min(3650, Math.round(p.staleDays)));
      if (p.searchMode === 'search' || p.searchMode === 'ask') PREFS.searchMode = p.searchMode;
      if (typeof p.profile === 'string' && getProfile(p.profile).name === p.profile.toLowerCase()) PREFS.profile = p.profile.toLowerCase();
      if (typeof p.localOnly === 'boolean') PREFS.localOnly = p.localOnly;
      if (Number.isFinite(p.contradictionThreshold)) PREFS.contradictionThreshold = Math.max(0.5, Math.min(0.99, p.contradictionThreshold));
      if (Array.isArray(p.extensions)) { const v = p.extensions.map((e) => String(e).toLowerCase()).filter((e) => ALLOWED_EXTS.includes(e)); PREFS.extensions = v.length ? v : null; }
      applyPrefs(); savePrefs();
      return send(res, 200, { ok: true, preferences: PREFS });
    }

    // ── hero art ── list bundled + user-uploaded masthead images, and accept uploads.
    if (req.method === 'GET' && reqPath === '/api/art') {
      return send(res, 200, { art: listHeroes(), selected: PREFS.hero });
    }
    if (req.method === 'POST' && reqPath === '/api/art/upload') {
      const qname = new URL(req.url, 'http://localhost').searchParams.get('name') || '';
      const ext = extname(qname).toLowerCase();
      if (!IMG_EXT.has(ext)) return send(res, 400, { error: 'unsupported image type (jpg, png, webp, avif, gif)' });
      const safe = basename(qname).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
      let total = 0; const chunks = [];
      for await (const c of req) { total += c.length; if (total > 15 * 1024 * 1024) return send(res, 413, { error: 'image too large (max 15MB)' }); chunks.push(c); }
      const buf = Buffer.concat(chunks);
      if (!buf.length) return send(res, 400, { error: 'empty upload' });
      mkdirSync(USER_ART_DIR, { recursive: true });
      const finalName = existsSync(join(USER_ART_DIR, safe)) ? `${Date.now()}-${safe}` : safe;
      writeFileSync(join(USER_ART_DIR, finalName), buf);
      return send(res, 200, { ok: true, art: { id: `user:${finalName}`, label: titleize(finalName), url: `/user-art/${finalName}`, thumb: `/user-art/${finalName}`, custom: true } });
    }
    if (reqPath.startsWith('/user-art/')) {
      const full = normalize(join(USER_ART_DIR, decodeURIComponent(reqPath.slice('/user-art/'.length))));
      if (!full.startsWith(USER_ART_DIR) || !existsSync(full)) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, await readFile(full), MIME[extname(full).toLowerCase()] || 'application/octet-stream');
    }

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
        auth: AUTH.open ? 'open' : 'closed',
        ledger: LEDGER.count(),
        profile: { name: profile().name, label: profile().label, terms: profile().terms, kinds: Object.keys(profile().cardKinds || {}) },
        strictness: effStrictness(),
      });
    }

    if (req.method === 'POST' && req.url === '/api/search') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const { q = '' } = await readBody(req);
      if (!String(q).trim()) return send(res, 400, { error: 'query required' });
      const sem = await semFor(q);
      return send(res, 200, { q, ...search(INDEX, q, { k: 10, semScores: sem, strictness: effStrictness() }) });
    }

    if (req.method === 'POST' && req.url === '/api/answer') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const { q = '' } = await readBody(req);
      if (!String(q).trim()) return send(res, 400, { error: 'query required' });
      const sem = await semFor(q);
      const r = search(INDEX, q, { k: 10, semScores: sem, strictness: effStrictness() });
      // Nothing to ground on → refuse up front, never call the model to fill a gap.
      if (r.weak || !r.hits.length) {
        const receipt = answerReceipt({ q, r, ans: null });
        const led = LEDGER.append('answer_receipt', receipt);
        return send(res, 200, { q, mode: 'refused', refused: true, reason: 'Nothing in your vault matched that with enough confidence.', hits: r.hits, confidence: r.confidence, receipt, ledger: { seq: led.seq, entry_hash: led.entry_hash } });
      }
      if (!modelEnabled()) {
        return send(res, 200, { q, mode: 'passages', hits: r.hits, confidence: r.confidence, weak: r.weak });
      }
      try {
        const contexts = contextsFrom(r.hits);
        const ans = await groundedAnswer({ q, query: q, contexts });
        const receipt = answerReceipt({ q, r, ans });
        const led = LEDGER.append('answer_receipt', receipt);
        return send(res, 200, { q, mode: 'answer', ...ans, hits: r.hits, confidence: r.confidence, receipt, ledger: { seq: led.seq, entry_hash: led.entry_hash } });
      } catch (e) {
        return send(res, 200, { q, mode: 'passages', hits: r.hits, confidence: r.confidence, answer_error: String(e.message || e) });
      }
    }

    // Consolidation: distill what the corpus says about an entity into a held-knowledge
    // card — model-extracted facts that survive MECHANICAL quote verification, written
    // into the vault (so search indexes them like any note) and receipt-sealed in the
    // ledger. The gather step is lexical + collocation (deterministic); the extraction
    // runs at temperature 0; unverifiable facts are dropped and counted, never kept.
    if (req.method === 'POST' && req.url === '/api/consolidate') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      if (!modelEnabled()) return send(res, 400, { error: 'consolidation needs a model — Ask is off' });
      const { entity = '', kind = '' } = await readBody(req);
      const name = String(entity).trim();
      if (!name) return send(res, 400, { error: 'entity required' });
      try {
        const r = await consolidateEntity(INDEX, name, {
          chatFn: chat,
          searchFn: (q, o) => search(INDEX, q, { ...o, strictness: effStrictness() }),
          kind: String(kind).trim() || null,
          guidance: kindGuidance(profile(), kind), // profile card-kind angle (witness/issue/matter…)
        });
        if (!r.markdown) return send(res, 200, { entity: name, written: false, reason: 'no passages mention this entity', facts: [], dropped: [] });
        const dir = join(VAULT_DIR, 'cards');
        mkdirSync(dir, { recursive: true });
        const file = join(dir, `${slugify(name)}.md`);
        writeFileSync(file, r.markdown);
        const led = LEDGER.append('card_receipt', {
          entity: name, type: r.type, receipt: r.receipt,
          facts_verified: r.verified.length, facts_dropped: r.dropped.length,
          sources: r.passages.length, at: r.generatedAt,
        });
        return send(res, 200, {
          entity: name, written: true, file: `cards/${slugify(name)}.md`, type: r.type,
          name_evidence: r.nameFact || null,
          facts: r.verified, dropped: r.dropped.map((d) => ({ fact: d.fact, reason: d.reason })),
          sources: r.passages.map((p) => ({ note: p.note, why: p.why })),
          receipt: r.receipt, ledger: { seq: led.seq, entry_hash: led.entry_hash },
        });
      } catch (e) {
        return send(res, 500, { error: `consolidation failed: ${String(e.message || e)}` });
      }
    }

    // The held-knowledge shelf: every card currently in the vault, with its receipt.
    if (req.method === 'GET' && reqPath === '/api/cards') {
      const dir = join(VAULT_DIR, 'cards');
      let files = [];
      try { files = readdirSync(dir).filter((f) => f.endsWith('.md')); } catch { /* no cards yet */ }
      const cards = files.map((f) => {
        try {
          const txt = readFileSync(join(dir, f), 'utf8');
          const grab = (k) => (txt.match(new RegExp(`^${k}: (.*)$`, 'm')) || [])[1] || '';
          return { file: `cards/${f}`, entity: JSON.parse(grab('entity') || '""') || f.replace(/\.md$/, ''), type: grab('type'), generated: grab('generated'), facts_verified: Number(grab('facts_verified') || 0), facts_dropped: Number(grab('facts_dropped') || 0), receipt: grab('receipt') };
        } catch { return { file: `cards/${f}` }; }
      });
      return send(res, 200, { count: cards.length, cards });
    }

    if (req.method === 'POST' && req.url === '/api/audit') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const body = await readBody(req).catch(() => ({}));
      return send(res, 200, audit(INDEX, { staleDays: body.stale_days || PREFS.staleDays }));
    }

    if (req.method === 'POST' && req.url === '/api/integrity') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const body = await readBody(req).catch(() => ({}));
      const rep = await integrityReport(INDEX, { vaultName: VAULT_NAME, staleDays: body.stale_days || PREFS.staleDays, adjudicate: Boolean(body.adjudicate), adjudicateLimit: body.limit || 8 });
      // Stamp a compact report receipt into the ledger (the audit record).
      const led = LEDGER.append('integrity_report', {
        score: rep.integrity_score, grade: rep.grade, report_sha256: rep.report_sha256,
        controlled_coverage: rep.controlled_coverage,
        counts: Object.fromEntries((rep.findings || []).map((f) => [f.key, f.count])),
        confirmed_contradictions: rep.contradictions?.confirmed_contradictions ?? null,
        generated_at: rep.generated_at, vault: rep.vault,
      });
      return send(res, 200, { ...rep, ledger: { seq: led.seq, entry_hash: led.entry_hash } });
    }

    if (req.method === 'POST' && req.url === '/api/contradictions') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      if (!INDEX.embedded) return send(res, 200, { available: false, reason: 'Needs embeddings — set a model endpoint + MODEL_EMBED (e.g. local Ollama).', pairs: [] });
      const body = await readBody(req).catch(() => ({}));
      const found = similarPairs(INDEX, { threshold: body.threshold || PREFS.contradictionThreshold, maxPairs: body.max || 20 });
      if (body.adjudicate && modelEnabled()) {
        const adj = await adjudicatePairs(found.pairs, { limit: body.limit || 6 });
        return send(res, 200, { ...found, ...adj });
      }
      return send(res, 200, { ...found, adjudicated: false });
    }

    if (req.method === 'POST' && req.url === '/api/surveillance') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const body = await readBody(req).catch(() => ({}));
      const result = await runCycle({
        reportFn: () => integrityReport(INDEX, { vaultName: VAULT_NAME, adjudicate: Boolean(body.adjudicate), adjudicateLimit: body.limit || 8 }),
        statePath: STATE_PATH, sinks: surveillanceSinks, source: VAULT_NAME || 'corpus',
      });
      LEDGER.append('surveillance_cycle', {
        score: result.report_score, grade: result.report_grade, alerts: result.events.length,
        new_contradictions: result.diff.new_confirmed_contradictions, score_delta: result.diff.score_delta,
        at: new Date().toISOString(),
      });
      return send(res, 200, result);
    }

    if (req.method === 'GET' && reqPath === '/api/ledger/verify') {
      return send(res, 200, { ...LEDGER.verify(), path: '.cairn/ledger.jsonl' });
    }

    // Access log: the who-did-what request trail (most recent first).
    if (req.method === 'GET' && reqPath === '/api/access-log') {
      let lines = [];
      try { lines = readFileSync(ACCESS_LOG, 'utf8').trim().split('\n').filter(Boolean); } catch { /* none yet */ }
      const records = lines.slice(-500).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean).reverse();
      return send(res, 200, { count: lines.length, records });
    }

    // Compliance evidence bundle: current integrity posture + the full sealed
    // receipt chain + its verification. This is the artifact an auditor asks for.
    if (req.method === 'GET' && reqPath === '/api/compliance/export') {
      if (!INDEX) return send(res, 503, { error: 'index not ready' });
      const rep = await integrityReport(INDEX, { vaultName: VAULT_NAME, staleDays: PREFS.staleDays });
      const bundle = {
        generated_at: new Date().toISOString(),
        product: 'CAIRN', vault: rep.vault,
        integrity: {
          score: rep.integrity_score, grade: rep.grade,
          report_sha256: rep.report_sha256, controlled_coverage: rep.controlled_coverage,
          findings: (rep.findings || []).map((f) => ({ key: f.key, count: f.count })),
        },
        ledger: { verification: LEDGER.verify(), entries: LEDGER.all() },
        attestation: 'Every answer and integrity report is a hash-sealed ledger entry; '
          + 'verification recomputes the chain, so any post-hoc edit is detectable.',
      };
      res.setHeader('Content-Disposition', `attachment; filename="cairn-compliance-${Date.now()}.json"`);
      return send(res, 200, bundle);
    }

    // Connectors: list registered sources + their live health (configured?/reachable?).
    if (req.method === 'GET' && reqPath === '/api/connectors') {
      const out = [];
      for (const name of listConnectors()) {
        let health;
        try { health = await getConnector(name, connectorConfig(name)).healthcheck(); }
        catch (e) { health = { ok: false, detail: String(e.message || e) }; }
        out.push({ name, health });
      }
      return send(res, 200, { connectors: out });
    }

    // Ingest from a connector, replacing the in-memory index with its Documents.
    // Filesystem works offline; Confluence needs env creds (see /api/connectors).
    if (req.method === 'POST' && reqPath === '/api/connectors/ingest') {
      const body = await readBody(req).catch(() => ({}));
      const name = String(body.name || '');
      if (!listConnectors().includes(name)) return send(res, 400, { error: `unknown connector: ${name}`, available: listConnectors() });
      let docs;
      try {
        const conn = getConnector(name, connectorConfig(name));
        const health = await conn.healthcheck();
        if (!health.ok) return send(res, 400, { error: `connector not ready: ${health.detail}` });
        docs = await collectDocuments(conn);
      } catch (e) { return send(res, 502, { error: `ingest failed: ${String(e.message || e)}` }); }
      INDEX = indexDocuments(docs);
      if (embeddingsEnabled()) await embedIndex(INDEX).catch(() => {});
      const led = LEDGER.append('connector_ingest', {
        connector: name, documents: docs.length, notes: INDEX.notes.length, chunks: INDEX.N,
        controlled: INDEX.notes.filter((n) => n.controlled).length, at: new Date().toISOString(),
      });
      return send(res, 200, {
        ok: true, connector: name, documents: docs.length,
        notes: INDEX.notes.length, chunks: INDEX.N, embedded: Boolean(INDEX.embedded),
        ledger: { seq: led.seq, entry_hash: led.entry_hash },
      });
    }

    if (req.method === 'POST' && req.url === '/api/reindex') {
      if (!VAULT_DIR) return send(res, 400, { error: 'VAULT_DIR not set' });
      INDEX = await buildIndex(VAULT_DIR, { exts: effExts(), controlledDirs: CONTROLLED_DIRS });
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
    INDEX = await buildIndex(VAULT_DIR, { exts: effExts(), controlledDirs: CONTROLLED_DIRS });
    console.log(`${INDEX.notes.length} notes · ${INDEX.N} chunks`);
  }
  // Bind loopback by DEFAULT so an open-mode instance is not exposed to the whole
  // network. Set HOST=0.0.0.0 to serve the LAN (do that only with CAIRN_API_KEYS set).
  // We listen the moment the lexical (BM25) index is ready, BEFORE embedding, so a large
  // corpus (a whole second brain) is searchable in seconds; semantic/hybrid lights up when
  // the background embed pass below finishes.
  server.listen(PORT, HOST, () =>
    console.log(`CAIRN → http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  · bind: ${HOST}${HOST === '0.0.0.0' && AUTH.open ? ' ⚠ open-mode on all interfaces — set CAIRN_API_KEYS' : ''} · search: ${INDEX?.embedded ? 'hybrid' : 'lexical'}${INDEX && !INDEX.embedded && embeddingsEnabled() ? ' (embedding in background…)' : ''} · Ask: ${modelEnabled() ? 'on' : 'off'}`),
  );

  // Embeddings build in the BACKGROUND (non-blocking) so the server never makes the
  // operator wait on a long embed pass to search. The disk cache means only new/changed
  // chunks re-embed, so restarts are cheap. When this resolves, INDEX.embedded flips true
  // and search silently upgrades from lexical to hybrid.
  if (INDEX && embeddingsEnabled()) {
    (async () => {
      try {
        const r = await embedIndex(INDEX, (m) => process.stdout.write(`\rEmbedding … ${m}   `));
        console.log(`\r✓ embedded ${INDEX.N} chunks (${r.fresh} new, ${r.cached} cached) via ${r.model} — hybrid search live        `);
      } catch (e) {
        console.log(`\n  embeddings unavailable (${e.message}) — staying on lexical search.`);
      }
    })();
  }

  if (WATCH && VAULT_DIR && existsSync(VAULT_DIR)) {
    try {
      watch(VAULT_DIR, { recursive: true }, (_ev, file) => {
        if (file && EXTS.includes(extname(String(file)).toLowerCase())) scheduleReindex();
      });
      console.log('watching for changes — edits reindex automatically');
    } catch (e) { console.log('file-watch unavailable:', e.message); }
  }

  // Surveillance scheduler: when an interval is configured (pref or env, in minutes),
  // run the integrity/contradiction cycle in the background and alert on NEW defects.
  const survMin = PREFS.surveillanceIntervalMin || Number(process.env.CAIRN_SURVEILLANCE_INTERVAL_MIN || 0);
  if (survMin > 0 && VAULT_DIR) {
    startSurveillance({
      intervalMs: survMin * 60_000,
      reportFn: () => integrityReport(INDEX, { vaultName: VAULT_NAME, staleDays: PREFS.staleDays }),
      statePath: STATE_PATH, sinks: surveillanceSinks, source: VAULT_NAME || 'corpus',
    });
    console.log(`surveillance: background cycle every ${survMin} min`);
  }
}
start();
