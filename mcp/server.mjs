#!/usr/bin/env node
// CAIRN MCP server — expose the knowledge-integrity engine as tools for AI agents
// (Claude Code, Claude Desktop, any MCP client). Zero dependencies: MCP's stdio
// transport is JSON-RPC 2.0, one JSON message per line, and this file speaks it
// with Node built-ins only — the same first-party discipline as the rest of CAIRN.
//
// Architecture: a THIN CLIENT to a running CAIRN server (default localhost:4600).
// The engine owns the one index and the one hash-chained ledger (it is single-
// writer by design); the MCP layer holds no state, so Studio, the browser, curl,
// and every agent session all read and seal against the same brain. If no server
// is up, tools return a clear how-to-start error instead of forking state.
//
//   claude mcp add cairn -- node /path/to/cairn/mcp/server.mjs
//
// Env: CAIRN_URL (default http://127.0.0.1:4600), CAIRN_API_KEY (closed-mode key,
// sent as x-api-key). Logs go to stderr only — stdout is protocol.

import { createInterface } from 'node:readline';

const BASE = (process.env.CAIRN_URL || 'http://127.0.0.1:4600').replace(/\/$/, '');
const KEY = process.env.CAIRN_API_KEY || '';
const VERSION = '1.0.0';
const log = (...a) => console.error('[cairn-mcp]', ...a);

// ── CAIRN HTTP client ───────────────────────────────────────────────────────────
async function api(method, path, body) {
  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(KEY ? { 'x-api-key': KEY } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(180000), // consolidation/adjudication run a local model
    });
  } catch (e) {
    throw new Error(
      `No CAIRN engine reachable at ${BASE} (${e.cause?.code || e.message}). ` +
      `Start one: \`node server.mjs\` in the CAIRN repo (or launch CAIRN Studio), ` +
      `or point CAIRN_URL at a running instance.`,
    );
  }
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 400) }; }
  if (res.status === 401 || res.status === 403) throw new Error(`CAIRN is in closed mode — set CAIRN_API_KEY (got ${res.status}).`);
  if (!res.ok) throw new Error(`CAIRN ${res.status}: ${json.error || text.slice(0, 200)}`);
  return json;
}

const trim = (s, n = 400) => { const t = String(s ?? ''); return t.length > n ? t.slice(0, n) + '…' : t; };
const slimHits = (hits = []) => hits.slice(0, 8).map((h) => ({
  note: h.note, title: h.title, heading: h.heading || undefined,
  score: h.score, sem: h.sem, rr: h.rr, snippet: trim(h.snippet, 300),
}));

