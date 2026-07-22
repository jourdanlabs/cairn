// CAIRN auth — API-key authentication + role-based authorization, OIDC-ready.
//
// Local/dev: no keys configured → open mode (everything allowed), so the single-user
// tool keeps working. Enterprise: set CAIRN_API_KEYS and it locks to authenticated,
// role-checked access. To wire the bank's SSO, pass a `verifyBearer(token)` that
// validates their OIDC/JWT and returns a principal — nothing else changes.

export const ROLES = ['viewer', 'analyst', 'admin'];
const RANK = { viewer: 1, analyst: 2, admin: 3 };

// permission → minimum role required
export const PERMISSIONS = {
  search: 'viewer', ask: 'viewer', report_read: 'viewer', verify: 'viewer',
  integrity: 'analyst', adjudicate: 'analyst', surveillance: 'analyst', audit: 'analyst',
  reindex: 'admin', manage: 'admin', connectors: 'admin',
};

// Map an HTTP method+path to the permission it needs (deny-by-default elsewhere).
export function permissionFor(method, path) {
  if (path === '/api/search') return 'search';
  if (path === '/api/answer') return 'ask';
  if (path === '/api/verify') return 'verify';
  if (path === '/api/integrity') return 'integrity';
  if (path === '/api/contradictions') return 'adjudicate';
  if (path === '/api/audit') return 'audit';
  if (path === '/api/ledger/verify') return 'audit';
  if (path === '/api/compliance/export') return 'audit';
  if (path === '/api/surveillance') return 'surveillance';
  if (path === '/api/reindex') return 'reindex';
  if (path.startsWith('/api/connectors')) return 'connectors';
  if (path === '/api/status') return 'report_read';
  if (path === '/api/obsidian-vaults') return 'report_read';
  if (path === '/api/art') return 'report_read';
  if (path === '/api/art/upload') return 'manage';
  if (path === '/api/preferences') return method === 'GET' ? 'report_read' : 'manage';
  return null; // non-API (static) — handled by the server, not gated here
}

// CAIRN_API_KEYS="key1:admin:Alice,key2:viewer:Bob"
export function loadApiKeys(env = process.env) {
  const map = new Map();
  for (const part of String(env.CAIRN_API_KEYS || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [key, role = 'viewer', ...name] = part.split(':');
    if (key && ROLES.includes(role)) map.set(key, { name: name.join(':') || 'api-key', role });
  }
  return map;
}

/**
 * @param {object} [o]
 * @param {Map<string,{name,role}>} [o.keys]
 * @param {(token:string)=>Promise<object|null>} [o.verifyBearer]  OIDC/JWT hook
 * @param {NodeJS.ProcessEnv} [o.env]
 */
export function makeAuth({ keys, verifyBearer, env = process.env } = {}) {
  const table = keys || loadApiKeys(env);
  // Open mode: forced by CAIRN_AUTH=open, or when no keys and no verifier are set
  // (the local single-user default). Closed mode requires a valid principal.
  const open = String(env.CAIRN_AUTH || '').toLowerCase() === 'open' || (table.size === 0 && !verifyBearer);
  const verify = verifyBearer || (async (token) => table.get(token) || null);

  return {
    open,
    async authenticate(req) {
      const h = req.headers || {};
      const authz = h.authorization || h.Authorization || '';
      const token = authz.startsWith('Bearer ') ? authz.slice(7) : (h['x-api-key'] || h['X-Api-Key'] || '');
      if (!token) return null;
      return verify(token);
    },
    authorize(principal, permission) {
      if (this.open) return true;
      if (!principal || !permission) return false;
      const need = PERMISSIONS[permission];
      return Boolean(need) && RANK[principal.role] >= RANK[need];
    },
    // Combined gate for a request; returns { ok, status, principal, reason }.
    async gate(req, permission) {
      if (this.open) return { ok: true, status: 200, principal: { name: 'local', role: 'admin' } };
      const principal = await this.authenticate(req);
      if (!principal) return { ok: false, status: 401, reason: 'authentication required' };
      if (!this.authorize(principal, permission)) return { ok: false, status: 403, principal, reason: `role '${principal.role}' lacks '${permission}'` };
      return { ok: true, status: 200, principal };
    },
  };
}

// An audit record for who-did-what. Point `sink` at a file or the receipt ledger.
export function auditRecord({ principal, method, path, permission, allowed, status }) {
  return {
    ts: new Date().toISOString(),
    principal: principal ? { name: principal.name, role: principal.role } : null,
    method, path, permission, allowed: Boolean(allowed), status,
  };
}
