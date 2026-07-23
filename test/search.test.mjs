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

test('stemming: morphological variants meet at one token, names pass through', async () => {
  const { stemOf } = await import('../lib/index.mjs');
  // the class of miss that once false-refused a deposition question
  assert.equal(stemOf('certify'), stemOf('certified'));
  assert.equal(stemOf('certify'), stemOf('certifies'));
  assert.equal(stemOf('policy'), stemOf('policies'));
  assert.equal(stemOf('scale'), stemOf('scaling'));
  assert.equal(stemOf('scale'), stemOf('scaled'));
  assert.equal(stemOf('run'), stemOf('running'));
  assert.equal(stemOf('bracket'), stemOf('brackets'));
  assert.equal(stemOf('tarp'), stemOf('tarped'));
  // names and short words untouched
  assert.equal(stemOf('okafor'), 'okafor');
  assert.equal(stemOf('jourdan'), 'jourdan');
  assert.equal(stemOf('gas'), 'gas');
  assert.equal(stemOf('api'), 'api');
});

test('stemming: query "certify" retrieves a document that only says "certified"', async () => {
  const { index, dir } = await idx({
    'okafor.md': `# QC Certification\n\nAdaeze Okafor inspected the lot and certified the coating thickness readings before shipment left the dock.\n`,
    'other.md': `# Shipping Schedule\n\nTrucks depart Tuesdays and Thursdays from the yard with standard freight paperwork attached.\n`,
  });
  try {
    const res = search(index, 'who certified the coating — can Okafor certify thickness?', { k: 5, strictness: 0.7 });
    assert.equal(res.weak, false, 'morphological variants must not cause refusal');
    assert.equal(res.hits[0].note, 'okafor.md');
    assert.ok(res.confidence > 0.6, `expected confident match, got ${res.confidence}`);
  } finally { rmVault(dir); }
});

test('hybrid gate: a hit that is neither semantically strong nor lexically substantiated refuses', async () => {
  // The blend defect: top lexical hit always has normalized BM25 = 1.0, so blended
  // score ≥ 0.55 — the old top-score gate was unreachable and hybrid could never
  // refuse. The two-signal gate must refuse when BOTH signals are weak.
  const { index, dir } = await idx({
    'a.md': `# Widget Assembly\n\nThe widget line assembles housings and gaskets on the second shift with torque checks.\n`,
    'b.md': `# Cafeteria Menu\n\nSoup and sandwiches are served from eleven to two on weekdays in the annex.\n`,
  });
  try {
    const sem = new Float64Array(index.chunks.length).fill(0.2); // nothing semantically close
    // query shares ONE common word ("widget") but its distinctive terms are absent
    const r = search(index, 'widget litigation from the Zorbex acquisition dispute', { k: 5, semScores: sem, strictness: 0.5 });
    assert.equal(r.mode, 'hybrid');
    assert.equal(r.weak, true, 'weak-sem + weak-info must refuse');
    // same corpus, a genuinely semantic match (high cosine, no term overlap) must PASS
    const semHigh = new Float64Array(index.chunks.length).fill(0.2);
    semHigh[0] = 0.75;
    const r2 = search(index, 'lunch options midday', { k: 5, semScores: semHigh, strictness: 0.5 });
    assert.equal(r2.weak, false, 'strong semantic signal alone must be enough');
    // and a lexically substantiated match with mediocre semantics must PASS
    const r3 = search(index, 'widget assembly torque checks', { k: 5, semScores: sem, strictness: 0.5 });
    assert.equal(r3.weak, false, 'strong info-share alone must be enough');
    assert.ok(r3.confidence > r.confidence, 'substantiated confidence must beat unsubstantiated');
  } finally { rmVault(dir); }
});

test('phrase proximity: the verbatim phrase outranks scattered words', async () => {
  const { index, dir } = await idx({
    'scattered.md': `# Paint Notes\n\nThe white paint had some rust stains near the edge. White primer covers rust poorly, and white surfaces show rust marks; rust and white contrast strongly.\n`,
    'phrase.md': `# Corrosion Report\n\nInspection found white rust on pallets two and five, consistent with moisture exposure under a failed tarp.\n`,
  });
  try {
    const res = search(index, 'white rust', { k: 5 });
    assert.equal(res.hits[0].note, 'phrase.md', 'the exact phrase must beat higher term frequency');
  } finally { rmVault(dir); }
});

test('phrase proximity: stopword pairs never form bigrams (no uniform boost)', async () => {
  const { index, dir } = await idx({
    'a.md': `# Alpha\n\nThe report of the committee covers budget planning in the annex building.\n`,
    'b.md': `# Beta\n\nBudget planning documents are stored with the finance team records.\n`,
  });
  try {
    // "of the" appears verbatim in a.md; it must not boost a.md over the better match
    const res = search(index, 'budget planning of the finance team', { k: 5 });
    assert.equal(res.hits[0].note, 'b.md');
  } finally { rmVault(dir); }
});
