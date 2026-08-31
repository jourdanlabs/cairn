// CAIRN indexer — walk an Obsidian vault, parse each note (frontmatter, headings,
// [[wikilinks]], #tags), and chunk by heading. Pure Node, no deps. The index is
// built in memory at startup and drives search + audit. Nothing leaves the box.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, extname, basename, sep } from 'node:path';
import { makeDocument } from '../core/document.mjs';
import { extractText } from './extract.mjs';
import { ocrPdf } from './ocr.mjs';

// Binary document formats read as a Buffer + run through the zero-dep extractors
// (Office/PDF/RTF). Everything else is read as UTF-8 text (Markdown, .txt, .csv…).
const DOC_BINARY = new Set(['.docx', '.pptx', '.xlsx', '.pdf', '.rtf']);

const STOP = new Set('a an the and or but if then else of to in on at by for with without from into over under is are was were be been being this that these those it its as we you they i he she them his her their our your my me not no do does did will would can could should has have had about after before between out up down off so than too very just also only more most some any each other who what when where why how which whom whose many much'.split(' '));

// Porter-lite stemmer (steps 1a/1b/1c only — plurals, ed/ing with restoration, y→i).
// Applied symmetrically at index AND query time, so "certify" finds "certified",
// "policies" finds "policy", "scaling" finds "scaled" — the class of miss that once
// false-refused a fair deposition question. Deliberately conservative: no step-2+
// suffixes ("inspection"≠"inspect" is an accepted miss), names and short words pass
// through untouched, and the same function must be used everywhere or recall breaks.
const hasVowel = (s) => /[aeiouy]/.test(s);
export function stemOf(w) {
  if (w.length < 4) return w;
  let s = w;
  // 1a — plurals
  if (s.endsWith('sses')) s = s.slice(0, -2);
  else if (s.endsWith('ies')) s = s.slice(0, -2);
  else if (!s.endsWith('ss') && !s.endsWith('us') && !s.endsWith('is') && s.endsWith('s')) s = s.slice(0, -1);
  // 1b — ed / ing, with Porter's restorations
  let stripped = false;
  if (s.endsWith('eed')) { if (s.length > 5) s = s.slice(0, -1); }
  else if (s.endsWith('ed') && hasVowel(s.slice(0, -2))) { s = s.slice(0, -2); stripped = true; }
  else if (s.endsWith('ing') && hasVowel(s.slice(0, -3))) { s = s.slice(0, -3); stripped = true; }
  if (stripped) {
    if (/(at|bl|iz)$/.test(s)) s += 'e';                          // relat(ed) → relate
    else if (/([^aeiouylsz])\1$/.test(s)) s = s.slice(0, -1);     // runn(ing) → run
    else if (s.length <= 4 && /[^aeiou][aeiouy][^aeiouwxy]$/.test(s)) s += 'e'; // scal(ing) → scale
  }
  // 1c — terminal y → i (certify/certified/certifies all land on "certifi")
  if (s.endsWith('y') && s.length > 3 && hasVowel(s.slice(0, -1))) s = s.slice(0, -1) + 'i';
  return s.length >= 2 ? s : w;
}

