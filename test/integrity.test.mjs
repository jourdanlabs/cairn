// lib/integrity.mjs — the scored, hashed integrity report (async).
// NOTE: contradiction detection needs a live embedding model, so these fixtures
// are never embedded (index.embedded is unset). That path stays "unavailable"
// and is asserted as such; it is NOT exercised here. See contradict.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../lib/index.mjs';
import { integrityReport, RAW_ARCHIVE_NOTE } from '../lib/integrity.mjs';
import { mkVault, rmVault, ageFile } from './helpers.mjs';

const CLEAN = {
  'docs/one.md': `---\ntitle: One\nauthority: controlled\ntags: [x]\n---\n\n# One\n\nA well formed note with plenty of words that links onward to [[Two]] cleanly here.\n`,
  'docs/two.md': `---\ntitle: Two\ntags: [x]\n---\n\n# Two\n\nA well formed note with plenty of words that links onward to [[Three]] cleanly here.\n`,
  'docs/three.md': `---\ntitle: Three\ntags: [x]\n---\n\n# Three\n\nA well formed note with plenty of words that links back to [[One]] cleanly here.\n`,
};

const DEFECTIVE = {
  'a.md': `---\ntitle: Dup\ntags: [x]\n---\n\n# Dup\n\nThis note references [[Ghost Note]] which does not exist, producing a broken link here.\n`,
  'b.md': `---\ntitle: Dup\ntags: [x]\n---\n\n# Dup\n\nAn orphan note with a duplicate title and no links in or out of it whatsoever here.\n`,
  'c.md': `---\ntitle: Old\ntags: [x]\n---\n\n# Old\n\nAn orphan and stale note carrying a TODO marker that has not been touched in ages here.\n`,
};

test('integrityReport is async and returns a scored, hashed report', async () => {
  const dir = mkVault(CLEAN);
  try {
    const index = await buildIndex(dir, { exts: ['.md'], controlledDirs: [] });
    const p = integrityReport(index);
    assert.ok(p instanceof Promise); // async
    const rep = await p;

    assert.ok(Number.isInteger(rep.integrity_score));
    assert.ok(rep.integrity_score >= 0 && rep.integrity_score <= 100);
    assert.match(rep.grade, /^[A-F]$/);
    assert.equal(typeof rep.penalties, 'object');
    assert.match(rep.report_sha256, /^[a-f0-9]{64}$/);

    // controlled_coverage counts controlled notes over the total.
    assert.deepEqual(rep.controlled_coverage, { controlled: 1, total: 3 });

    // No embeddings → contradictions unavailable, zero candidates.
    assert.equal(rep.contradictions.available, false);
    assert.equal(rep.contradictions.candidate_count, 0);

    // Score == 100 minus summed penalties (clamped at 0).
    const sum = Object.values(rep.penalties).reduce((s, x) => s + x, 0);
    assert.equal(rep.integrity_score, Math.max(0, 100 - sum));
  } finally { rmVault(dir); }
});

test('a clean corpus scores 100/A; report_sha256 is stable per index+time', async () => {
  const dir = mkVault(CLEAN);
  try {
    const index = await buildIndex(dir, { exts: ['.md'] });
    const at = '2026-01-01T00:00:00.000Z';
    const rep = await integrityReport(index, { at });
    assert.equal(rep.integrity_score, 100);
    assert.equal(rep.grade, 'A');
    // Deterministic: same index + same `at` → identical hash.
    const rep2 = await integrityReport(index, { at });
    assert.equal(rep2.report_sha256, rep.report_sha256);
  } finally { rmVault(dir); }
});

test('a defective corpus scores lower than a clean one; penalties add up', async () => {
  const cleanDir = mkVault(CLEAN);
  const badDir = mkVault(DEFECTIVE);
  try {
    ageFile(badDir, 'c.md', 400); // stale: >180 days old + carries a TODO marker

    const cleanIdx = await buildIndex(cleanDir, { exts: ['.md'] });
    const badIdx = await buildIndex(badDir, { exts: ['.md'] });
    const clean = await integrityReport(cleanIdx);
    const bad = await integrityReport(badIdx);

    assert.ok(bad.integrity_score < clean.integrity_score);

    // Individual penalties are present and non-trivial.
    assert.equal(bad.penalties.broken_links, 6);   // 1 broken × 6
    assert.equal(bad.penalties.duplicate_titles, 3); // 1 group × 3
    assert.ok(bad.penalties.orphans >= 2);          // b.md + c.md
    assert.ok(bad.penalties.stale >= 4);            // c.md stale

    // Score math holds for the defective corpus too.
    const sum = Object.values(bad.penalties).reduce((s, x) => s + x, 0);
    assert.equal(bad.integrity_score, Math.max(0, 100 - sum));
  } finally { rmVault(cleanDir); rmVault(badDir); }
});

test('a curated corpus (front-matter, even if tag-less) is not labeled raw archive', async () => {
  const dir = mkVault({
    'docs/one.md': `---\ntitle: One\nauthority: controlled\n---\n\n# One\n\nA well formed note with plenty of words that links onward to [[Two]] cleanly here.\n`,
    'docs/two.md': `---\ntitle: Two\n---\n\n# Two\n\nA well formed note with plenty of words that links onward to [[One]] cleanly here.\n`,
  });
  try {
    const index = await buildIndex(dir, { exts: ['.md'] });
    const rep = await integrityReport(index);
    assert.equal(rep.raw_archive, false);
    assert.equal(rep.archive_note, undefined);
  } finally { rmVault(dir); }
});

test('a raw archive (untagged + no front-matter schema) self-labels and suppresses orphan penalties', async () => {
  const files = {};
  for (let i = 0; i < 10; i++) {
    files[`dump-${i}.md`] = `# Dump ${i}\n\nA loose personal note with plenty of words and no yaml schema sitting here alone.\n`;
  }
  const dir = mkVault(files);
  try {
    const index = await buildIndex(dir, { exts: ['.md'] });
    const rep = await integrityReport(index);
    assert.equal(rep.raw_archive, true);
    assert.equal(rep.archive_note, RAW_ARCHIVE_NOTE);
    assert.equal(rep.penalties.orphans, 0);
    // The note is the first framing field the caller sees.
    const keys = Object.keys(rep);
    assert.ok(keys.indexOf('archive_note') < keys.indexOf('integrity_score'));
  } finally { rmVault(dir); }
});
