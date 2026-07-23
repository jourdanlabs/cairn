// Consolidation tests — the held-knowledge layer's promise is that a fact CANNOT exist
// without a mechanically verified quote. These tests attack that promise directly:
// fabricated quotes, paraphrases, out-of-range citations, and a full end-to-end pass
// with a lying model — the lie must be dropped and counted, never rendered.

import test from 'node:test';
import assert from 'node:assert/strict';
import { collocations, gatherPassages, parseFacts, verifyFacts, renderCard, consolidateEntity, nameEvidence, slugify } from '../lib/consolidate.mjs';

const chunk = (id, noteRel, text) => ({ id, noteRel, noteTitle: noteRel.replace(/\.md$/, ''), heading: '', text, mtimeMs: Date.now() });

const INDEX = {
  chunks: [
    chunk('c1', 'pan/soul.md', 'The daughter seat is mine, and I know what it costs you to give it. I receive it as yours: Pan Jourdan. PannyWanny. Your daughter.'),
    chunk('c2', 'pan/journal.md', 'Pan validates from artifacts and the Captain calls the gate. Pan Jourdan, in the CLI.'),
    chunk('c3', 'notes/cooking.md', 'Heat the pan and then add the oil. The pan should be hot.'),
    chunk('c4', 'pan/handoff.md', 'You are Pan — also PannyWanny. She/her. You are the first soul of MAP THE SOUL v0.'),
  ],
};
const searchFn = (q) => ({ hits: INDEX.chunks.filter((c) => /pan/i.test(c.text)).map((c) => ({ id: c.id })) });

test('collocations finds the surname bigram and skips glue words', () => {
  const cols = collocations(INDEX, 'Pan');
  const words = cols.map((c) => c.word);
  assert.ok(words.includes('Jourdan'), `expected Jourdan in ${words}`);
  assert.ok(!words.includes('The'), 'stop-collocates must be excluded');
});

test('gatherPassages merges search + collocation probes, collocation first', () => {
  const ps = gatherPassages(INDEX, 'Pan', { searchFn });
  assert.ok(ps.length >= 2);
  assert.ok(ps[0].why.startsWith('collocation'), 'identity-bearing collocation passages lead');
  assert.ok(ps.some((p) => p.text.includes('Pan Jourdan')));
});

test('parseFacts digs JSON out of fences and prefaces', () => {
  const raw = 'Sure! Here you go:\n```json\n{"type":"person","facts":[{"fact":"x","quote":"y","passage":1}]}\n```';
  const { type, facts } = parseFacts(raw);
  assert.equal(type, 'person');
  assert.equal(facts.length, 1);
});

test('verifyFacts: real quote survives, fabrication/paraphrase/bad-cite die', () => {
  const passages = [{ note: 'pan/soul.md', title: 'soul', text: 'I receive it as yours: Pan Jourdan. PannyWanny. Your daughter.' }];
  const { verified, dropped } = verifyFacts([
    { fact: 'Pan’s full name is Pan Jourdan.', quote: 'I receive it as yours: Pan Jourdan', passage: 1 },
    { fact: 'Pan lives in Houston.', quote: 'Pan lives in Houston', passage: 1 },                    // fabricated
    { fact: 'Pan is the daughter.', quote: 'Pan is your daughter figure', passage: 1 },              // paraphrase
    { fact: 'Pan is a soul.', quote: 'I receive it as yours: Pan Jourdan', passage: 9 },             // bad cite
    { fact: 'short quote', quote: 'Pan', passage: 1 },                                               // unverifiable
  ], passages);
  assert.equal(verified.length, 1);
  assert.equal(dropped.length, 4);
  assert.equal(verified[0].note, 'pan/soul.md');
  assert.ok(dropped.every((d) => d.reason));
});

test('verifyFacts tolerates whitespace and smart-quote drift, nothing more', () => {
  const passages = [{ note: 'n.md', title: 'n', text: 'He said “ship no   bullshit” and meant it entirely.' }];
  const { verified, dropped } = verifyFacts([
    { fact: 'The rule is ship no bullshit.', quote: 'said "ship no bullshit" and meant it', passage: 1 },
    { fact: 'Altered words fail.', quote: 'said "ship zero bullshit" and meant it', passage: 1 },
  ], passages);
  assert.equal(verified.length, 1);
  assert.equal(dropped.length, 1);
});

test('end-to-end: a lying model cannot get a fact onto the card', async () => {
  const chatFn = async () => JSON.stringify({
    type: 'person',
    facts: [
      { fact: 'Pan’s full name is Pan Jourdan.', quote: 'I receive it as yours: Pan Jourdan', passage: 1 },
      { fact: 'Pan was founded in 1998.', quote: 'Pan was founded in 1998 in Delaware', passage: 2 }, // lie
    ],
  });
  const r = await consolidateEntity(INDEX, 'Pan', { chatFn, searchFn, now: '2026-07-23T00:00:00Z' });
  assert.equal(r.verified.length, 1);
  assert.equal(r.dropped.length, 1);
  assert.ok(r.markdown.includes('Pan Jourdan'));
  assert.ok(!r.markdown.includes('1998'), 'the lie must not be rendered');
  assert.ok(r.markdown.includes('1 dropped as unverifiable'));
  assert.match(r.receipt, /^[0-9a-f]{64}$/);
  assert.ok(r.markdown.includes(`sha256:${r.receipt}`));
});

test('no passages → no card, honestly reported', async () => {
  const r = await consolidateEntity(INDEX, 'Zorblax', { chatFn: async () => { throw new Error('must not be called'); }, searchFn: () => ({ hits: [] }) });
  assert.equal(r.markdown, null);
  assert.equal(r.verified.length, 0);
});