export function tokenize(text) {
  const low = String(text || '').toLowerCase().replace(/[`*_>#\[\]()~|]/g, ' ');
  const tokens = low
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && t.length < 40 && !STOP.has(t))
    .map(stemOf);
  // Compound identifiers survive WHOLE: "ordinance 2026-11", "sop-300-12", "lc-6655".
  // Split apart, their fragments are corpus-common ("2026" is in every date) and a
  // fabricated identifier can sail through the confidence gate on its common parts.
  // The joined token is high-idf and distinctive: present for real IDs, absent for
  // invented ones — exactly the signal cite-or-refuse needs. Emitted alongside the
  // fragments (symmetric at index and query time), never instead of them.
  for (const m of low.matchAll(/[a-z0-9]+(?:-[a-z0-9]+)+/g)) {
    const c = m[0];
    if (c.length > 3 && c.length < 40 && /\d/.test(c)) tokens.push(c);
  }
  return tokens;
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

// Long sections (headingless transcripts, big policy sections) must NOT collapse into a
// single truncated chunk — that silently hides everything past the cap from retrieval
// while BM25 still ranks the note, so search "finds" a passage that can't contain the
// answer. Split at paragraph (then sentence) boundaries so every passage is real text.
const CHUNK_MAX = 1600, CHUNK_TARGET = 1200;
function splitLong(text) {
  if (text.length <= CHUNK_MAX) return [text];
  const parts = [];
  let rest = text;
  while (rest.length > CHUNK_MAX) {
    let cut = rest.lastIndexOf('\n\n', CHUNK_TARGET + 200);
    if (cut < CHUNK_TARGET / 2) cut = rest.lastIndexOf('. ', CHUNK_TARGET + 200);
    if (cut < CHUNK_TARGET / 2) cut = CHUNK_TARGET;
    const piece = rest.slice(0, cut + 1).trim();
    if (piece) parts.push(piece);
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

// Split a note body into heading-scoped chunks, tracking the heading breadcrumb.
function chunkByHeading(body, meta) {
  const lines = body.split(/\r?\n/);
  const chunks = [];
  const stack = []; // {level, title}
  let cur = { heading: '', headingPath: [], lines: [] };
  const flush = () => {
    const text = cur.lines.join('\n').trim();
    if (!text) return;
    const parts = splitLong(text);
    parts.forEach((t, i) => chunks.push({
      heading: parts.length > 1 && cur.heading ? `${cur.heading} · ${i + 1}` : cur.heading,
      headingPath: cur.headingPath.slice(), text: t,
    }));
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
  // A note with no headings → size-split chunks under the note title (a 9MB transcript
  // must become hundreds of real passages, not one truncated one).
  if (!chunks.length) for (const t of splitLong(body.trim())) chunks.push({ heading: '', headingPath: [], text: t });
  return chunks.map((c) => ({ ...c, ...meta }));
}

// A "record" is the source-agnostic pre-note: { rel, name, title, body, tags,
// outlinks, mtimeMs, controlled, authority, source }. buildIndex() produces them
// from files; indexDocuments() produces them from connector Documents. finishIndex()
// turns either into the one index shape that search + audit + integrity consume.
function finishIndex(records, { vaultDir = null } = {}) {
  const notes = [];
  const chunks = [];
  const byName = new Map(); // lowercased basename/title -> note

  for (const r of records) {
    const body = r.body;
    const wordCount = body.split(/\s+/).filter(Boolean).length;
    const openTasks = (body.match(/^\s*[-*]\s+\[ \]/gm) || []).length;
    const hasMarkers = /\b(TODO|FIXME|XXX|DRAFT|WIP)\b|\?\?\?/.test(body);
    const note = {
      rel: r.rel, name: r.name, title: r.title, tags: r.tags, outlinks: r.outlinks,
      mtimeMs: r.mtimeMs, wordCount, openTasks, hasMarkers,
      folder: r.rel.split('/').slice(0, -1).join('/'),
      stub: wordCount < 12,
      inbound: 0,
      controlled: r.controlled, authority: r.authority ?? null,
      source: r.source || 'filesystem',
      hasFrontmatter: Boolean(r.hasFrontmatter),
    };
    notes.push(note);
    byName.set(r.name.toLowerCase(), note);
    byName.set(r.title.toLowerCase(), note);

    for (const c of chunkByHeading(body, { noteRel: r.rel, noteTitle: r.title, tags: r.tags, mtimeMs: r.mtimeMs, controlled: r.controlled })) {
      const tokens = tokenize(`${r.title} ${c.heading} ${c.text}`);
      const tf = new Map();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      chunks.push({
        id: chunks.length,
        noteRel: c.noteRel, noteTitle: c.noteTitle,
        heading: c.heading, headingPath: c.headingPath,
        text: c.text.slice(0, 1600), tags: c.tags, mtimeMs: c.mtimeMs,
        controlled: c.controlled,
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

export async function buildIndex(vaultDir, { exts, controlledDirs = [] } = {}) {
  const extSet = new Set((exts && exts.length ? exts : ['.md', '.markdown']).map((e) => e.toLowerCase()));
  const ctrlDirs = new Set((controlledDirs || []).map((d) => String(d).trim()).filter(Boolean));
  const files = await walk(vaultDir, extSet);
  const records = [];

  for (const path of files) {
    const ext = extname(path).toLowerCase();
    let st;
    // Office / PDF / RTF: extract text with the zero-dep extractors. If a PDF can't
    // be read (scanned/complex), index it by filename with an honest placeholder so
    // it's still findable — never silently empty.
    if (DOC_BINARY.has(ext)) {
      let buf;
      try { buf = await readFile(path); st = await stat(path); } catch { continue; }
      let ex = extractText(buf, ext);
      // Scanned/image PDF the zero-dep parser flagged → local OCR fallback if the
      // operator has the tools installed (cached by file identity; no-op otherwise).
      if (!ex.ok && ext === '.pdf') {
        const o = await ocrPdf(path, { mtimeMs: st.mtimeMs, size: st.size });
        if (o.ok) ex = { text: o.text, ok: true, note: o.note };
        else if (o.note) ex = { ...ex, note: o.note };
      }
      const drel = relative(vaultDir, path).split(sep).join('/');
      const dname = basename(path, ext);
      const dtop = drel.split('/').length > 1 ? drel.split('/')[0] : '';
      const dbody = ex.ok ? ex.text
        : `[${ext.slice(1).toUpperCase()} document — text not extractable: ${ex.note || 'unreadable'}. Findable by filename.]`;
      records.push({ rel: drel, name: dname, title: dname, body: dbody, tags: [], outlinks: [], mtimeMs: st.mtimeMs, controlled: ctrlDirs.has(dtop), authority: null, source: 'filesystem', hasFrontmatter: false });
      continue;
    }
    let raw;
    try { raw = await readFile(path, 'utf8'); st = await stat(path); } catch { continue; }
    const rel = relative(vaultDir, path).split(sep).join('/'); // normalize to '/'
    const name = basename(path, extname(path));
    const { fm, body } = parseFrontmatter(raw);
    const h1 = body.match(/^#\s+(.+)$/m);
    const title = (fm.title || (h1 && h1[1]) || name).replace(/[#*`]/g, '').trim();
    const tags = extractTags(raw, fm);
    const outlinks = extractLinks(body);

    // "Controlled" = the doc is authoritative/governing (compliance signal). A note
    // is controlled if it declares so in frontmatter (authority/controlled/status)
    // or lives directly under a configured controlled top-level folder.
    const parts = rel.split('/');
    const topFolder = parts.length > 1 ? parts[0] : '';
    const authority = fm.authority ? fm.authority.trim() : null;
    const controlled =
      (authority || '').toLowerCase() === 'controlled' ||
      /^(true|yes)$/i.test(fm.controlled || '') ||
      (fm.status || '').toLowerCase() === 'controlled' ||
      ctrlDirs.has(topFolder);

    records.push({ rel, name, title, body, tags, outlinks, mtimeMs: st.mtimeMs, controlled, authority, source: 'filesystem', hasFrontmatter: Object.keys(fm).length > 0 });
  }

  return finishIndex(records, { vaultDir });
}

