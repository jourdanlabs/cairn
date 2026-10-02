// lib/embed.mjs: vectors persist (Float32 blob + manifest) as the pass goes.
// A second pass over the same corpus makes ZERO endpoint calls; only changed
// chunks re-embed; an orphan blob tail is truncated; a legacy single-file cache
// still reads; save failures are logged but never fail the pass.
// Stub endpoint + throwaway state dir only. Namespaces derive from the vault
// basename, so each case below uses its own vault dir name — no re-imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';

const DIM = 8;
let calls = 0;
let refuse = false;
const vecFor = (text) => Array.from({ length: DIM }, (_, i) => ((text.charCodeAt(i % Math.max(text.length, 1)) || 7) + i * 13) % 97 / 97);
const f32 = (text) => Array.from(Float32Array.from(vecFor(text)));
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    calls++;
    if (refuse) { res.writeHead(500); res.end('nope'); return; }
    const input = JSON.parse(body).input;
    const list = Array.isArray(input) ? input : [input];
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ data: list.map((t) => ({ embedding: vecFor(t) })) }));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
test.after(() => server.close());

const state = mkdtempSync(join(tmpdir(), 'embed-cache-'));
process.env.CAIRN_STATE_DIR = state;
process.env.MODEL_BASE_URL = `http://127.0.0.1:${PORT}/v1`;
process.env.MODEL_API_KEY = 'test';
process.env.MODEL_EMBED = 'test-8d';
process.env.EMBEDDINGS = 'on';
const { embedIndex } = await import('../lib/embed.mjs');

const vault = (name) => join(state, name);
const mkChunks = (n, tag) => Array.from({ length: n }, (_, i) => ({
  noteTitle: `N${i}`, heading: tag, text: `chunk text ${tag} number ${i} with enough words to hash`,
}));
const textOf = (c) => `${c.noteTitle} ${c.heading} ${c.text}`.slice(0, 2000);
const nsDirFor = (vaultDir) => {
  const h = createHash('sha1').update(basename(vaultDir) + ':test-8d').digest('hex').slice(0, 12);
  return join(state, 'embed-cache', `emb-${h}`);
};

test('full pass persists blob + manifest, no whole-cache JSON', async () => {
  const vaultDir = vault('vault-a');
  const chunks = mkChunks(150, 'a');
  const r = await embedIndex({ vaultDir, chunks }, () => {});
  assert.equal(r.embedded, true);
  assert.equal(r.fresh, 150);
  assert.equal(calls, 3); // 64 + 64 + 22
  const nsDir = nsDirFor(vaultDir);
  assert.ok(existsSync(join(nsDir, 'manifest.json')));
  assert.equal(readFileSync(join(nsDir, 'vectors.f32')).length, 150 * DIM * 4);
  const manifest = JSON.parse(readFileSync(join(nsDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.count, 150);
  assert.equal(manifest.dim, DIM);
  assert.ok(!existsSync(`${nsDir}.json`));
});

test('second pass over the same corpus makes zero endpoint calls', async () => {
  calls = 0; refuse = true;
  try {
    const chunks = mkChunks(150, 'a');
    const r = await embedIndex({ vaultDir: vault('vault-a'), chunks }, () => {});
    assert.equal(r.embedded, true);
    assert.equal(r.fresh, 0);
    assert.equal(r.cached, 150);
    assert.equal(calls, 0);
    assert.deepEqual(chunks[0].vec, f32(textOf(chunks[0]))); // Float32 round-trip fidelity
  } finally { refuse = false; }
});

test('only changed chunks re-embed', async () => {
  calls = 0;
  const chunks = mkChunks(150, 'a');
  chunks[3].text = 'brand new text here';
  chunks[140].text = 'another brand new text here';
  const r = await embedIndex({ vaultDir: vault('vault-a'), chunks }, () => {});
  assert.equal(r.fresh, 2);
  assert.equal(calls, 1); // one batch of 2
});

test('orphan blob tail from a killed pass is truncated on disk', async () => {
  calls = 0;
  const nsDir = nsDirFor(vault('vault-a'));
  const before = JSON.parse(readFileSync(join(nsDir, 'manifest.json'), 'utf8')).count;
  appendFileSync(join(nsDir, 'vectors.f32'), Buffer.alloc(DIM * 4 * 5)); // 5 orphan vectors
  const chunks = mkChunks(150, 'a');
  chunks[0].text = 'changed again';
  const r = await embedIndex({ vaultDir: vault('vault-a'), chunks }, () => {});
  assert.equal(r.fresh, 1);
  assert.equal(calls, 1);
  const manifest = JSON.parse(readFileSync(join(nsDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.count, before + 1); // orphans truncated, only the fresh vector appended
  assert.equal(readFileSync(join(nsDir, 'vectors.f32')).length, (before + 1) * DIM * 4);
});

test('legacy single-file cache still reads', async () => {
  calls = 0; refuse = true;
  try {
    const vaultDir = vault('vault-legacy');
    const nsDir = nsDirFor(vaultDir);
    mkdirSync(nsDir, { recursive: true });
    const chunks = mkChunks(10, 'legacy');
    const cache = {};
    for (const c of chunks) {
      const k = createHash('sha1').update(`test-8d ${textOf(c)}`).digest('hex');
      cache[k] = vecFor(textOf(c));
    }
    writeFileSync(`${nsDir}.json`, JSON.stringify(cache));
    const r = await embedIndex({ vaultDir, chunks }, () => {});
    assert.equal(r.embedded, true);
    assert.equal(r.fresh, 0);
    assert.equal(calls, 0);
  } finally { refuse = false; }
});

test('a superseded pass stops before embedding, reporting aborted', async () => {
  calls = 0;
  const chunks = mkChunks(10, 'abort');
  const r = await embedIndex({ vaultDir: vault('vault-abort'), chunks }, () => {}, () => true);
  assert.equal(r.aborted, true);
  assert.equal(r.embedded, false);
  assert.equal(r.fresh, 0);
  assert.equal(calls, 0);
  assert.ok(chunks.every((c) => c.vec === undefined));
});

test('save failures are logged, the pass still succeeds', async () => {
  const logs = [];
  const vaultDir = vault('vault-bad');
  const nsDir = nsDirFor(vaultDir);
  mkdirSync(join(state, 'embed-cache'), { recursive: true });
  writeFileSync(nsDir, 'x'); // a FILE where the namespace dir must go: every write fails
  const chunks = mkChunks(5, 'bad');
  const r = await embedIndex({ vaultDir, chunks }, (m) => logs.push(m));
  assert.equal(r.embedded, true);
  assert.ok(logs.some((m) => m.includes('embed-cache:')), `expected a logged save failure, got ${JSON.stringify(logs)}`);
});
