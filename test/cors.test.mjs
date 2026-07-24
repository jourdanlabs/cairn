// CORS — off by default, allow-list only, never a wildcard. Drives the REAL server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = 'https://demo.example';

async function bootServer(extraEnv) {
  const vault = mkdtempSync(join(tmpdir(), 'cors-vault-'));
  writeFileSync(join(vault, 'note.md'), '# Note\n\nThe widget assembly line runs on Tuesdays.\n');
  const port = 4900 + Math.floor(Math.random() * 100);
  const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
    env: {
      ...process.env, PORT: String(port), HOST: '127.0.0.1',
      CAIRN_VAULT_DIR: vault, CAIRN_STATE_DIR: mkdtempSync(join(tmpdir(), 'cors-state-')),
      MODEL_BASE_URL: '', MODEL_NAME: '', MODEL_EMBED: '', MODEL_API_KEY: '', EMBEDDINGS: 'off', WATCH: 'off',
      ...extraEnv,
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return { child, base }; } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  child.kill();
  throw new Error('server did not boot');
}

test('allow-listed origin: preflight 204 + echoed origin; stranger origin gets nothing', async () => {
  const { child, base } = await bootServer({ CAIRN_CORS_ORIGINS: `${SITE}, https://second.example` });
  try {
    // preflight from the allowed site
    const pre = await fetch(`${base}/api/answer`, { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
    assert.match(pre.headers.get('access-control-allow-methods'), /POST/);
    assert.match(pre.headers.get('access-control-allow-headers'), /content-type/);

    // actual request: origin echoed (never *), body still served
    const r = await fetch(`${base}/api/status`, { headers: { origin: SITE } });
    assert.equal(r.headers.get('access-control-allow-origin'), SITE);
    assert.notEqual(r.headers.get('access-control-allow-origin'), '*');
    assert.equal((await r.json()).ready, true);

    // stranger origin: no CORS headers at all (browser blocks; server never wildcards)
    const bad = await fetch(`${base}/api/status`, { headers: { origin: 'https://evil.example' } });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);

    // stranger preflight is NOT answered with 204 — falls through as a normal request
    const badPre = await fetch(`${base}/api/status`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } });
    assert.notEqual(badPre.status, 204);
  } finally { child.kill(); }
});

test('default (no env): CORS fully off — no headers even for a polite origin', async () => {
  const { child, base } = await bootServer({});
  try {
    const r = await fetch(`${base}/api/status`, { headers: { origin: SITE } });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
  } finally { child.kill(); }
});
