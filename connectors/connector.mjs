// CAIRN connector contract + registry. A connector is the thin adapter that turns
// some external knowledge source (a folder, Confluence, SharePoint, a REST API)
// into a stream of normalized Documents (see core/document.mjs). The rest of CAIRN
// — indexer, stores, audit — only ever sees Documents, never the source. Pure Node.
//
// A connector is a plain object shaped like:
//   {
//     name: string,                      // stable id, e.g. "filesystem" | "confluence"
//     async *documents(),                // async generator yielding makeDocument() results
//     async healthcheck(),               // → { ok: boolean, detail: string }
//   }
// documents() is a *stream* (async generator) so a connector can page through a
// large/remote source without holding every Document in memory at once.

// name -> factory(config) -> connector. Factories are lazy so importing a connector
// module (which registers itself) costs nothing until you actually build one.
const registry = new Map();

/**
 * Register a connector factory under a name.
 * @param {string} name
 * @param {(config?: object) => { name: string, documents: () => AsyncGenerator, healthcheck: () => Promise<{ok:boolean, detail:string}> }} factory
 */
export function registerConnector(name, factory) {
  if (typeof factory !== 'function') throw new TypeError(`connector factory for "${name}" must be a function`);
  registry.set(String(name), factory);
}

/**
 * Build a connector instance by name with the given config.
 * @param {string} name
 * @param {object} [config]
 * @returns a connector object ({ name, documents, healthcheck })
 */
export function getConnector(name, config = {}) {
  const factory = registry.get(String(name));
  if (!factory) throw new Error(`unknown connector: "${name}" (registered: ${[...registry.keys()].join(', ') || 'none'})`);
  const conn = factory(config);
  // Sanity-check the contract so a broken factory fails loudly at build time.
  if (!conn || typeof conn.documents !== 'function' || typeof conn.healthcheck !== 'function') {
    throw new TypeError(`connector "${name}" factory did not return a valid connector`);
  }
  if (!conn.name) conn.name = String(name);
  return conn;
}

/** List registered connector names (handy for a CLI/UI). */
export function listConnectors() {
  return [...registry.keys()];
}

/**
 * Drain a connector's document stream into an array. Convenience for callers
 * (and tests) that want everything at once rather than streaming.
 */
export async function collectDocuments(connector) {
  const out = [];
  for await (const doc of connector.documents()) out.push(doc);
  return out;
}
