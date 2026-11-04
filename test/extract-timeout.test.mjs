// R4: extraction has a time limit and a kill path.
//
// The zero-dep PDF parser had neither: `extractText(buf, '.pdf')` on the Texas
// RRC Chapter 3 PDF (3.3 MB) did not finish inside a 180 s cap, and there was
// no timeout and no kill path anywhere in the call — one file could stall an
// index run with no limit (a Twelve-Factor 9 failure).
//
// The fix: each file's extraction runs in a worker thread with a limit set by
// CAIRN_EXTRACT_TIMEOUT_MS. A file that hits the limit is REPORTED
// (EXTRACT_TIMEOUT, with its path) — never silently dropped — and indexing
// continues.
//
// Red-first: the implementation is not in place yet, so this file fails on
// assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as extract from '../lib/extract.mjs';
import { buildIndex } from '../lib/index.mjs';

const HANG_WORKER = new URL('./fixtures/hang-worker.mjs', import.meta.url);

test('a stub that never returns is killed at the limit', async () => {
  assert.equal(typeof extract.extractTextBounded, 'function', 'lib/extract.mjs must export extractTextBounded');
  const t0 = Date.now();
  const out = await extract.extractTextBounded(Buffer.from('%PDF-1.4\n'), '.pdf', {
    timeoutMs: 300,
    workerUrl: HANG_WORKER,
  });
  const elapsed = Date.now() - t0;
  assert.equal(out.ok, false);
  assert.equal(out.timed_out, true, 'the timeout is reported, not hidden');
  assert.match(out.note, /EXTRACT_TIMEOUT/);
  assert.ok(elapsed < 10000, `the kill path returns promptly, took ${elapsed}ms`);
});

test('the limit is configurable and has a documented default', () => {
  assert.equal(typeof extract.extractTimeoutMs, 'function');
  assert.equal(typeof extract.DEFAULT_EXTRACT_TIMEOUT_MS, 'number');
  assert.ok(extract.DEFAULT_EXTRACT_TIMEOUT_MS > 0);
});

test('a timed-out file is reported with its path, and indexing continues', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-to-'));
  writeFileSync(join(dir, 'note.md'), '# Note\n\nThe widget assembly line runs on Tuesdays.\n');
  writeFileSync(join(dir, 'big.pdf'), '%PDF-1.4\nnot really a pdf\n');
  try {
    const idx = await buildIndex(dir, {
      exts: ['.md', '.pdf'],
      extractOpts: { timeoutMs: 300, workerUrl: HANG_WORKER },
    });
    assert.ok(Array.isArray(idx.extract_timeouts), 'the index reports extraction timeouts');
    assert.equal(idx.extract_timeouts.length, 1, 'exactly the PDF timed out');
    assert.equal(idx.extract_timeouts[0].path, 'big.pdf', 'the report names the path');
    assert.equal(idx.extract_timeouts[0].timeout_ms, 300);
    // Indexing continued: the note beside the stuck file is in the index.
    assert.ok(idx.notes.some((n) => n.rel === 'note.md'), 'the note beside the stuck file is indexed');
    // And the stuck file is still findable, by filename, with an honest body.
    const pdf = idx.notes.find((n) => n.rel === 'big.pdf');
    assert.ok(pdf, 'the timed-out file is not dropped');
    assert.match(pdf.title, /big/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
