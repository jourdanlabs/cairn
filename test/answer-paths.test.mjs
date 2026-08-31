// Every answer path seals exactly one ledger entry. Hits + model-off →
// passages_returned; weak → answer_receipt refused; grounded (mocked model) →
// answer_receipt. /api/ledger/verify is ok:true after each.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { bootServer, rmVault } from './helpers.mjs';

const files = {
  'hargrove.md': `---
title: Deposition of Hargrove
---
# Deposition

Daniel Hargrove testified that he inspected the shipment on March 12 and measured coating thickness between 3.2 and 3.6 mils.
`,
  'exhibit.md': `---
title: Exhibit 12
---
# Exhibit 12

The March 14 email says the crates were still sealed and unopened.
`,
};

async function ask(base, q) {
  const r = await fetch(`${base}/api/answer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q }),
  });
  return { status: r.status, body: await r.json() };
}

test('hits + model-off seals exactly one passages_returned; verify ok', async () => {
  const { child, base, vault } = await bootServer({}, files);
  try {
    const { body } = await ask(base, 'When did Hargrove inspect the shipment?');
    assert.equal(body.mode, 'passages');
    assert.equal(body.refused, undefined);
    assert.ok(body.hits.length >= 1);
    assert.equal(body.receipt.kind, 'passages_returned');
    assert.match(body.receipt.query_hash, /^[a-f0-9]{64}$/);
    assert.equal(body.receipt.hit_count, body.hits.length);
    assert.ok(Array.isArray(body.receipt.chunk_ids));
    assert.equal(typeof body.ledger.seq, 'number');
    assert.match(body.ledger.entry_hash, /^[a-f0-9]{64}$/);

    const led = await (await fetch(`${base}/api/ledger`)).json();
    const passages = led.entries.filter((e) => e.kind === 'passages_returned');
    assert.equal(passages.length, 1, 'exactly one passages_returned');
    assert.equal(led.ok, true);

    const v = await (await fetch(`${base}/api/ledger/verify`)).json();
    assert.equal(v.ok, true);
    assert.ok(v.count >= 1);
  } finally { child.kill(); rmVault(vault); }
});

test('weak query seals one answer_receipt (refused); verify ok', async () => {
  const { child, base, vault } = await bootServer({}, files);
  try {
    const { body } = await ask(base, 'What did the court hold in Zenith Corp v. Balfour?');
    assert.equal(body.mode, 'refused');
    assert.equal(body.refused, true);
    assert.equal(body.receipt.verdict, 'REFUSED_UNGROUNDED');
    const led = await (await fetch(`${base}/api/ledger`)).json();
    assert.equal(led.entries.filter((e) => e.kind === 'answer_receipt').length, 1);
    assert.equal(led.entries.filter((e) => e.kind === 'passages_returned').length, 0);
    assert.equal((await (await fetch(`${base}/api/ledger/verify`)).json()).ok, true);
  } finally { child.kill(); rmVault(vault); }
});

test('grounded answer with [n] citations seals one answer_receipt; verify ok', async () => {
  const mock = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      // rerank + chat both hit /chat/completions; return a cited answer either way.
      res.end(JSON.stringify({
        choices: [{ message: { content: 'Hargrove inspected the shipment on March 12 [1]. Exhibit 12 says the crates were still sealed on March 14 [2].' } }],
      }));
    });
  });
  mock.listen(0, '127.0.0.1');
  await once(mock, 'listening');
  const modelUrl = `http://127.0.0.1:${mock.address().port}/v1`;
  const { child, base, vault } = await bootServer({
    MODEL_BASE_URL: modelUrl,
    MODEL_API_KEY: 'test',
    MODEL_NAME: 'mock-cite',
  }, files);
  try {
    const { body } = await ask(base, 'When did Hargrove inspect the shipment, and what does Exhibit 12 say?');
    assert.equal(body.mode, 'answer');
    assert.equal(body.refused, false);
    assert.match(body.answer, /\[1\]/);
    assert.ok(body.grounded);
    assert.ok(Array.isArray(body.citations) && body.citations.length >= 1);
    assert.equal(body.receipt.verdict, 'GROUNDED');
    const led = await (await fetch(`${base}/api/ledger`)).json();
    assert.equal(led.entries.filter((e) => e.kind === 'answer_receipt').length, 1);
    assert.equal(led.ok, true);
    assert.equal((await (await fetch(`${base}/api/ledger/verify`)).json()).ok, true);
  } finally {
    child.kill();
    mock.close();
    rmVault(vault);
  }
});
