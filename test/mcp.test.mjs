// mcp/server.mjs — drive the REAL MCP process over stdio against a fake CAIRN engine.
// The contract under test: correct JSON-RPC handshake, tool listing, tool calls that
// proxy to the engine, tool-level errors as isError results (never protocol errors),
// and a clear how-to-start message when no engine is reachable.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const MCP = join(dirname(fileURLToPath(import.meta.url)), '..', 'mcp', 'server.mjs');

// Minimal fake CAIRN engine.
function fakeEngine() {
  const srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      const send = (o) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(o)); };
      if (req.url === '/api/status') return send({ ready: true, vault: '/v', notes: 3, chunks: 9, profile: { name: 'law', label: 'Matter integrity' }, strictness: 0.7, search_mode: 'lexical (BM25)', ai: false, ledger: 2, auth: 'open' });
      if (req.url === '/api/search') return send({ confidence: 0.9, weak: false, info_share: 0.9, mode: 'lexical', hits: [{ note: 'a.md', title: 'A', score: 1.2, snippet: 'found it' }] });
      if (req.url === '/api/answer') return send({ mode: 'refused', refused: true, reason: 'nothing matched', confidence: 0.1, hits: [], ledger: { seq: 5, entry_hash: 'ff'.repeat(32) } });
      if (req.url === '/api/consolidate') { res.statusCode = 400; return send({ error: 'consolidation needs a model — Ask is off' }); }
      if (req.url === '/api/ledger/verify') return send({ ok: true, count: 2, broken_at: null });
      res.statusCode = 404; send({ error: 'nope' });
    });
  });
  srv.listen(0, '127.0.0.1');
  return srv;
}

// Spawn the MCP server and return a request/response driver.
function spawnMcp(env) {
  const child = spawn(process.execPath, [MCP], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
  let buf = '';
  const pending = new Map();
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      if (!line.trim()) continue;
      const msg = JSON.parse(line);
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg); }
    }
  });
  let nextId = 1;
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout: ${method}`)); } }, 8000);
  });
  const notify = (method) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n');
  return { child, request, notify, kill: () => child.kill() };
}

test('handshake, tool list, and proxied tool calls against a live engine', async () => {
  const engine = fakeEngine();
  await once(engine, 'listening');
  const url = `http://127.0.0.1:${engine.address().port}`;
  const mcp = spawnMcp({ CAIRN_URL: url });
  try {
    const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'cairn');
    mcp.notify('notifications/initialized');

    const list = await mcp.request('tools/list', {});
    const names = list.result.tools.map((t) => t.name);
    for (const n of ['cairn_search', 'cairn_ask', 'cairn_consolidate', 'cairn_cards', 'cairn_integrity', 'cairn_verify_ledger', 'cairn_status']) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }
    assert.ok(list.result.tools.every((t) => t.inputSchema?.type === 'object'), 'every tool carries a JSON schema');

    const st = await mcp.request('tools/call', { name: 'cairn_status', arguments: {} });
    assert.equal(st.result.isError, false);
    const stOut = JSON.parse(st.result.content[0].text);
    assert.equal(stOut.profile, 'law');
    assert.equal(stOut.notes, 3);

    const ask = await mcp.request('tools/call', { name: 'cairn_ask', arguments: { query: 'anything' } });
    const askOut = JSON.parse(ask.result.content[0].text);
    assert.equal(askOut.refused, true);
    assert.equal(askOut.receipt_ledger_seq, 5);

    // engine-side 400 → tool-level isError result, NOT a protocol error
    const con = await mcp.request('tools/call', { name: 'cairn_consolidate', arguments: { entity: 'X' } });
    assert.equal(con.result.isError, true);
    assert.match(con.result.content[0].text, /needs a model/);

    const bad = await mcp.request('tools/call', { name: 'no_such_tool', arguments: {} });
    assert.equal(bad.error.code, -32602);

    const nf = await mcp.request('definitely/not/a/method', {});
    assert.equal(nf.error.code, -32601);
  } finally {
    mcp.kill();
    engine.close();
  }
});

test('no engine running → tools return the how-to-start message, server stays alive', async () => {
  const mcp = spawnMcp({ CAIRN_URL: 'http://127.0.0.1:1' }); // nothing listens on port 1
  try {
    await mcp.request('initialize', { protocolVersion: '2025-06-18' });
    const r = await mcp.request('tools/call', { name: 'cairn_search', arguments: { query: 'x' } });
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /No CAIRN engine reachable/);
    assert.match(r.result.content[0].text, /node server\.mjs/);
    // the process must survive a failed call and keep answering
    const list = await mcp.request('tools/list', {});
    assert.ok(list.result.tools.length >= 7);
  } finally {
    mcp.kill();
  }
});
