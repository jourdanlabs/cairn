// R1 + R2: the verdict comes from VALIDATED citations.
//
// CAIRN promises "a cited answer with a sealed receipt, or a refusal". The
// receipt used to trust the model: anything that wasn't a refusal was sealed
// GROUNDED, and a citation that named no note vanished without a trace.
//
//   - GROUNDED            → at least one citation resolves AND none dangles
//   - REFUSED_UNGROUNDED  → the model refused
//   - REFUSED_CITATION_CHECK → the model answered, its citations didn't check out
//
// Red-first: the implementation is not in place yet, so this file fails on
// assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import * as ground from '../lib/ground.mjs';
import { bootServer, rmVault } from './helpers.mjs';

const CONTEXTS = [
  { n: 1, note: 'a.md', heading: '', text: 'Wells must be plugged within one year.' },
  { n: 2, note: 'b.md', heading: '', text: 'Pits must be lined with an approved liner.' },
];

async function mockModel(reply) {
  const srv = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
    });
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  return { srv, base: `http://127.0.0.1:${srv.address().port}/v1` };
}

async function askWith(reply, query = 'plugging deadline?') {
  const { srv, base } = await mockModel(reply);
  process.env.MODEL_BASE_URL = base;
  delete process.env.MODEL_API_KEY;
  try {
    return await ground.groundedAnswer({ query, contexts: CONTEXTS });
  } finally {
    srv.close();
    delete process.env.MODEL_BASE_URL;
  }
}

test('a citation that names no note is dangling, and dangles the answer', async () => {
  const out = await askWith('Wells must be plugged within 30 days [7].');
  assert.deepEqual(out.cited, [7]);
  assert.deepEqual(out.valid, [], 'nothing validated');
  assert.deepEqual(out.dangling, [7], 'the dangling citation is reported, never dropped');
  assert.equal(out.grounded, false, 'an answer whose only citation dangles is not grounded');
  assert.deepEqual(out.citations.map((c) => c.n), [], 'no source is claimed for a dangling citation');
});

test('one dangling citation among valid ones still fails the check', async () => {
  const out = await askWith('Wells must be plugged within one year [1] [9].');
  assert.deepEqual(out.cited, [1, 9]);
  assert.deepEqual(out.valid, [1]);
  assert.deepEqual(out.dangling, [9]);
  assert.equal(out.grounded, false);
  assert.deepEqual(out.citations.map((c) => c.n), [1]);
});

test('an answer whose citations all resolve is grounded', async () => {
  const out = await askWith('Wells must be plugged within one year [1]. Pits must be lined [2].');
  assert.deepEqual(out.cited, [1, 2]);
  assert.deepEqual(out.valid, [1, 2]);
  assert.deepEqual(out.dangling, []);
  assert.equal(out.grounded, true);
});

test('a refusal is not grounded', async () => {
  const out = await askWith('Not in your vault.');
  assert.equal(out.refused, true);
  assert.equal(out.grounded, false, 'the model declined — there is nothing grounded');
});

test('uncited sentences are measured, not enforced', async () => {
  const out = await askWith('Wells must be plugged within one year [1]. Pits need no liner at all.');
  assert.equal(typeof out.uncited_sentences, 'number');
  assert.equal(out.uncited_sentences, 1, 'the uncited sentence is counted');
  assert.equal(out.grounded, true, 'counting is measurement, not enforcement');
});

// ── the receipt, end to end ───────────────────────────────────────────────────
const FILES = {
  'plugging.md': '# Plugging\nA well must be plugged within one year after operations cease.\n',
  'pits.md': '# Pits\nPits must be lined with an approved liner.\n',
};

async function ask(base, q) {
  const r = await fetch(`${base}/api/answer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q }),
  });
  return { status: r.status, body: await r.json() };
}

test('a wrong citation is refused, receipted and never shown as an answer', async () => {
  const { srv, base: modelUrl } = await mockModel('A well must be plugged within 30 days [7].');
  const { child, base, vault } = await bootServer({
    MODEL_BASE_URL: modelUrl,
    MODEL_API_KEY: 'test',
    MODEL_NAME: 'mock-cite',
  }, FILES);
  try {
    const { body } = await ask(base, 'how long until a well must be plugged');
    assert.equal(body.mode, 'refused', 'the API treats a failed citation check as a refusal');
    assert.equal(body.refused, true);
    assert.equal(body.reason, "The answer didn't pass the citation check.");
    assert.equal(body.grounded, false);
    assert.equal(body.receipt.verdict, 'REFUSED_CITATION_CHECK');
    assert.deepEqual(body.receipt.dangling_citations, [7]);
    assert.deepEqual(body.receipt.cited, [7]);
    assert.deepEqual(body.receipt.sources, []);
    assert.equal(body.receipt.answer, 'A well must be plugged within 30 days [7].', 'the receipt keeps the text for audit');
    assert.equal(body.answer, undefined, 'the answer text is not shown as an answer');
    assert.equal(body.grounded, body.receipt.verdict === 'GROUNDED', 'grounded and the verdict never disagree');

    // The refusal is still a sealed receipt, and the chain still verifies.
    const led = await (await fetch(`${base}/api/ledger`)).json();
    assert.equal(led.entries.filter((e) => e.kind === 'answer_receipt').length, 1);
    assert.equal((await (await fetch(`${base}/api/ledger/verify`)).json()).ok, true);
  } finally {
    child.kill();
    srv.close();
    rmVault(vault);
  }
});

test('a receipt carries cited, dangling_citations, sources and uncited_sentences', async () => {
  const { srv, base: modelUrl } = await mockModel('A well must be plugged within one year [1].');
  const { child, base, vault } = await bootServer({
    MODEL_BASE_URL: modelUrl,
    MODEL_API_KEY: 'test',
    MODEL_NAME: 'mock-cite',
  }, FILES);
  try {
    const { body } = await ask(base, 'how long until a well must be plugged');
    assert.equal(body.receipt.verdict, 'GROUNDED');
    assert.equal(body.grounded, true);
    assert.ok(Array.isArray(body.receipt.cited));
    assert.ok(Array.isArray(body.receipt.dangling_citations));
    assert.ok(Array.isArray(body.receipt.sources));
    assert.equal(typeof body.receipt.uncited_sentences, 'number');
    assert.deepEqual(body.receipt.dangling_citations, []);
    assert.ok(body.receipt.sources.length >= 1);
    assert.equal((await (await fetch(`${base}/api/ledger/verify`)).json()).ok, true);
  } finally {
    child.kill();
    srv.close();
    rmVault(vault);
  }
});
