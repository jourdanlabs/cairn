// Phase 5 — auth/RBAC: keys, roles, OIDC hook, open/closed modes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAuth, loadApiKeys, permissionFor, PERMISSIONS } from '../core/auth.mjs';

const keysEnv = { CAIRN_API_KEYS: 'k-admin:admin:Alice,k-analyst:analyst:Bob,k-view:viewer:Cy' };

test('loadApiKeys parses key:role:name', () => {
  const m = loadApiKeys(keysEnv);
  assert.equal(m.size, 3);
  assert.deepEqual(m.get('k-admin'), { name: 'Alice', role: 'admin' });
  assert.equal(m.get('k-view').role, 'viewer');
});

test('closed mode: authenticate + RBAC', async () => {
  const auth = makeAuth({ env: keysEnv });
  assert.equal(auth.open, false);

  const admin = await auth.authenticate({ headers: { authorization: 'Bearer k-admin' } });
  const viewer = await auth.authenticate({ headers: { 'x-api-key': 'k-view' } });
  assert.equal(admin.role, 'admin');
  assert.equal(viewer.role, 'viewer');
  assert.equal(await auth.authenticate({ headers: {} }), null);

  assert.equal(auth.authorize(viewer, 'search'), true);
  assert.equal(auth.authorize(viewer, 'integrity'), false);       // viewer < analyst
  const analyst = await auth.authenticate({ headers: { authorization: 'Bearer k-analyst' } });
  assert.equal(auth.authorize(analyst, 'integrity'), true);
  assert.equal(auth.authorize(analyst, 'reindex'), false);        // analyst < admin
  assert.equal(auth.authorize(admin, 'reindex'), true);
});

test('gate returns 401/403/200 correctly', async () => {
  const auth = makeAuth({ env: keysEnv });
  assert.equal((await auth.gate({ headers: {} }, 'search')).status, 401);
  assert.equal((await auth.gate({ headers: { authorization: 'Bearer k-view' } }, 'reindex')).status, 403);
  const ok = await auth.gate({ headers: { authorization: 'Bearer k-admin' } }, 'reindex');
  assert.equal(ok.ok, true);
  assert.equal(ok.principal.role, 'admin');
});

test('open mode when no keys (local default) allows everything', async () => {
  const auth = makeAuth({ env: {} });
  assert.equal(auth.open, true);
  assert.equal((await auth.gate({ headers: {} }, 'reindex')).ok, true);
});

test('OIDC-ready: custom verifyBearer supplies the principal', async () => {
  const auth = makeAuth({
    env: { CAIRN_AUTH: 'closed' },
    verifyBearer: async (t) => (t === 'jwt-good' ? { name: 'sso-user', role: 'analyst' } : null),
  });
  assert.equal(auth.open, false);
  const p = await auth.authenticate({ headers: { authorization: 'Bearer jwt-good' } });
  assert.equal(p.role, 'analyst');
  assert.equal(await auth.authenticate({ headers: { authorization: 'Bearer nope' } }), null);
});

test('permissionFor maps routes; deny-by-default', () => {
  assert.equal(permissionFor('POST', '/api/integrity'), 'integrity');
  assert.equal(permissionFor('POST', '/api/reindex'), 'reindex');
  assert.equal(permissionFor('POST', '/api/consolidate'), 'manage');
  assert.equal(permissionFor('GET', '/api/ledger'), 'audit');
  assert.equal(permissionFor('GET', '/api/cards'), 'report_read');
  assert.equal(permissionFor('GET', '/api/unknown'), null);
  assert.ok(PERMISSIONS.reindex === 'admin');
});
