// The old-receipt re-scan — a TOOL, never run against a real ledger by the
// builder. It re-checks every past answer_receipt with the current rules and
// reports what would change; with --append it adds ONE receipt_correction per
// changed receipt, naming the seq it corrects, and never touches an existing
// line, so the hash chain stays valid.
//
// The ledger below is SYNTHETIC — built with CAIRN's own Ledger class, with a
// grouped-citation receipt in it (the shape that cost four GROUNDED receipts
// their sources in the real ledger).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../core/ledger.mjs';

// The tool does not exist yet: the import is caught so this file fails on an
// ASSERTION, never on an import error.
let tool = {};
try { tool = await import('../scripts/rescan-receipts.mjs'); } catch { /* not implemented yet */ }

function syntheticLedger() {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-rescan-'));
  const path = join(dir, 'ledger.jsonl');
  const ledger = new Ledger(path);
  // seq 0 — a clean receipt: one citation, one source. Nothing changes.
  ledger.append('answer_receipt', {
    tool: 'cairn', kind: 'answer', verdict: 'GROUNDED',
    question: 'plugging deadline?', answer: 'A well must be plugged within one year [1].',
    sources: [{ note: 'a.md', heading: null, content_sha256: 'a'.repeat(64) }],
  });
  // seq 1 — a GROUPED citation the old parser could not see: sealed GROUNDED
  // with NO sources at all. This is the receipt shape that cost a real answer
  // its provenance.
  ledger.append('answer_receipt', {
    tool: 'cairn', kind: 'answer', verdict: 'GROUNDED',
    question: 'what does the rule say?', answer: 'The rule says one year [1, 4].',
    sources: [],
  });
  // seq 2 — a dangling citation, dropped silently by the old code.
  ledger.append('answer_receipt', {
    tool: 'cairn', kind: 'answer', verdict: 'GROUNDED',
    question: 'pit liner?', answer: 'A well must be plugged within one year [1] [9].',
    sources: [{ note: 'b.md', heading: null, content_sha256: 'b'.repeat(64) }],
  });
  // seq 3 — a refusal. The citation rules do not apply: nothing was claimed.
  ledger.append('answer_receipt', {
    tool: 'cairn', kind: 'answer', verdict: 'REFUSED_UNGROUNDED',
    question: 'zenith corp v. balfour?', answer: 'Not in your vault.', sources: [],
  });
  return { dir, path };
}

test('the re-scan tool exists', () => {
  assert.equal(typeof tool.rescanLedger, 'function', 'scripts/rescan-receipts.mjs must export rescanLedger');
});

test('the dry run reports what would change, and writes nothing', () => {
  const { dir, path } = syntheticLedger();
  try {
    const before = readFileSync(path, 'utf8');
    const { rows, corrections } = tool.rescanLedger(path);
    assert.equal(rows.length, 4, 'every answer_receipt is re-checked');
    assert.deepEqual(rows.map((r) => r.seq), [0, 1, 2, 3]);
    assert.equal(rows[0].new_verdict, 'GROUNDED', 'a clean receipt is unchanged');
    assert.equal(rows[0].changed, false);
    assert.equal(rows[1].new_verdict, 'REFUSED_CITATION_CHECK', 'a grouped citation with no sources is not grounded');
    assert.deepEqual(rows[1].dangling_citations, [1, 4], 'the dropped grouped citations are named');
    assert.equal(rows[2].new_verdict, 'REFUSED_CITATION_CHECK', 'a dangling citation is not grounded');
    assert.deepEqual(rows[2].dangling_citations, [9]);
    assert.equal(rows[3].new_verdict, 'REFUSED_UNGROUNDED', 'a refusal is unchanged');
    assert.equal(rows[3].changed, false);
    assert.equal(corrections.length, 2, 'exactly the two receipts that changed');
    assert.equal(readFileSync(path, 'utf8'), before, 'the dry run writes nothing at all');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('--append adds one correction per changed receipt and never edits a line', () => {
  const { dir, path } = syntheticLedger();
  try {
    const before = readFileSync(path, 'utf8');
    const beforeLines = before.split('\n').filter(Boolean);
    const { appended } = tool.rescanLedger(path, { append: true });
    assert.equal(appended.length, 2, 'one correction per changed receipt');
    const after = readFileSync(path, 'utf8');
    const afterLines = after.split('\n').filter(Boolean);
    assert.deepEqual(afterLines.slice(0, beforeLines.length), beforeLines, 'existing lines are byte-identical');
    const ledger = new Ledger(path);
    const rows = ledger.all();
    assert.equal(rows.length, beforeLines.length + 2);
    const corrections = rows.filter((e) => e.kind === 'receipt_correction');
    assert.equal(corrections.length, 2);
    assert.deepEqual(corrections.map((c) => c.payload.corrects_seq).sort(), [1, 2], 'each correction names the seq it corrects');
    assert.equal(corrections[0].payload.old_verdict, 'GROUNDED');
    assert.equal(corrections[0].payload.new_verdict, 'REFUSED_CITATION_CHECK');
    assert.deepEqual(corrections.find((c) => c.payload.corrects_seq === 1).payload.dangling_citations, [1, 4]);
    // The chain is still valid: the correction sealed onto the old tail.
    const v = ledger.verify();
    assert.equal(v.ok, true, `the chain must still verify, got: ${v.reason}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
