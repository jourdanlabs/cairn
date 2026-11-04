// R3: ranking is reproducible.
//
// The retriever used to read the wall clock: lib/search.mjs took Date.now() and
// boosted fresher notes by up to 8%. The same corpus and the same question
// therefore ranked differently depending on the day it was asked — which means
// a receipt could never be re-checked later.
//
// The fix: search() takes an explicit `now`. With no `now` there is NO recency
// boost at all. With one, the ranking is exactly reproducible, and the server
// writes that timestamp into the receipt as `ranked_at`.
//
// Red-first: the implementation is not in place yet, so this file fails on
// assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, utimesSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildIndex } from '../lib/index.mjs';
import { search } from '../lib/search.mjs';
import { bootServer, rmVault } from './helpers.mjs';

const BODY = '# Plugging\nA well must be plugged within one year after operations cease.\n';
const QUERY = 'plugged within one year';

// Two notes with identical text, 400 days apart in mtime. With a recency boost
// the fresh one wins; without one they tie and the order is the file order.
function corpus() {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-rank-'));
  writeFileSync(join(dir, 'a-old.md'), BODY);
  writeFileSync(join(dir, 'b-fresh.md'), BODY);
  const nowS = Date.now() / 1000;
  utimesSync(join(dir, 'a-old.md'), nowS - 400 * 86400, nowS - 400 * 86400);
  utimesSync(join(dir, 'b-fresh.md'), nowS, nowS);
  return dir;
}

const ranking = (r) => r.hits.map((h) => `${h.note}@${h.score}`);

test('with no "now", the ranking does not depend on the wall clock', async () => {
  const dir = corpus();
  try {
    const idx = await buildIndex(dir);
    const realNow = Date.now;
    try {
      Date.now = () => realNow();
      const day0 = ranking(search(idx, QUERY, { k: 5 }));
      Date.now = () => realNow() + 120 * 86400000;
      const day120 = ranking(search(idx, QUERY, { k: 5 }));
      assert.deepEqual(day120, day0, 'the same corpus and question rank the same on any day');
    } finally { Date.now = realNow; }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the same explicit "now" reproduces the ranking exactly', async () => {
  const dir = corpus();
  try {
    const idx = await buildIndex(dir);
    const now = '2026-11-03T00:00:00.000Z';
    const a = ranking(search(idx, QUERY, { k: 5, now }));
    const b = ranking(search(idx, QUERY, { k: 5, now }));
    assert.deepEqual(b, a, 'the same now gives the same order and the same scores');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('"now" is the recency knob, not a stub', async () => {
  const dir = corpus();
  try {
    const idx = await buildIndex(dir);
    const fresh = '2026-01-01T00:00:00.000Z';
    const later = '2026-05-01T00:00:00.000Z'; // 120 days on
    const a = ranking(search(idx, QUERY, { k: 5, now: fresh }));
    const b = ranking(search(idx, QUERY, { k: 5, now: later }));
    assert.notDeepEqual(b, a, 'an explicit now moves the recency boost');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── end to end: the receipt carries the instant it was ranked at ─────────────
const FILES = {
  'plugging.md': '# Plugging\nA well must be plugged within one year after operations cease.\n',
  'pits.md': '# Pits\nPits must be lined with an approved liner.\n',
};

async function ask(base, body) {
  const r = await fetch(`${base}/api/answer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return await r.json();
}

test('the receipt records ranked_at, and that instant re-ranks exactly', async () => {
  const { child, base, vault } = await bootServer({}, FILES);
  try {
    const now = '2026-01-01T00:00:00.000Z';
    const first = await ask(base, { q: 'how long until a well must be plugged', now });
    assert.equal(typeof first.receipt.ranked_at, 'string', 'the receipt records when it ranked');
    assert.equal(first.receipt.ranked_at, now);
    // Re-asking later, with the same instant, must reproduce the same ranking.
    const second = await ask(base, { q: 'how long until a well must be plugged', now });
    assert.deepEqual(second.receipt.retrieved_considered, first.receipt.retrieved_considered,
      'the same corpus, question and instant rank identically later');
  } finally {
    child.kill();
    rmVault(vault);
  }
});