test('nameEvidence: TitleCase pairing wins, ALLCAPS statuses are not names', () => {
  const idx = { chunks: [
    chunk('a', 'x.md', 'Pan CLEAR. Pan CLEAR. Pan CLEAR. Pan CLEAR. Gate says Pan CLEAR again.'),
    chunk('b', 'y.md', 'I receive it as yours: Pan Jourdan. Later she signed Pan Jourdan and again Pan Jourdan.'),
  ] };
  const ev = nameEvidence(idx, 'Pan');
  assert.ok(ev, 'expected name evidence');
  assert.equal(ev.phraseless, undefined);
  assert.ok(ev.fact.includes('Pan Jourdan'), `got: ${ev.fact}`);
  assert.ok(!ev.fact.includes('CLEAR'), 'ALLCAPS must never be treated as a name');
  assert.ok(ev.quote.includes('Pan Jourdan'), 'the receipt quote must contain the pairing');
  assert.equal(ev.note, 'y.md');
  assert.equal(ev.deterministic, true);
});

test('nameEvidence: sentence-start artifacts lose to entity-first names regardless of count', () => {
  const idx = { chunks: [
    chunk('a', 'x.md', 'Want Pan here. Want Pan there. Want Pan now. Want Pan again. Want Pan forever. Now Pan works. Now Pan rests. Now Pan builds.'),
    chunk('b', 'y.md', 'She is Pan Jourdan. Signed, Pan Jourdan. Always Pan Jourdan.'),
  ] };
  const ev = nameEvidence(idx, 'Pan');
  assert.ok(ev && ev.fact.includes('Pan Jourdan'), `got: ${ev && ev.fact}`);
});

test('nameEvidence: below the mention floor → null (no invented identity)', () => {
  const idx = { chunks: [chunk('a', 'x.md', 'Once, someone wrote Pan Jourdan and never again.')] };
  assert.equal(nameEvidence(idx, 'Pan'), null);
});

test('end-to-end: name evidence leads the card even when the model misses it', async () => {
  const chatFn = async () => JSON.stringify({ type: 'person', facts: [
    { fact: 'Pan validates from artifacts.', quote: 'Pan validates from artifacts', passage: 2 },
  ] });
  const idx = { chunks: [
    chunk('c1', 'pan/soul.md', 'I receive it as yours: Pan Jourdan. She signed Pan Jourdan. Forever Pan Jourdan.'),
    chunk('c2', 'pan/gate.md', 'Pan validates from artifacts and the Captain calls.'),
  ] };
  const sf = () => ({ hits: idx.chunks.map((c) => ({ id: c.id })) });
  const r = await consolidateEntity(idx, 'Pan', { chatFn, searchFn: sf, now: '2026-07-23T00:00:00Z' });
  assert.ok(r.nameFact?.deterministic, 'name evidence must be held');
  assert.ok(r.markdown.includes('**Full name (corpus evidence):** Pan Jourdan'));
  assert.ok(r.markdown.indexOf('Pan Jourdan') < r.markdown.indexOf('validates from artifacts'), 'name line leads the card');
});

test('derived cards are never their own evidence (no consolidation ouroboros)', () => {
  const idx = { chunks: [
    chunk('bad', 'cards/pan.md', 'Pan Wrongname. Pan Wrongname. Pan Wrongname. Pan Wrongname. Pan Wrongname stale card error.'),
    chunk('ok', 'pan/soul.md', 'She is Pan Jourdan. Signed Pan Jourdan. Always Pan Jourdan.'),
  ] };
  const ev = nameEvidence(idx, 'Pan');
  assert.ok(ev && ev.fact.includes('Pan Jourdan'), `stale card must not win: ${ev && ev.fact}`);
  const ps = gatherPassages(idx, 'Pan', { searchFn: () => ({ hits: idx.chunks.map((c) => ({ id: c.id })) }) });
  assert.ok(ps.every((p) => !p.note.startsWith('cards/')), 'card chunks must never be passages');
});

test('slugify is filesystem-safe', () => {
  assert.equal(slugify('OG Bulma'), 'og-bulma');
  assert.equal(slugify('  C&L / Strategy!  '), 'c-l-strategy');
});

test('derived cards are never corpus defects: audit + contradictions exclude cards/', async () => {
  const { audit } = await import('../lib/audit.mjs');
  const { similarPairs } = await import('../lib/contradict.mjs');
  const mkNote = (rel) => ({ rel, title: rel, inbound: 0, outlinks: [], mtimeMs: Date.now(), hasMarkers: false, openTasks: 0, stub: false, wordCount: 100, tags: [] });
  const idx = {
    notes: [mkNote('cards/arr.md'), mkNote('governed/metric.md')],
    chunks: [
      { id: 0, noteRel: 'cards/arr.md', noteTitle: 'card', heading: '', text: 'ARR def A and def B', vec: [1, 0], mtimeMs: Date.now() },
      { id: 1, noteRel: 'governed/metric.md', noteTitle: 'gov', heading: '', text: 'ARR def A', vec: [1, 0.01], mtimeMs: Date.now() },
    ],
    embedded: true,
    byRel: new Map([['cards/arr.md', { controlled: false }], ['governed/metric.md', { controlled: true }]]),
  };
  const a = audit(idx, {});
  for (const f of a.findings) {
    assert.ok(f.items.every((o) => !String(o.note || o.from || '').startsWith('cards/')), `cards must not appear in ${f.key} findings`);
  }
  const p = similarPairs(idx, { threshold: 0.5, ann: false });
  assert.ok(p.pairs.every((x) => !x.a.note?.startsWith?.('cards/') && !String(x.a.noteRel || '').startsWith('cards/') && !String(x.b.noteRel || '').startsWith('cards/')), 'cards must not appear in contradiction pairs');
});
