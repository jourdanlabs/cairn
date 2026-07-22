// The normalized Document — every connector (filesystem, Confluence, SharePoint,
// REST) maps its source into this one shape, so the ingestion pipeline, stores,
// and engines never care where a document came from. Pure Node, no deps.

import { createHash } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(String(s ?? '')).digest('hex');

// A stable, source-namespaced id, e.g. "confluence:SPACE/12345" or "filesystem:policies/x.md".
export const docId = (source, key) => `${source}:${key}`;

/**
 * Normalize raw fields into a Document. Fills defaults and computes contentHash.
 * @param {object} d
 * @param {string} d.source      connector name, e.g. "filesystem" | "confluence"
 * @param {string} d.key         source-local key/path/page-id (namespaced into id)
 * @param {string} d.title
 * @param {string} d.body        text/markdown content
 * @param {string} [d.uri]       canonical link back to the source
 * @param {object} [d.metadata]  arbitrary source metadata (space, author, …)
 * @param {string[]} [d.tags]
 * @param {string[]} [d.links]   outbound references (titles or ids)
 * @param {boolean} [d.controlled] authoritative/governing document
 * @param {string|null} [d.authority]
 * @param {string|null} [d.version]
 * @param {number} [d.updatedAt] ms-epoch last-modified (source mtime/modified)
 */
export function makeDocument(d) {
  const body = String(d.body ?? '');
  const source = String(d.source || 'unknown');
  const key = String(d.key ?? d.uri ?? d.title ?? '');
  return {
    id: docId(source, key),
    source,
    key,
    uri: d.uri || null,
    title: String(d.title || key || 'Untitled').trim(),
    body,
    metadata: d.metadata && typeof d.metadata === 'object' ? d.metadata : {},
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    links: Array.isArray(d.links) ? d.links.map(String) : [],
    controlled: Boolean(d.controlled),
    authority: d.authority ?? null,
    version: d.version != null ? String(d.version) : null,
    updatedAt: Number.isFinite(d.updatedAt) ? d.updatedAt : Date.now(),
    contentHash: sha256(body),
  };
}

// True if `next` is a genuine content change vs `prev` (drives incremental sync).
export function isChanged(prev, next) {
  return !prev || prev.contentHash !== next.contentHash;
}
