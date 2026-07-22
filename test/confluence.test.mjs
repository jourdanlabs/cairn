// Connector tests. We can't hit a live Confluence tenant in CI, so the Confluence
// connector is driven against JSON fixtures via an injected fetchImpl. We also
// cover the filesystem connector over a tmp dir and the storage→text helper
// directly. Run: `node --test test/confluence.test.mjs`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeConfluenceConnector } from '../connectors/confluence.mjs';
import { makeFilesystemConnector } from '../connectors/filesystem.mjs';
import { collectDocuments } from '../connectors/connector.mjs';
import { storageToText, decodeEntities, extractWikilinks } from '../connectors/confluence-body.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FIX = join(here, 'fixtures', 'confluence');
const loadFixture = async (name) => JSON.parse(await readFile(join(FIX, name), 'utf8'));

// A fetch stand-in that routes Confluence Cloud v2 URLs to fixture files. Records
// every requested URL so tests can assert on paging/label calls if needed.
function makeFixtureFetch(seen = []) {
  const fn = async (url) => {
    seen.push(url);
    const { pathname } = new URL(url);
    const labels = pathname.match(/\/wiki\/api\/v2\/pages\/(\d+)\/labels$/);
    let body;
    if (labels) body = await loadFixture(`labels-${labels[1]}.json`);
    else if (/\/wiki\/api\/v2\/pages$/.test(pathname)) body = await loadFixture('pages.json');
    else throw new Error(`unexpected URL in test: ${url}`);
    return { ok: true, status: 200, statusText: 'OK', async json() { return body; } };
  };
  fn.seen = seen;
  return fn;
}

const baseConfig = () => ({
  baseUrl: 'https://acme.atlassian.net',
  email: 'me@acme.com',
  token: 'secret-token',
  fetchImpl: makeFixtureFetch(),
});

// --- Confluence connector over fixtures -----------------------------------------

test('confluence.documents() maps pages → Documents (title/uri/version/updatedAt)', async () => {
  const conn = makeConfluenceConnector(baseConfig());
  const docs = await collectDocuments(conn);
  assert.equal(docs.length, 3);

  const policy = docs.find((d) => d.key === '1001');
  assert.ok(policy, 'page 1001 present');
  assert.equal(policy.id, 'confluence:1001');
  assert.equal(policy.source, 'confluence');
  assert.equal(policy.title, 'Data Retention Policy');
  assert.equal(policy.uri, 'https://acme.atlassian.net/wiki/spaces/DEV/pages/1001/Data+Retention+Policy');
  assert.equal(policy.version, '3');
  assert.equal(policy.updatedAt, Date.parse('2026-05-01T10:00:00.000Z'));
  assert.match(policy.contentHash, /^[0-9a-f]{64}$/);
});

