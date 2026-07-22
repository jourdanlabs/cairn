// Confluence Cloud connector — stream every page in the configured spaces as a
// normalized Document. Uses the Confluence Cloud REST API v2:
//   pages:  GET {baseUrl}/wiki/api/v2/pages?limit=100&body-format=storage   (cursor-paginated)
//   labels: GET {baseUrl}/wiki/api/v2/pages/{id}/labels
//   spaces: GET {baseUrl}/wiki/api/v2/spaces?keys=…   (only to resolve spaceKeys→ids)
// Auth is HTTP Basic with `email:token` (an Atlassian API token), base64-encoded.
//
// LIVE: requires a Confluence Cloud tenant + API token; run healthcheck() to confirm creds.
//
// The HTTP layer is injectable via config.fetchImpl (defaults to global fetch) so
// the connector can be driven against fixtures with no network — see
// test/confluence.test.mjs. Zero deps.

import { makeDocument } from '../core/document.mjs';
import { registerConnector } from './connector.mjs';
import { storageToText, extractWikilinks } from './confluence-body.mjs';

const API = '/wiki/api/v2';

/**
 * Build a Confluence Cloud connector.
 * @param {object} config
 * @param {string} config.baseUrl              tenant base, e.g. "https://acme.atlassian.net"
 * @param {string} config.email                Atlassian account email (Basic auth user)
 * @param {string} config.token                Atlassian API token (Basic auth pass)
 * @param {string[]} [config.spaceKeys]        restrict to these space keys (empty = all)
 * @param {string[]} [config.controlledLabels] labels that mark a page "controlled"
 * @param {typeof fetch} [config.fetchImpl]    injectable fetch (default: global fetch)
 */
export function makeConfluenceConnector(config = {}) {
  const baseUrl = String(config.baseUrl || '').replace(/\/+$/, ''); // no trailing slash
  const email = config.email || '';
  const token = config.token || '';
  const spaceKeys = (config.spaceKeys || []).map(String).filter(Boolean);
  const controlledLabels = new Set((config.controlledLabels || ['controlled', 'policy', 'standard']).map((s) => String(s).toLowerCase()));
  const fetchImpl = config.fetchImpl || globalThis.fetch;

  // What's missing, if anything, to make authenticated calls.
  const missing = () => ['baseUrl', 'email', 'token'].filter((k) => !({ baseUrl, email, token }[k]));
  const authHeader = () => 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');

  // Resolve a v2 `_links.next` (an absolute-path cursor URL) against the tenant.
  const absolutize = (next) => (/^https?:\/\//.test(next) ? next : baseUrl + next);

  // One authenticated GET → parsed JSON. Throws on a non-2xx so callers/healthcheck
  // can surface the status.
  async function getJSON(url) {
    if (typeof fetchImpl !== 'function') throw new Error('no fetch available: pass config.fetchImpl or run on Node 18+');
    const res = await fetchImpl(url, { headers: { Authorization: authHeader(), Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Confluence API ${res.status} ${res.statusText || ''} for ${url}`.trim());
    return res.json();
  }

  // spaceKeys → numeric space ids (v2 pages filters by id, not key). No keys = no filter.
  async function resolveSpaceIds() {
    if (!spaceKeys.length) return [];
    const qs = new URLSearchParams();
    for (const k of spaceKeys) qs.append('keys', k);
    const data = await getJSON(`${baseUrl}${API}/spaces?${qs}`);
    return (data.results || []).map((s) => String(s.id));
  }

  // All label names on a page (lowercased for stable matching/tagging).
  async function fetchLabels(pageId) {
    const data = await getJSON(`${baseUrl}${API}/pages/${pageId}/labels`);
    return (data.results || []).map((l) => String(l.name || '').toLowerCase()).filter(Boolean);
  }

  // Map one v2 page (+ its labels) → a normalized Document.
  async function toDocument(page) {
    const labels = await fetchLabels(page.id);
    const controlled = labels.some((l) => controlledLabels.has(l));
    const storage = page.body?.storage?.value || '';
    const body = storageToText(storage);
    const webui = page._links?.webui || '';
    const createdAt = page.version?.createdAt;

    return makeDocument({
      source: 'confluence',
      key: String(page.id),                     // page id is the source-local key
      title: page.title,
      body,
      uri: webui ? `${baseUrl}/wiki${webui}` : null,
      metadata: {
        spaceId: page.spaceId ?? null,
        status: page.status ?? null,
        authorId: page.authorId ?? page.version?.authorId ?? null,
        labels,
      },
      tags: labels,
      links: extractWikilinks(body),            // [[Title]] links harvested from ac:link
      controlled,
      authority: controlled ? 'controlled' : null,
      version: page.version?.number ?? null,
      updatedAt: createdAt ? Date.parse(createdAt) : undefined,
    });
  }

  return {
    name: 'confluence',

    async *documents() {
      const gaps = missing();
      if (gaps.length) throw new Error(`confluence connector not configured: missing ${gaps.join(', ')}`);

      const spaceIds = await resolveSpaceIds();
      const qs = new URLSearchParams({ limit: '100', 'body-format': 'storage' });
      for (const id of spaceIds) qs.append('space-id', id);

      // Cursor pagination: follow _links.next until it's absent.
      let url = `${baseUrl}${API}/pages?${qs}`;
      while (url) {
        const data = await getJSON(url);
        for (const page of data.results || []) yield await toDocument(page);
        const next = data._links?.next;
        url = next ? absolutize(next) : null;
      }
    },

    async healthcheck() {
      const gaps = missing();
      if (gaps.length) return { ok: false, detail: `not configured: missing ${gaps.join(', ')}` };
      try {
        // Cheapest authenticated probe: ask for a single page.
        await getJSON(`${baseUrl}${API}/pages?limit=1`);
        return { ok: true, detail: `authenticated to ${baseUrl} as ${email}` };
      } catch (err) {
        return { ok: false, detail: String(err.message || err) };
      }
    },
  };
}

registerConnector('confluence', makeConfluenceConnector);

export default makeConfluenceConnector;