/**
 * Build the same index shape from connector Documents (core/document.mjs). This
 * is the ingestion path for every non-filesystem source — Confluence, SharePoint,
 * REST — so search/audit/integrity work identically no matter where docs came from.
 * @param {Array<object>} documents  Documents (or raw shapes; normalized via makeDocument)
 */
export function indexDocuments(documents, { vaultDir = null } = {}) {
  const records = [];
  for (const d of documents || []) {
    const doc = d && typeof d.contentHash === 'string' ? d : makeDocument(d || {});
    const body = doc.body;
    const rel = doc.key || doc.id;
    // A path-like key → basename; otherwise the title is the human-facing name.
    const name = /[./\\]/.test(String(doc.key)) ? basename(doc.key, extname(doc.key)) : doc.title;
    // Trust the connector's tags/links, but also catch any inline #tags / [[links]].
    const tags = [...new Set([...(doc.tags || []), ...extractTags(body, {})])];
    const outlinks = [...new Set([...(doc.links || []), ...extractLinks(body)])];
    records.push({
      rel, name, title: doc.title, body, tags, outlinks,
      mtimeMs: doc.updatedAt, controlled: doc.controlled, authority: doc.authority,
      source: doc.source,
      hasFrontmatter: Boolean(doc.metadata && Object.keys(doc.metadata).length),
    });
  }
  return finishIndex(records, { vaultDir });
}
