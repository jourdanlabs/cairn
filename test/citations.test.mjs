// R7: grouped and ranged citations resolve to individual numbers.
//
// A model that writes "[1, 4]" is citing TWO sources. The old parser only matched
// "[n]", so grouped citations silently vanished — in the real ledger that cost
// four GROUNDED receipts their sources, one of them all of them.
//
// Red-first: the parse is not implemented yet, so this file fails on an assertion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import * as ground from '../lib/ground.mjs';

const CONTEXTS = [
  { n: 1, note: 'a.md', heading: '', text: 'Wells must be plugged within one year.' },
  { n: 2, note: 'b.md', heading: '', text: 'Pits must be lined with an approved liner.' },
  { n: 3, note: 'c.md', heading: '', text: 'Casing must be cemented.' },
  { n: 4, note: 'd.md', heading: '', text: 'Records must be kept for five years.' },
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

test('parseCitations resolves every citation form to individual numbers', () => {
  assert.equal(typeof ground.parseCitations, 'function', 'lib/ground.mjs must export parseCitations');
  assert.deepEqual(ground.parseCitations('a [1] b'), [1]);
  assert.deepEqual(ground.parseCitations('a [1, 4] b'), [1, 4]);
  assert.deepEqual(ground.parseCitations('a [1,4] b'), [1, 4]);
  assert.deepEqual(ground.parseCitations('a [1][4] b'), [1, 4]);
  assert.deepEqual(ground.parseCitations('a [1-3] b'), [1, 2, 3]);
  assert.deepEqual(ground.parseCitations('a [1–3] b'), [1, 2, 3], 'en dash range');
  assert.deepEqual(ground.parseCitations('a [1-3, 7] b'), [1, 2, 3, 7]);
  assert.deepEqual(ground.parseCitations('a [1, 4] and [2-3] b'), [1, 2, 3, 4]);
  assert.deepEqual(ground.parseCitations('no citations here'), []);
  assert.deepEqual(ground.parseCitations('see [note 1] and [2024]'), [], 'a bracket that is not a citation is not a citation');
});

test('a grouped citation reaches the sources it names', async () => {
  const { srv, base } = await mockModel('Wells must be plugged within one year [1, 4]. Pits must be lined [2-3].');
  process.env.MODEL_BASE_URL = base;
  delete process.env.MODEL_API_KEY;
  try {
    const out = await ground.groundedAnswer({ query: 'plugging deadline?', contexts: CONTEXTS });
    assert.deepEqual(out.cited, [1, 2, 3, 4]);
    assert.deepEqual(out.citations.map((c) => c.n), [1, 2, 3, 4]);
  } finally {
    srv.close();
    delete process.env.MODEL_BASE_URL;
  }
});
