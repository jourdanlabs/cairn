// CAIRN_PUBLIC_READONLY=1 → mutating routes 405; ask/search/verify/status/ledger stay up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bootServer, rmVault } from './helpers.mjs';

test('public readonly: mutating routes 405; read/ask paths stay 200', async () => {
  const { child, base, vault } = await bootServer({ CAIRN_PUBLIC_READONLY: '1' });
  try {
    const st = await (await fetch(`${base}/api/status`)).json();
    assert.equal(st.public_readonly, true);
    assert.equal(st.ready, true);

    const blocked = [
      '/api/preferences',
      '/api/consolidate',
      '/api/art/upload',
      '/api/connectors/ingest',
      '/api/reindex',
      '/api/surveillance',
    ];
    for (const path of blocked) {
      const r = await fetch(`${base}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entity: 'x', q: 'x', name: 'filesystem' }),
      });
      assert.equal(r.status, 405, `${path} should 405`);
      const body = await r.json();
      assert.match(body.error, /read-only/i);
    }

    const search = await fetch(`${base}/api/search`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'widget assembly' }),
    });
    assert.equal(search.status, 200);

    const ask = await fetch(`${base}/api/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: 'widget assembly' }),
    });
    assert.equal(ask.status, 200);
    const asked = await ask.json();
    assert.ok(asked.ledger, 'ask still seals a receipt under readonly');

    const verify = await fetch(`${base}/api/ledger/verify`);
    assert.equal(verify.status, 200);
    assert.equal((await verify.json()).ok, true);

    const led = await fetch(`${base}/api/ledger`);
    assert.equal(led.status, 200);

    const prefsGet = await fetch(`${base}/api/preferences`);
    assert.equal(prefsGet.status, 200, 'GET preferences is a read');
  } finally { child.kill(); rmVault(vault); }
});

test('without the flag, POST /api/preferences is not 405', async () => {
  const { child, base, vault } = await bootServer({});
  try {
    const r = await fetch(`${base}/api/preferences`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ theme: 'dark' }),
    });
    assert.equal(r.status, 200);
  } finally { child.kill(); rmVault(vault); }
});
