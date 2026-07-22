// Tests for the hash-chained receipt ledger. Uses node:test + a tmp file so the
// on-disk append/restart/tamper behavior is exercised for real, not mocked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Ledger, canonicalJSON, entryHash, ZERO_HASH,
  recordAnswerReceipt, recordReportReceipt,
} from '../core/ledger.mjs';

// A fresh ledger path under a unique tmp dir, plus a deterministic clock.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-ledger-'));
  const path = join(dir, 'sub', 'ledger.jsonl'); // nested => also tests mkdir
  let t = 0;
  const now = () => `2020-01-01T00:00:${String(t++).padStart(2, '0')}.000Z`;
  return { path, now };
}

test('append 3 entries → verify ok, count 3, chain links correct', () => {
  const { path, now } = fixture();
  const led = new Ledger(path, { now });

  const e0 = led.append('answer_receipt', { q: 'a', n: 1 });
  const e1 = led.append('integrity_report', { score: 92 });
  const e2 = led.append('note', { msg: 'x' });

  assert.equal(e0.seq, 0);
  assert.equal(e0.prev_hash, ZERO_HASH);
  assert.equal(e1.prev_hash, e0.entry_hash);
  assert.equal(e2.prev_hash, e1.entry_hash);
  assert.match(e0.ts, /^2020-01-01T/); // injected clock used for ts

  const v = led.verify();
  assert.deepEqual(v, { ok: true, count: 3, broken_at: null, reason: null });
});

test('tamper a payload on disk → verify ok:false with correct broken_at', () => {
  const { path, now } = fixture();
  const led = new Ledger(path, { now });
  led.append('answer_receipt', { q: 'a' });
  led.append('answer_receipt', { q: 'b' }); // seq 1 — the victim
  led.append('answer_receipt', { q: 'c' });

  // Rewrite line 1's payload but keep its (now stale) entry_hash.
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const tampered = JSON.parse(lines[1]);
  tampered.payload = { q: 'HACKED' };
  lines[1] = JSON.stringify(tampered);
  writeFileSync(path, lines.join('\n') + '\n');

  const v = led.verify();
  assert.equal(v.ok, false);
  assert.equal(v.broken_at, 1);
  assert.equal(v.count, 3);
  assert.match(v.reason, /tamper/i);
});

test('reopening the ledger continues the chain correctly', () => {
  const { path, now } = fixture();
  const a = new Ledger(path, { now });
  a.append('answer_receipt', { q: 'a' });
  const last = a.append('answer_receipt', { q: 'b' });

  // Brand-new instance on the same path must read the tail and link onward.
  const b = new Ledger(path, { now });
  const next = b.append('answer_receipt', { q: 'c' });
  assert.equal(next.seq, 2);
  assert.equal(next.prev_hash, last.entry_hash);

  assert.equal(b.verify().ok, true);
  assert.equal(b.all().length, 3);
});

test('canonicalJSON is order-invariant (equal hashes for reordered keys)', () => {
  const p1 = { b: 2, a: 1, nested: { y: [3, 2], x: 1 } };
  const p2 = { nested: { x: 1, y: [3, 2] }, a: 1, b: 2 };
  assert.equal(canonicalJSON(p1), canonicalJSON(p2));

  const base = { seq: 0, prev_hash: ZERO_HASH, kind: 'k' };
  assert.equal(entryHash({ ...base, payload: p1 }), entryHash({ ...base, payload: p2 }));

  // Array order, by contrast, is significant.
  assert.notEqual(canonicalJSON([1, 2]), canonicalJSON([2, 1]));
});

test('recordAnswerReceipt / recordReportReceipt seal with correct kinds', () => {
  const { path, now } = fixture();
  const led = new Ledger(path, { now });
  const ar = recordAnswerReceipt(led, { answer: 'hi', sources: ['x'] });
  const rr = recordReportReceipt(led, { integrity_score: 88 });

  assert.equal(ar.kind, 'answer_receipt');
  assert.equal(rr.kind, 'integrity_report');
  assert.equal(rr.seq, 1);
  assert.ok(ar.entry_hash && rr.entry_hash);
  assert.equal(led.verify().ok, true);
});