// ── tools ───────────────────────────────────────────────────────────────────────
const TOOLS = [
  {
    name: 'cairn_search',
    description: 'Grounded search over the CAIRN corpus (BM25 + semantic when embedded). Returns ranked passages with source notes, a calibrated confidence, and weak=true when nothing matches with enough confidence — treat weak results as "not established by the corpus", never guess past them.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'What to search for' } }, required: ['query'] },
    annotations: { readOnlyHint: true },
    run: async ({ query }) => {
      const r = await api('POST', '/api/search', { q: query });
      return { confidence: r.confidence, weak: r.weak, info_share: r.info_share, mode: r.mode, hits: slimHits(r.hits) };
    },
  },
  {
    name: 'cairn_ask',
    description: 'Ask the corpus a question and get a grounded, cite-or-refuse answer. CAIRN refuses (refused=true, sealed in its receipt ledger) when the corpus cannot substantiate an answer — a refusal is a reliable "the corpus does not establish this", not a failure. Every answer carries source citations and a hash-sealed receipt.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The question' } }, required: ['query'] },
    annotations: { readOnlyHint: true }, // reads knowledge; the receipt append is CAIRN-internal bookkeeping
    run: async ({ query }) => {
      const r = await api('POST', '/api/answer', { q: query });
      return {
        mode: r.mode, refused: Boolean(r.refused), confidence: r.confidence,
        answer: r.answer ? trim(r.answer, 2500) : undefined, reason: r.reason,
        citations: slimHits(r.hits), reranked: r.reranked,
        receipt_ledger_seq: r.ledger?.seq, receipt_entry_hash: r.ledger?.entry_hash,
      };
    },
  },
  {
    name: 'cairn_consolidate',
    description: 'Distill a held-knowledge card for an entity (person, metric, ordinance, MOC, witness…). Every fact must survive mechanical verification — its verbatim quote is checked character-for-character against the cited passage; unverifiable extractions are DROPPED and counted, never kept. Writes the card into the vault (searchable immediately) and seals a receipt in the ledger. `kind` selects profile-specific extraction guidance (e.g. law: witness/issue/matter; data: metric/glossary/source; energy: procedure/moc/equipment).',
    inputSchema: {
      type: 'object',
      properties: {
        entity: { type: 'string', description: 'The entity to consolidate' },
        kind: { type: 'string', description: 'Optional card kind from the active profile' },
      },
      required: ['entity'],
    },
    annotations: { readOnlyHint: false },
    run: async ({ entity, kind }) => {
      const r = await api('POST', '/api/consolidate', { entity, kind });
      if (!r.written) return { written: false, reason: r.reason };
      return {
        written: true, file: r.file, type: r.type,
        name_evidence: r.name_evidence?.fact,
        facts: (r.facts || []).map((f) => ({ fact: f.fact, quote: trim(f.quote, 220), source: f.note })),
        dropped: (r.dropped || []).map((d) => ({ fact: d.fact, reason: d.reason })),
        receipt: r.receipt, ledger_seq: r.ledger?.seq,
      };
    },
  },
  {
    name: 'cairn_cards',
    description: 'List the held-knowledge cards currently in the vault, with entity, type, fact counts (verified and dropped), and each card\'s receipt hash.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => api('GET', '/api/cards'),
  },
  {
    name: 'cairn_integrity',
    description: 'Run the knowledge-integrity report: structural audit (orphans, staleness, duplicates, broken links) plus contradiction detection between documents — contradictions between two CONTROLLED documents score heaviest. Set adjudicate=true to have the local model confirm/dismiss contradiction candidates (slower). Returns a 0–100 score, letter grade, findings, and the report\'s sha256.',
    inputSchema: { type: 'object', properties: { adjudicate: { type: 'boolean', description: 'Model-confirm contradiction candidates (slower, higher signal)' } } },
    annotations: { readOnlyHint: true },
    run: async ({ adjudicate } = {}) => {
      const r = await api('POST', '/api/integrity', { adjudicate: Boolean(adjudicate) });
      const c = r.contradictions || {};
      return {
        ...(r.raw_archive ? { archive_note: r.archive_note, raw_archive: true } : { raw_archive: false }),
        integrity_score: r.integrity_score, grade: r.grade, report_sha256: r.report_sha256,
        findings: r.findings?.map((f) => ({ key: f.key, count: f.count })),
        contradictions: {
          available: c.available, adjudicated: c.adjudicated,
          candidates: c.candidate_count, confirmed: c.confirmed_contradictions,
          top: (c.candidates || []).slice(0, 5).map((p) => ({
            relation: p.relation, both_controlled: p.both_controlled, similarity: p.similarity,
            a: p.a?.note, b: p.b?.note,
          })),
        },
      };
    },
  },
  {
    name: 'cairn_verify_ledger',
    description: 'Recompute and verify the hash-chained receipt ledger. ok=false with broken_at means the sealed record was altered after the fact — every answer, refusal, card, and integrity report CAIRN has issued is checkable here.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => api('GET', '/api/ledger/verify'),
  },
  {
    name: 'cairn_status',
    description: 'Engine status: vault path, note/chunk counts, active edition profile (law/data/civic/energy/bank/personal), effective strictness, search mode (lexical vs hybrid), and ledger length.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
    run: async () => {
      const r = await api('GET', '/api/status');
      return {
        ready: r.ready, vault: r.vault, notes: r.notes, chunks: r.chunks,
        profile: r.profile?.name, profile_label: r.profile?.label, strictness: r.strictness,
        search_mode: r.search_mode, ask_enabled: r.ai, ledger_entries: r.ledger, auth: r.auth,
      };
    },
  },
];
const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

// ── JSON-RPC 2.0 over stdio (newline-delimited) ─────────────────────────────────
const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const replyErr = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

async function handle(msg) {
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null;

  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'cairn', title: 'CAIRN — knowledge integrity', version: VERSION },
    });
  }
  if (method === 'notifications/initialized' || method === 'notifications/cancelled') return; // fire-and-forget
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') {
    return reply(id, {
      tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({ name, description, inputSchema, annotations })),
    });
  }
  if (method === 'tools/call') {
    const tool = toolByName.get(params.name);
    if (!tool) return replyErr(id, -32602, `unknown tool: ${params.name}`);
    try {
      const out = await tool.run(params.arguments || {});
      return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], isError: false });
    } catch (e) {
      // Tool-execution failures are results the model can read, not protocol errors.
      return reply(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
    }
  }
  if (isRequest) return replyErr(id, -32601, `method not found: ${method}`);
}

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try { msg = JSON.parse(t); } catch { return replyErr(null, -32700, 'parse error'); }
  Promise.resolve(handle(msg)).catch((e) => {
    log('handler error:', e.message);
    if (msg.id !== undefined && msg.id !== null) replyErr(msg.id, -32603, `internal error: ${e.message}`);
  });
});
rl.on('close', () => process.exit(0));
log(`ready — engine: ${BASE}${KEY ? ' (keyed)' : ''}`);
