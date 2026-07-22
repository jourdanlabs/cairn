// Filesystem connector — walk a folder tree and emit one Document per Markdown
// file. This is CAIRN's reference connector and the local counterpart to the
// Confluence one: same output shape, no network. The parsing here is deliberately
// kept consistent with lib/index.mjs (frontmatter, #tags, [[wikilinks]], title
// resolution, controlled-doc detection) so the connector path and the legacy
// in-memory indexer agree on what a note *is* — they only differ in output
// (Documents vs. index rows). Pure Node, no deps.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, basename, sep, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeDocument } from '../core/document.mjs';
import { registerConnector } from './connector.mjs';

// Directories that are never knowledge — skip so a whole project tree can be
// pointed at without dragging in build junk. (Mirror of lib/index.mjs.)
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.obsidian', '.cache', 'dist', 'build', 'out', '.next',
  '__pycache__', 'venv', '.venv', 'env', 'coverage', 'target', 'vendor', '.Trash',
  'Library', '.svn', '.idea', '.vscode', 'tmp', '.turbo', '.parcel-cache',
]);

// Recursively collect files whose extension is in `exts`. Hidden files/dirs and
// SKIP_DIRS are pruned. Unreadable dirs are skipped rather than fatal.
async function walk(dir, exts, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) await walk(p, exts, out);
    else if (exts.has(extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

// --- Parsing (identical regexes to lib/index.mjs) -------------------------------

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { fm: {}, body: text };
  const fm = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (kv) fm[kv[1].toLowerCase()] = kv[2].trim();
  }
  return { fm, body: text.slice(m[0].length) };
}

function extractTags(text, fm) {
  const tags = new Set();
  for (const t of text.matchAll(/(?:^|\s)#([a-z0-9][a-z0-9/_-]+)/gi)) tags.add(t[1].toLowerCase());
  if (fm.tags) for (const t of fm.tags.replace(/[\[\]]/g, '').split(/[,\s]+/)) if (t) tags.add(t.toLowerCase());
  return [...tags];
}

function extractLinks(text) {
  const links = new Set();
  for (const m of text.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) links.add(m[1].trim());
  return [...links];
}

/**
 * Build a filesystem connector.
 * @param {object} config
 * @param {string} config.dir                folder tree to walk (required)
 * @param {string[]} [config.exts]           file extensions to include
 * @param {string[]} [config.controlledDirs] top-level folders whose files are "controlled"
 */
export function makeFilesystemConnector(config = {}) {
  const dir = config.dir;
  const extSet = new Set((config.exts && config.exts.length ? config.exts : ['.md', '.markdown']).map((e) => e.toLowerCase()));
  const ctrlDirs = new Set((config.controlledDirs || []).map((d) => String(d).trim()).filter(Boolean));

  return {
    name: 'filesystem',

    async *documents() {
      if (!dir) throw new Error('filesystem connector not configured: `dir` is required');
      const root = resolve(dir);
      const files = await walk(root, extSet);
      for (const path of files) {
        let raw, st;
        try { raw = await readFile(path, 'utf8'); st = await stat(path); } catch { continue; }

        const rel = relative(root, path);
        const name = basename(path, extname(path));
        const { fm, body } = parseFrontmatter(raw);
        const h1 = body.match(/^#\s+(.+)$/m);
        const title = (fm.title || (h1 && h1[1]) || name).replace(/[#*`]/g, '').trim();
        const tags = extractTags(raw, fm);          // scan raw so frontmatter #tags count too
        const links = extractLinks(body);

        // "Controlled" = authoritative/governing. A file is controlled if it says
        // so in frontmatter (authority/controlled/status) or lives directly under
        // a configured controlled top-level folder. (Mirror of lib/index.mjs.)
        const topFolder = rel.split(sep).length > 1 ? rel.split(sep)[0] : '';
        const authority = fm.authority ? fm.authority.trim() : null;
        const controlled =
          (authority || '').toLowerCase() === 'controlled' ||
          /^(true|yes)$/i.test(fm.controlled || '') ||
          (fm.status || '').toLowerCase() === 'controlled' ||
          ctrlDirs.has(topFolder);

        yield makeDocument({
          source: 'filesystem',
          key: rel,                               // relative path is the source-local key
          title,
          body,
          uri: pathToFileURL(path).href,          // file://… canonical link
          metadata: { folder: rel.split(sep).slice(0, -1).join('/'), name, frontmatter: fm },
          tags,
          links,
          controlled,
          authority,
          version: null,                          // filesystem has no version concept
          updatedAt: st.mtimeMs,
        });
      }
    },

    async healthcheck() {
      if (!dir) return { ok: false, detail: 'not configured: `dir` is required' };
      try {
        const st = await stat(dir);
        if (!st.isDirectory()) return { ok: false, detail: `not a directory: ${dir}` };
        return { ok: true, detail: `readable directory: ${resolve(dir)}` };
      } catch (err) {
        return { ok: false, detail: `cannot stat ${dir}: ${err.message}` };
      }
    },
  };
}

registerConnector('filesystem', makeFilesystemConnector);

export default makeFilesystemConnector;
