// lib/audit.mjs — knowledge-base defect scan: orphans, broken links, duplicate
// titles, stubs (+ stale/untagged), returning counts + findings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../lib/index.mjs';
import { audit } from '../lib/audit.mjs';
import { mkVault, rmVault } from './helpers.mjs';

const VAULT = {
  // orphan: no inbound, no outbound links.
  'orphan.md': `# Orphan Note\n\nThis standalone note links nowhere and nothing links to it at all here.\n`,
  // broken link: points at a note that does not exist (also gives it an outlink).
  'hasbroken.md': `# Has Broken\n\nThis note references [[Ghost Note]] which does not exist anywhere in the vault.\n`,
  // duplicate titles: two notes share the title "Shared Title".
  'dup-a.md': `---\ntitle: Shared Title\n---\n\n# Shared Title\n\nFirst note that happens to share a title with another distinct note here.\n`,
  'dup-b.md': `---\ntitle: Shared Title\n---\n\n# Shared Title\n\nSecond note that happens to share a title with another distinct note here.\n`,
  // stub: under ~12 words.
  'stub.md': `# Stub\n\nToo short.\n`,
};

test('audit detects orphans, broken links, duplicate titles, and stubs', async () => {
  const dir = mkVault(VAULT);
  try {
    const index = await buildIndex(dir, { exts: ['.md'] });
    const a = audit(index);

    // counts object mirrors finding item lengths.
    assert.equal(typeof a.counts, 'object');
    for (const f of a.findings) assert.equal(a.counts[f.key], f.items.length);

    // orphans include the standalone note.
    assert.ok(a.counts.orphans >= 1);
    const orphans = a.findings.find((f) => f.key === 'orphans').items;
    assert.ok(orphans.some((o) => o.note === 'orphan.md'));

    // broken links point at the missing target.
    assert.equal(a.counts.broken_links, 1);
    const broken = a.findings.find((f) => f.key === 'broken_links').items;
    assert.deepEqual(broken[0], { from: 'hasbroken.md', link: 'Ghost Note' });

    // duplicate titles group the two notes.
    assert.equal(a.counts.duplicate_titles, 1);
    const dup = a.findings.find((f) => f.key === 'duplicate_titles').items[0];
    assert.equal(dup.title, 'shared title');
    assert.deepEqual(dup.notes.sort(), ['dup-a.md', 'dup-b.md']);

    // stub note is flagged.
    assert.ok(a.counts.stubs >= 1);
    const stubs = a.findings.find((f) => f.key === 'stubs').items;
    assert.ok(stubs.some((s) => s.note === 'stub.md'));

    assert.equal(a.total_notes, index.notes.length);
  } finally { rmVault(dir); }
});

test('a clean, well-linked corpus reports zero core defects', async () => {
  const dir = mkVault({
    'one.md': `---\ntitle: One\ntags: [x]\n---\n\n# One\n\nThis note has enough words to avoid stub status and links to [[Two]] cleanly here.\n`,
    'two.md': `---\ntitle: Two\ntags: [x]\n---\n\n# Two\n\nThis note has enough words to avoid stub status and links to [[One]] cleanly here.\n`,
  });
  try {
    const index = await buildIndex(dir, { exts: ['.md'] });
    const a = audit(index);
    assert.equal(a.counts.orphans, 0);
    assert.equal(a.counts.broken_links, 0);
    assert.equal(a.counts.duplicate_titles, 0);
    assert.equal(a.counts.stubs, 0);
  } finally { rmVault(dir); }
});
