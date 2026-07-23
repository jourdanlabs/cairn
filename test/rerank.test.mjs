// lib/rerank.mjs — model-assisted reranking must be strictly fail-open: it may only
// ever reorder, and any malfunction returns the original retrieval order untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { rerankHits, parseScores, rerankPrompt } from '../lib/rerank.mjs';

const HITS = [
  { id: 0, note: 'a.md', score: 3.0, snippet: 'general background about shipping' },
  { id: 1, note: 'b.md', score: 2.5, snippet: 'unrelated cafeteria menu' },
  { id: 2, note: 'c.md', score: 2.0, snippet: 'the crates were opened on March 12' },
];
const textOf = (h) => h.snippet;

test('rerank promotes the answer-bearing passage the retrieval ranked last', async () => {
  const chatFn = async () => '{"scores":[3, 0, 9]}';
  const { hits, reranked } = await rerankHits('when were the crates opened', HITS, textOf, chatFn);
  assert.equal(reranked, true);
  assert.equal(hits[0].note, 'c.md');
  assert.equal(hits[0].rr, 9);
  assert.equal(hits[2].note, 'b.md');
});

test('rerank is fail-open: malformed model output returns original order', async () => {
  for (const bad of ['not json', '{"scores":[1,2]}', '{"scores":["a","b","c"]}', '{"wrong":true}']) {
    const { hits, reranked } = await rerankHits('q', HITS, textOf, async () => bad);
    assert.equal(reranked, false, `should fail open on: ${bad}`);
    assert.deepEqual(hits.map((h) => h.note), ['a.md', 'b.md', 'c.md']);
  }
  const { reranked } = await rerankHits('q', HITS, textOf, async () => { throw new Error('model down'); });
  assert.equal(reranked, false);
});

test('rerank skips tiny result sets and clamps out-of-range scores', async () => {
  const { reranked } = await rerankHits('q', HITS.slice(0, 2), textOf, async () => { throw new Error('must not be called'); });
  assert.equal(reranked, false);
  assert.deepEqual(parseScores('{"scores":[15, -3, 7]}', 3), [10, 0, 7]);
});

test('ties break by retrieval score, then original position (stable)', async () => {
  const chatFn = async () => '```json\n{"scores":[5, 5, 5]}\n```'; // also exercises fence-stripping
  const { hits, reranked } = await rerankHits('q', HITS, textOf, chatFn);
  assert.equal(reranked, true);
  assert.deepEqual(hits.map((h) => h.note), ['a.md', 'b.md', 'c.md']);
});

test('prompt lists passages in order with indices', () => {
  const msgs = rerankPrompt('the query', ['first passage', 'second passage']);
  const u = msgs.find((m) => m.role === 'user').content;
  assert.ok(u.includes('[0] first passage'));
  assert.ok(u.includes('[1] second passage'));
  assert.ok(u.indexOf('[0]') < u.indexOf('[1]'));
});