test('confluence body: headings, lists, entities preserved as text', async () => {
  const conn = makeConfluenceConnector(baseConfig());
  const docs = await collectDocuments(conn);
  const policy = docs.find((d) => d.key === '1001');

  assert.match(policy.body, /^# Data Retention Policy$/m);           // heading kept as text
  assert.match(policy.body, /^- Financial statements$/m);           // list item kept as text
  assert.match(policy.body, /^- Contracts & agreements$/m);         // &amp; decoded
  assert.match(policy.body, /retained for seven years\./);          // <strong> stripped, text kept

  const sec = docs.find((d) => d.key === '1002');
  assert.match(sec.body, /^## Security Standards$/m);               // h2 → ##
  assert.match(sec.body, /^- Encrypt data at rest$/m);             // <ol> items → bullets
});

test('confluence body: ac:link → [[wikilink]] populates links', async () => {
  const conn = makeConfluenceConnector(baseConfig());
  const docs = await collectDocuments(conn);

  const policy = docs.find((d) => d.key === '1001');
  assert.match(policy.body, /\[\[Security Standards\]\]/);
  assert.deepEqual(policy.links, ['Security Standards']);

  const sec = docs.find((d) => d.key === '1002');
  assert.deepEqual(sec.links, ['Data Retention Policy']);
});

test('confluence labels → tags and controlled flag', async () => {
  const conn = makeConfluenceConnector(baseConfig());
  const docs = await collectDocuments(conn);

  const policy = docs.find((d) => d.key === '1001');
  assert.deepEqual(policy.tags, ['policy', 'reviewed']);
  assert.equal(policy.controlled, true);                 // 'policy' ∈ controlledLabels
  assert.equal(policy.authority, 'controlled');

  const sec = docs.find((d) => d.key === '1002');
  assert.equal(sec.controlled, true);                    // 'standard' ∈ controlledLabels

  const onboarding = docs.find((d) => d.key === '1003');
  assert.deepEqual(onboarding.tags, ['howto', 'draft']);
  assert.equal(onboarding.controlled, false);            // no controlled label
  assert.equal(onboarding.authority, null);
  assert.match(onboarding.body, /Q&A topics/);           // Q&amp;A decoded
  assert.match(onboarding.body, /a <draft>\./);          // &lt;draft&gt; decoded
  assert.match(onboarding.body, /questions — this/); // numeric &#8212; → em dash
});

test('confluence: not configured → documents() throws, healthcheck ok:false', async () => {
  const conn = makeConfluenceConnector({}); // no baseUrl/email/token
  await assert.rejects(collectDocuments(conn), /not configured: missing baseUrl, email, token/);
  const hc = await conn.healthcheck();
  assert.equal(hc.ok, false);
  assert.match(hc.detail, /not configured/);
});

test('confluence: healthcheck ok:true with valid creds + fetch', async () => {
  const conn = makeConfluenceConnector(baseConfig());
  const hc = await conn.healthcheck();
  assert.equal(hc.ok, true);
  assert.match(hc.detail, /authenticated to https:\/\/acme\.atlassian\.net/);
});

// --- Filesystem connector over a tmp dir ----------------------------------------

test('filesystem.documents() over a tmp dir with a controlled frontmatter file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cairn-fs-'));
  try {
    await writeFile(join(dir, 'policy.md'),
      '---\ntitle: Data Policy\nauthority: controlled\ntags: [governance, retention]\n---\n' +
      '# Data Policy\n\nWe retain records. See [[Security Standards]]. #compliance\n');
    await writeFile(join(dir, 'note.md'), '# Just a Note\n\nHello world #casual\n');
    await mkdir(join(dir, 'standards'));
    await writeFile(join(dir, 'standards', 'sec.md'), '# Sec\n\nbody here\n');

    const conn = makeFilesystemConnector({ dir, controlledDirs: ['standards'] });
    assert.equal((await conn.healthcheck()).ok, true);

    const docs = await collectDocuments(conn);
    assert.equal(docs.length, 3);

    const policy = docs.find((d) => d.key === 'policy.md');
    assert.ok(policy);
    assert.equal(policy.source, 'filesystem');
    assert.equal(policy.id, 'filesystem:policy.md');
    assert.equal(policy.title, 'Data Policy');                 // from frontmatter
    assert.equal(policy.controlled, true);                     // authority: controlled
    assert.equal(policy.authority, 'controlled');
    assert.ok(policy.uri.startsWith('file://'));
    assert.deepEqual(policy.links, ['Security Standards']);
    assert.ok(policy.tags.includes('compliance'));             // #tag
    assert.ok(policy.tags.includes('governance'));             // frontmatter tag
    assert.ok(policy.tags.includes('retention'));
    assert.ok(Number.isFinite(policy.updatedAt));              // mtime

    const note = docs.find((d) => d.key === 'note.md');
    assert.equal(note.controlled, false);
    assert.equal(note.title, 'Just a Note');                   // from H1

    const sec = docs.find((d) => d.key === join('standards', 'sec.md'));
    assert.ok(sec, 'nested file present');
    assert.equal(sec.controlled, true);                        // via controlledDirs
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// --- storage XHTML → text helper (direct) ---------------------------------------

test('storageToText: headings, lists, ac:link', () => {
  assert.equal(storageToText('<h2>Title</h2>'), '## Title');
  assert.equal(storageToText('<h1>A</h1><h3>B</h3>'), '# A\n\n### B');

  const list = storageToText('<ul><li>alpha</li><li>beta</li></ul>');
  assert.match(list, /^- alpha$/m);
  assert.match(list, /^- beta$/m);

  const linked = storageToText('<p>see <ac:link><ri:page ri:content-title="Foo Bar" /></ac:link> now</p>');
  assert.match(linked, /see \[\[Foo Bar\]\] now/);
  assert.deepEqual(extractWikilinks(linked), ['Foo Bar']);
});

test('decodeEntities: named + numeric, amp-last (no double decode)', () => {
  assert.equal(decodeEntities('&amp;&lt;&gt;&quot;&#39;'), '&<>"\'');
  assert.equal(decodeEntities('&amp;lt;'), '&lt;');   // escaped entity, not double-decoded
  assert.equal(decodeEntities('a &#8212; b'), 'a — b');
});
