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

test('confidence gate: distinctive absent terms force a refusal even when a common word matches', async () => {
  // The regression: "Zenith Corp v. Balfour" against a corpus that has none of those
  // distinctive terms used to score confidence 1.0 off one common matched word (ranking
  // boosts blew past the old normalization ceiling and min(1,·) clamped). Lexical
  // confidence is now the idf-weighted share of query information found in the top
  // passage — it must stay LOW and the gate must refuse.
  const { index, dir } = await idx({
    'complaint.md': `# Complaint\n\nThe court will hold a hearing. The plaintiff filed its complaint with the court and the court set a schedule for the parties.\n`,
    'answer.md': `# Answer\n\nDefendant answers the complaint and denies the allegations before the court.\n`,
  });
  try {
    const res = search(index, 'What did the court hold in Zenith Corp v. Balfour?', { k: 5, strictness: 0.7 });
    assert.ok(res.confidence < 0.5, `absent distinctive terms must cap confidence, got ${res.confidence}`);
    assert.equal(res.weak, true, 'the gate must refuse a query whose distinctive terms are nowhere in the corpus');

    // Control: a query whose terms ARE the corpus answers with high confidence.
    const ok = search(index, 'court complaint hearing', { k: 5, strictness: 0.7 });
    assert.equal(ok.weak, false);
    assert.ok(ok.confidence > 0.8, `on-corpus query must be confident, got ${ok.confidence}`);
  } finally { rmVault(dir); }
});
