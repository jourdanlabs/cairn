// The connector → Document → index path. Proves a non-filesystem source (here a
// Confluence-shaped Document) ingests into the same index that search/audit use,
// and that the reference filesystem connector round-trips through it end-to-end.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexDocuments } from '../lib/index.mjs';
import { makeDocument } from '../core/document.mjs';
import { getConnector, collectDocuments } from '../connectors/connector.mjs';
import '../connectors/filesystem.mjs'; // self-registers as "filesystem"

test('indexDocuments builds a searchable index from Documents', () => {
  const docs = [
    makeDocument({
      source: 'confluence', key: '1001', title: 'Data Retention Policy',
      body: '# Data Retention Policy\n\nRecords are kept for seven years then destroyed. See [[Security Standards]].',
      tags: ['policy'], links: ['Security Standards'], controlled: true, updatedAt: 1000,
    }),
    makeDocument({
      source: 'confluence', key: '1002', title: 'Security Standards',
      body: '# Security Standards\n\nEncryption at rest is required.', controlled: false, updatedAt: 2000,
    }),
  ];
  const index = indexDocuments(docs);
  assert.equal(index.notes.length, 2);

  const retention = index.byRel.get('1001');
  assert.equal(retention.controlled, true);
  assert.equal(retention.source, 'confluence');
  assert.ok(retention.tags.includes('policy'));

  // [[Security Standards]] resolves by title → inbound link on the standards note.
  const standards = index.byRel.get('1002');
  assert.equal(standards.inbound, 1);
  assert.ok(index.N >= 2); // chunks were produced
});

test('filesystem connector → indexDocuments end-to-end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cairn-fsconn-'));
  await mkdir(join(dir, 'policies'), { recursive: true });
  await writeFile(join(dir, 'policies', 'retention.md'), '---\nauthority: controlled\n---\n\n# Retention\n\nKeep records seven years then destroy them.');
  await writeFile(join(dir, 'notes.md'), '# Notes\n\nRandom meeting notes for the week.');

  const conn = getConnector('filesystem', { dir, controlledDirs: ['policies'] });
  const docs = await collectDocuments(conn);
  assert.ok(docs.length >= 2);

  const index = indexDocuments(docs);
  assert.ok(index.notes.some((n) => n.controlled), 'the controlled policy came through');
  assert.ok(index.notes.every((n) => n.source === 'filesystem'));
  assert.ok(index.N > 0);
});
