// lib/search.mjs — BM25 retrieval with structural boosts + a weak-match refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../lib/index.mjs';
import { search } from '../lib/search.mjs';
import { mkVault, rmVault } from './helpers.mjs';

async function idx(files) {
  const dir = mkVault(files);
  const index = await buildIndex(dir, { exts: ['.md'] });
  return { index, dir };
}

test('on-topic query ranks the right note to the top; hits carry expected shape', async () => {
  const { index, dir } = await idx({
    'k8s.md': `---
title: Kubernetes Scaling
---
# Kubernetes Scaling

## Horizontal Pod Autoscaler

The kubernetes scheduler scales pods by cpu. Kubernetes deployments manage replica pods across cluster nodes.
`,
    'pasta.md': `# Pasta Recipe\n\nBoil water, add tomatoes and basil, simmer the sauce, serve with cheese and herbs.\n`,
    'budget.md': `# Quarterly Budget\n\nTrack invoices, expenses, revenue and forecasts each quarter for the finance team here.\n`,
  });
  try {
    const res = search(index, 'kubernetes pod scaling', { k: 5 });
    assert.equal(res.weak, false);
    assert.ok(res.hits.length >= 1);
    assert.equal(res.hits[0].note, 'k8s.md');

    const h = res.hits[0];
    assert.equal(typeof h.note, 'string');
    assert.equal(typeof h.score, 'number');
    assert.equal(typeof h.snippet, 'string');
    assert.match(h.coverage, /^\d+\/\d+$/);
    assert.ok(h.snippet.length > 0);
  } finally { rmVault(dir); }
});

test('a term in the note TITLE boosts it above a body-only match', async () => {
  // Both notes contain "ledger" once in the body; only one also has it in its title.
  const { index, dir } = await idx({
    'withtitle.md': `---
title: Ledger Integrity
---
# Ledger Integrity

The record keeps a signed hash chain of every ledger entry for later review.
`,
    'notitle.md': `---
title: General Notes
---
# General Notes

The record keeps a signed hash chain of every ledger entry for later review.
`,
  });
  try {
    const res = search(index, 'ledger', { k: 5 });
    assert.equal(res.hits[0].note, 'withtitle.md');
    assert.ok(res.hits.some((h) => h.note === 'notitle.md'));
  } finally { rmVault(dir); }
});

test('a term in a HEADING boosts it above a body-only match', async () => {
  const { index, dir } = await idx({
    'heading.md': `---
title: Runbook
---
# Runbook

## Rollback Procedure

Steps to revert a bad release safely and restore the prior known-good state.
`,
    'body.md': `---
title: Diary
---
# Diary

Yesterday we performed a rollback after the release went sideways during the window.
`,
  });
  try {
    const res = search(index, 'rollback', { k: 5 });
    assert.equal(res.hits[0].note, 'heading.md');
  } finally { rmVault(dir); }
});

test('a nonsense query returns weak:true with no hits', async () => {
  const { index, dir } = await idx({
    'k8s.md': `# Kubernetes\n\nThe kubernetes scheduler scales pods across the cluster nodes automatically.\n`,
  });
  try {
    const res = search(index, 'zzqqx wobbleflux gribnark', { k: 5 });
    assert.equal(res.weak, true);
    assert.equal(res.hits.length, 0);
  } finally { rmVault(dir); }
});

test('an empty/all-stopword query is weak with no query terms', async () => {
  const { index, dir } = await idx({
    'k8s.md': `# Kubernetes\n\nThe kubernetes scheduler scales pods across the cluster nodes automatically.\n`,
  });
  try {
    const res = search(index, 'the and of', { k: 5 });
    assert.equal(res.weak, true);
    assert.deepEqual(res.qterms, []);
    assert.equal(res.hits.length, 0);
  } finally { rmVault(dir); }
});
