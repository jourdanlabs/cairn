// C-1: a citation range is never wider than the contexts it may name.
//
// A model can be coaxed into writing "[1-999999999]" by a document in the corpus.
// The parser built that set before anything could stop it — millions of numbers,
// then RangeError: Set maximum size exceeded, after about 1.3 s. On a small public
// box that memory spike is a denial of service the model can trigger by itself.
//
// The rule:
//   - a range wider than the number of contexts supplied is NOT expanded;
//   - with no context count given, the widest range that may be expanded is 64;
//   - a range that is wider, or reversed, names NO note: it is reported as
//     dangling, so the verdict is REFUSED_CITATION_CHECK.
//
// Red-first: the cap is not in place yet, so this file fails on assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import * as ground from '../lib/ground.mjs';
import { bootServer, rmVault } from './helpers.mjs';

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

async function askWith(reply) {
  const { srv, base } = await mockModel(reply);
  process.env.MODEL_BASE_URL = base;
  delete process.env.MODEL_API_KEY;
  try {
    return await ground.groundedAnswer({ query: 'plugging deadline?', contexts: CONTEXTS });
  } finally {
    srv.close();
    delete process.env.MODEL_BASE_URL;
  }
}

test('a range wider than the contexts is not expanded, and the parse stays fast', () => {
  let cited = null;
  let threw = null;
  const t0 = Date.now();
  try { cited = ground.parseCitations('Answer [1-999999999].', { contextCount: 4 }); }
  catch (err) { threw = err; }
  const ms = Date.now() - t0;
  assert.equal(threw, null, 'parsing a wide range must not throw');
  assert.ok(ms < 50, `parsing took ${ms}ms — it must stay under 50ms`);
  assert.equal(Array.isArray(cited) ? cited.length : -1, 1,
    'the range names no note: it is reported, not expanded');
  assert.equal(cited.length, 1, 'nothing was expanded into the answer');
});

test('with no context count, a range wider than 64 is not expanded', () => {
  let at64 = null;
  let threw = null;
  try { at64 = ground.parseCitations('a [1-64] b'); }
  catch (err) { threw = err; }
  assert.equal(threw, null);
  assert.equal(at64.length, 64, 'a range of exactly 64 is still expanded');
  assert.equal(at64[0], 1);
  assert.equal(at64[63], 64);

  let at65 = null;
  threw = null;
  try { at65 = ground.parseCitations('a [1-65] b'); }
  catch (err) { threw = err; }
  assert.equal(threw, null);
  assert.equal(at65.length, 1, 'a range wider than 64 names no note');
});

test('an answer citing a huge range is refused, not sealed', async () => {
  let out = null;
  let threw = null;
  try { out = await askWith('Wells must be plugged within 30 days [1-999999999].'); }
  catch (err) { threw = err; }
  assert.equal(threw, null, 'the answer path must not throw on a wide range');
  assert.equal(out.grounded, false, 'a citation that names no note is not grounded');
  assert.deepEqual(out.valid, [], 'nothing validated');
  assert.deepEqual(out.citations.map((c) => c.n), [], 'no source is claimed');
  assert.equal(out.dangling.length, 1, 'the malformed citation is reported as dangling');
});

test('a reversed range is dangling', async () => {
  let out = null;
  let threw = null;
  try { out = await askWith('Wells must be plugged within one year [3-1].'); }
  catch (err) { threw = err; }
  assert.equal(threw, null);
  assert.equal(out.grounded, false, 'a reversed range names no note');
  assert.deepEqual(out.valid, [], 'nothing validated');
  assert.equal(out.dangling.length, 1, 'the reversed range is reported as dangling');
});

test('a range that fits the contexts is still expanded and grounded', async () => {
  const out = await askWith('Wells must be plugged within one year [1-4].');
  assert.deepEqual(out.cited, [1, 2, 3, 4]);
  assert.deepEqual(out.valid, [1, 2, 3, 4]);
  assert.deepEqual(out.dangling, []);
  assert.equal(out.grounded, true, 'a range inside the contexts is not affected by the cap');
});

// ── end to end: the server refuses it and seals the refusal ─────────────────
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

test('a wide range is refused by the server and sealed as REFUSED_CITATION_CHECK', async () => {
  const { srv, base: modelUrl } = await mockModel('A well must be plugged within 30 days [1-999999999].');
  const { child, base, vault } = await bootServer({
    MODEL_BASE_URL: modelUrl,
    MODEL_API_KEY: 'test',
    MODEL_NAME: 'mock-range',
  }, FILES);
  try {
    const { body } = await ask(base, 'how long until a well must be plugged');
    assert.equal(body.mode, 'refused', 'the API treats a failed citation check as a refusal');
    assert.equal(body.refused, true);
    assert.equal(body.grounded, false);
    assert.equal(body.receipt.verdict, 'REFUSED_CITATION_CHECK');
    assert.deepEqual(body.receipt.sources, [], 'no source is claimed');
    assert.equal(body.answer, undefined, 'the answer text is not shown as an answer');
    assert.equal(body.receipt.answer, 'A well must be plugged within 30 days [1-999999999].',
      'the receipt keeps the text for audit');
    assert.equal((await (await fetch(`${base}/api/ledger/verify`)).json()).ok, true);
  } finally {
    child.kill();
    srv.close();
    rmVault(vault);
  }
});
