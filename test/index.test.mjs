// lib/index.mjs — vault indexer: frontmatter, tags, wikilinks, heading chunks,
// controlled flags, inbound counts, skip dirs; plus tokenize().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, tokenize } from '../lib/index.mjs';
import { mkVault, rmVault } from './helpers.mjs';

test('tokenize lowercases, strips markdown, drops stopwords + short tokens', () => {
  assert.deepEqual(tokenize('The Quick brown Fox'), ['quick', 'brown', 'fox']);
  assert.deepEqual(tokenize('**bold** `code` [[Link]]'), ['bold', 'code', 'link']);
  // single-char tokens and pure stopwords are removed; digits kept.
  assert.deepEqual(tokenize('a I x k8s 2024'), ['k8s', '2024']);
  assert.deepEqual(tokenize(''), []);
  assert.deepEqual(tokenize(null), []);
});

const VAULT = {
  'policies/alpha.md': `---
title: Alpha Policy
authority: controlled
tags: [security, controlled]
---

# Alpha Policy

Intro linking [[Beta Note]] here with an #inline-tag reference.

## Purpose

The purpose section describes why alpha exists and what it governs.

## Scope

The scope section covers systems and teams in scope for alpha.
`,
  'notes/beta.md': `---
title: Beta Note
---

# Beta Note

Beta refers back to [[Alpha Policy]] and adds detail about the topic here.
`,
  'controlled-dir/gamma.md': `# Gamma

Gamma lives directly under a configured controlled top-level folder here.
`,
  'node_modules/pkg/readme.md': `# Should Be Skipped\n\nThis file lives in node_modules and must never be indexed.\n`,
};

test('buildIndex indexes .md, skips node_modules, parses structure', async () => {
  const dir = mkVault(VAULT);
  try {
    const index = await buildIndex(dir, { exts: ['.md'], controlledDirs: ['controlled-dir'] });

    // node_modules is skipped.
    assert.ok(index.notes.every((n) => !n.rel.includes('node_modules')));
    assert.equal(index.notes.length, 3);

    const alpha = index.byRel.get('policies/alpha.md');
    const beta = index.byRel.get('notes/beta.md');
    const gamma = index.byRel.get('controlled-dir/gamma.md');
    assert.ok(alpha && beta && gamma);

    // frontmatter title wins over filename.
    assert.equal(alpha.title, 'Alpha Policy');

    // tags: inline #tag AND frontmatter tags both captured.
    assert.ok(alpha.tags.includes('security'));
    assert.ok(alpha.tags.includes('inline-tag'));

    // wikilinks → outlinks (only the body of alpha).
    assert.deepEqual(alpha.outlinks, ['Beta Note']);

    // headings → multiple chunks for alpha (Alpha Policy / Purpose / Scope).
    const alphaChunks = index.chunks.filter((c) => c.noteRel === 'policies/alpha.md');
    assert.ok(alphaChunks.length >= 2);
    assert.ok(alphaChunks.some((c) => c.heading === 'Purpose'));
    assert.ok(alphaChunks.some((c) => c.heading === 'Scope'));
  } finally {
    rmVault(dir);
  }
});

test('controlled flag from frontmatter authority AND from controlledDirs', async () => {
  const dir = mkVault(VAULT);
  try {
    const index = await buildIndex(dir, { exts: ['.md'], controlledDirs: ['controlled-dir'] });
    const alpha = index.byRel.get('policies/alpha.md');
    const beta = index.byRel.get('notes/beta.md');
    const gamma = index.byRel.get('controlled-dir/gamma.md');
    assert.equal(alpha.controlled, true);  // authority: controlled
    assert.equal(gamma.controlled, true);  // top-level folder in controlledDirs
    assert.equal(beta.controlled, false);  // neither
  } finally {
    rmVault(dir);
  }
});

test('inbound link counts resolve [[wikilinks]] by name or title', async () => {
  const dir = mkVault(VAULT);
  try {
    const index = await buildIndex(dir, { exts: ['.md'], controlledDirs: ['controlled-dir'] });
    const alpha = index.byRel.get('policies/alpha.md');
    const beta = index.byRel.get('notes/beta.md');
    assert.equal(beta.inbound, 1);  // linked from alpha via [[Beta Note]]
    assert.equal(alpha.inbound, 1); // linked from beta via [[Alpha Policy]]
  } finally {
    rmVault(dir);
  }
});
