// CAIRN indexer — walk an Obsidian vault, parse each note (frontmatter, headings,
// [[wikilinks]], #tags), and chunk by heading. Pure Node, no deps. The index is
// built in memory at startup and drives search + audit. Nothing leaves the box.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, basename, sep } from 'node:path';

const STOP = new Set('a an the and or but if then else of to in on at by for with without from into over under is are was were be been being this that these those it its as we you they i he she them his her their our your my me not no do does did will would can could should has have had about after before between out up down off so than too very just also only more most some any each other'.split(' '));

export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[`*_>#\[\]()~|]/g, ' ')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && t.length < 40 && !STOP.has(t));
}

// Directories that are never knowledge — skip them so CAIRN can be pointed at a
// whole project tree (~/projects) to find forgotten work, not just an Obsidian vault.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.obsidian', '.cache', 'dist', 'build', 'out', '.next',
  '__pycache__', 'venv', '.venv', 'env', 'coverage', 'target', 'vendor', '.Trash',
  'Library', '.svn', '.idea', '.vscode', 'tmp', '.turbo', '.parcel-cache',
]);

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

// Split a note body into heading-scoped chunks, tracking the heading breadcrumb.
function chunkByHeading(body, meta) {
  const lines = body.split(/\r?\n/);
  const chunks = [];
  const stack = []; // {level, title}
  let cur = { heading: '', headingPath: [], lines: [] };
  const flush = () => {
    const text = cur.lines.join('\n').trim();
    if (text) chunks.push({ heading: cur.heading, headingPath: cur.headingPath.slice(), text });
  };
  for (const line of lines) {
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      const level = h[1].length;
      const title = h[2].replace(/[#*`]/g, '').trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, title });
      cur = { heading: title, headingPath: stack.map((s) => s.title), lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  flush();
  // A note with no headings → one chunk under the note title.
  if (!chunks.length) chunks.push({ heading: '', headingPath: [], text: body.trim() });
  return chunks.map((c) => ({ ...c, ...meta }));
}

export async function buildIndex(vaultDir, { exts } = {}) {
  const extSet = new Set((exts && exts.length ? exts : ['.md', '.markdown']).map((e) => e.toLowerCase()));
  const files = await walk(vaultDir, extSet);
  const notes = [];
  const chunks = [];
  const byName = new Map(); // lowercased basename -> note

  for (const path of files) {
    let raw, st;
    try { raw = await readFile(path, 'utf8'); st = await stat(path); } catch { continue; }
    const rel = relative(vaultDir, path);
    const name = basename(path, extname(path));
    const { fm, body } = parseFrontmatter(raw);
    const h1 = body.match(/^#\s+(.+)$/m);
    const title = (fm.title || (h1 && h1[1]) || name).replace(/[#*`]/g, '').trim();
    const tags = extractTags(raw, fm);
    const outlinks = extractLinks(body);
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    const openTasks = (body.match(/^\s*[-*]\s+\[ \]/gm) || []).length;
    const hasMarkers = /\b(TODO|FIXME|XXX|DRAFT|WIP)\b|\?\?\?/.test(body);

    const note = {
      rel, name, title, tags, outlinks,
      mtimeMs: st.mtimeMs, wordCount, openTasks, hasMarkers,
      folder: rel.split(sep).slice(0, -1).join('/'),
      stub: wordCount < 12,
      inbound: 0,
    };
    notes.push(note);
    byName.set(name.toLowerCase(), note);
    byName.set(title.toLowerCase(), note);

    for (const c of chunkByHeading(body, { noteRel: rel, noteTitle: title, tags, mtimeMs: st.mtimeMs })) {
      const tokens = tokenize(`${title} ${c.heading} ${c.text}`);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      chunks.push({
        id: chunks.length,
        noteRel: c.noteRel, noteTitle: c.noteTitle,
        heading: c.heading, headingPath: c.headingPath,
        text: c.text.slice(0, 1600), tags: c.tags, mtimeMs: c.mtimeMs,
        tf, len: tokens.length,
      });
    }
  }

  // Inbound link counts (resolve [[name]] by basename/title).
  for (const n of notes) {
    for (const l of n.outlinks) {
      const target = byName.get(l.toLowerCase());
      if (target && target !== n) target.inbound++;
    }
  }

  // Document frequencies for BM25.
  const df = new Map();
  for (const c of chunks) for (const t of c.tf.keys()) df.set(t, (df.get(t) || 0) + 1);
  const avgLen = chunks.reduce((s, c) => s + c.len, 0) / (chunks.length || 1);

  const byRel = new Map(notes.map((n) => [n.rel, n]));
  return { vaultDir, notes, chunks, byName, byRel, df, avgLen, N: chunks.length, builtAt: new Date().toISOString() };
}
