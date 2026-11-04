// R5: the tokenizer keeps section numbers.
//
// "3.8" used to be split on the dot into "3" and "8" — both one character, both
// dropped — so a section reference vanished from the index entirely:
//   tokenize("Rule 3.8 applies")  → ["rule","appli"]
//   tokenize("§3.8(d)(1)")        → []
//   tokenize("SWR 3.13")           → ["swr","13"]
// A question about "Rule 3.8" could not find the note that says "3.8".
//
// Red-first: the implementation is not in place yet, so this file fails on
// assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tokenize, buildIndex } from '../lib/index.mjs';
import { search } from '../lib/search.mjs';

test('a section number survives whole', () => {
  const t = tokenize('Rule 3.8 applies');
  assert.ok(t.includes('3.8'), `"3.8" must survive as one token, got ${JSON.stringify(t)}`);
});

test('a section number with qualifiers keeps the whole and the joined form', () => {
  const t = tokenize('§3.8(d)(1)');
  assert.ok(t.includes('3.8'), `the section number must survive, got ${JSON.stringify(t)}`);
  assert.ok(t.includes('3.8d1'), `the qualified join must survive, got ${JSON.stringify(t)}`);
});

test('a section number in a rule reference survives whole', () => {
  const t = tokenize('SWR 3.13');
  assert.ok(t.includes('3.13'), `"3.13" must survive as one token, got ${JSON.stringify(t)}`);
});

test('the whole token is emitted alongside the fragments, never instead of them', () => {
  const t = tokenize('SWR 3.13');
  assert.ok(t.includes('3.13'), 'the whole token');
  assert.ok(t.includes('13'), 'the fragment is still there');
  assert.ok(t.includes('swr'), 'the words around it are still there');
});

test('a question about Rule 3.8 ranks the note that contains 3.8 above one that does not', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-sec-'));
  // The note WITHOUT the section number sorts first on purpose: while the
  // section number is dropped from the index both notes match only "rule", so
  // the order is the file order — and the wrong note wins.
  writeFileSync(join(dir, 'a-other-rule.md'), '# Rules\n\nRule 3.9 governs cementing of casing.\n');
  writeFileSync(join(dir, 'z-plugging-rule.md'), '# Rules\n\nRule 3.8 governs plugging deadlines after operations cease.\n');
  try {
    const idx = await buildIndex(dir);
    const r = search(idx, 'Rule 3.8', { k: 5 });
    assert.ok(r.hits.length >= 2, 'both notes are candidates');
    assert.equal(r.hits[0].note, 'z-plugging-rule.md', 'the note carrying 3.8 ranks first');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
