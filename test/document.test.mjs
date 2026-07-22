// core/document.mjs — normalized Document shape, hashing, change detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDocument, isChanged, sha256, docId } from '../core/document.mjs';

test('sha256 is deterministic hex and handles null → empty string', () => {
  assert.match(sha256('abc'), /^[a-f0-9]{64}$/);
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  // String(s ?? '') → null/undefined hash as the empty-string hash.
  const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  assert.equal(sha256(''), empty);
  assert.equal(sha256(null), empty);
  assert.equal(sha256(undefined), empty);
});

test('docId namespaces the key under the source', () => {
  assert.equal(docId('filesystem', 'policies/x.md'), 'filesystem:policies/x.md');
  assert.equal(docId('confluence', 'SPACE/12345'), 'confluence:SPACE/12345');
});

test('makeDocument fills defaults and computes contentHash + id', () => {
  const d = makeDocument({ source: 'filesystem', key: 'policies/x.md', title: '  Policy X  ', body: 'hello' });
  assert.equal(d.id, 'filesystem:policies/x.md');
  assert.equal(d.source, 'filesystem');
  assert.equal(d.key, 'policies/x.md');
  assert.equal(d.title, 'Policy X'); // trimmed
  assert.equal(d.body, 'hello');
  assert.equal(d.contentHash, sha256('hello'));
  assert.equal(d.contentHash, '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  // defaults
  assert.deepEqual(d.metadata, {});
  assert.deepEqual(d.tags, []);
  assert.deepEqual(d.links, []);
  assert.equal(d.controlled, false);
  assert.equal(d.authority, null);
  assert.equal(d.version, null);
  assert.equal(d.uri, null);
  assert.ok(Number.isFinite(d.updatedAt));
});

test('makeDocument coerces provided fields', () => {
  const d = makeDocument({
    source: 'confluence', key: 'K1', title: 'T', body: 'x',
    tags: ['a', 2], links: ['[[Other]]'], controlled: 1, authority: 'controlled',
    version: 3, updatedAt: 1700000000000, metadata: { space: 'ENG' }, uri: 'https://ex/1',
  });
  assert.deepEqual(d.tags, ['a', '2']);
  assert.deepEqual(d.links, ['[[Other]]']);
  assert.equal(d.controlled, true);
  assert.equal(d.authority, 'controlled');
  assert.equal(d.version, '3');
  assert.equal(d.updatedAt, 1700000000000);
  assert.deepEqual(d.metadata, { space: 'ENG' });
  assert.equal(d.uri, 'https://ex/1');
});

test('makeDocument key falls back to uri then title', () => {
  assert.equal(makeDocument({ source: 's', uri: 'u/1', title: 'T', body: '' }).key, 'u/1');
  assert.equal(makeDocument({ source: 's', title: 'Only Title', body: '' }).key, 'Only Title');
});

test('isChanged is true only when contentHash differs (or no prev)', () => {
  const a = makeDocument({ source: 's', key: 'k', title: 't', body: 'one' });
  const same = makeDocument({ source: 's', key: 'k', title: 't-renamed', body: 'one' });
  const diff = makeDocument({ source: 's', key: 'k', title: 't', body: 'two' });
  assert.equal(isChanged(null, a), true);      // no prev → changed
  assert.equal(isChanged(undefined, a), true);
  assert.equal(isChanged(a, same), false);     // body identical (title irrelevant)
  assert.equal(isChanged(a, diff), true);      // body differs
});
