// CAIRN document extractors — pull indexable text out of common formats WITHOUT
// any third-party dependency (the core promise). Office formats (.docx/.pptx/.xlsx)
// are ZIP+XML, unzipped with Node's built-in zlib. RTF and plain text are trivial.
// PDF is font-aware (see below): text-based PDFs — including subset/CID-font PDFs
// rendered by Chrome — extract via their /ToUnicode maps; scanned/image or encrypted
// PDFs have no extractable text and are flagged honestly rather than faked.
//
// extractText(buf, ext) → { text, ok, note }.  ok=false means "recognized but could
// not cleanly extract" (the caller should surface that, not pretend the doc is empty).

import zlib from 'node:zlib';
import { Worker } from 'node:worker_threads';

const safeCp = (n) => { try { return String.fromCodePoint(n); } catch { return ''; } };
const decodeXml = (s) => s
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeCp(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => safeCp(parseInt(d, 10)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const tidy = (s) => s.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const printableRatio = (s) => { const t = s.replace(/\s/g, ''); if (!t) return 0; let p = 0; for (const ch of t) { const c = ch.codePointAt(0); if (c >= 0x20 && c !== 0x7f) p++; } return p / t.length; };

// ── ZIP (OOXML container) ────────────────────────────────────────────────────
function readZipEntries(buf, wanted) {
  const out = new Map();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65536); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) return out;
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && off + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const fnLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.toString('utf8', off + 46, off + 46 + fnLen);
    off += 46 + fnLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const lfn = buf.readUInt16LE(localOff + 26);
    const lex = buf.readUInt16LE(localOff + 28);
    const dataStart = localOff + 30 + lfn + lex;
    const data = buf.subarray(dataStart, dataStart + compSize);
    try { out.set(name, method === 8 ? zlib.inflateRawSync(data) : Buffer.from(data)); } catch { /* skip */ }
  }
  return out;
}
const stripTags = (xml) => xml.replace(/<[^>]+>/g, '');

function extractDocx(buf) {
  const e = readZipEntries(buf, (n) => n === 'word/document.xml');
  const body = e.get('word/document.xml');
  if (!body) return { text: '', ok: false, note: 'not a Word document (no document.xml)' };
  const text = decodeXml(stripTags(body.toString('utf8').replace(/<w:tab[^>]*\/>/g, '\t').replace(/<\/w:p>/g, '\n')));
  return { text: tidy(text), ok: true };
}
function extractPptx(buf) {
  const e = readZipEntries(buf, (n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const names = [...e.keys()].sort((a, b) => (parseInt(a.match(/\d+/)) || 0) - (parseInt(b.match(/\d+/)) || 0));
  if (!names.length) return { text: '', ok: false, note: 'no slides found' };
  const text = names.map((n) => decodeXml(stripTags(e.get(n).toString('utf8').replace(/<\/a:p>/g, '\n'))).trim()).join('\n\n');
  return { text: tidy(text), ok: true };
}
function extractXlsx(buf) {
  const e = readZipEntries(buf, (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  let text = '';
  const ss = e.get('xl/sharedStrings.xml');
  if (ss) text += [...ss.toString('utf8').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join(' ') + '\n';
  for (const [n, b] of e) if (/worksheets/.test(n)) {
    const inline = [...b.toString('utf8').matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
    if (inline.length) text += inline.join(' ') + '\n';
  }
  if (!text.trim()) return { text: '', ok: false, note: 'no cell text found' };
  return { text: tidy(text), ok: true };
}

// ── RTF ──────────────────────────────────────────────────────────────────────
function dropRtfGroup(s, kw) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s.startsWith('{\\' + kw, i)) {
      let depth = 0, j = i;
      for (; j < s.length; j++) { if (s[j] === '{') depth++; else if (s[j] === '}') { depth--; if (depth === 0) { j++; break; } } }
      i = j; continue;
    }
    out += s[i++];
  }
  return out;
}
function extractRtf(buf) {
  let s = buf.toString('latin1');
  for (const kw of ['fonttbl', 'colortbl', 'stylesheet', 'info', '*']) s = dropRtfGroup(s, kw);
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\par[d]?\b/g, '\n').replace(/\\line\b/g, '\n').replace(/\\tab\b/g, '\t');
  s = s.replace(/\\[a-zA-Z]+-?\d* ?/g, '').replace(/[{}]/g, '');
  return { text: tidy(s), ok: true };
}

// ── PDF (zero-dependency, font-aware) ────────────────────────────────────────
// Modern PDFs store text as font-specific glyph codes, not characters. We parse the
// object graph, inflate each font's /ToUnicode CMap, track the active font per content
// stream (Tf), and decode strings through the right map — so subset/CID-font PDFs
// (e.g. Chrome-rendered) read correctly, with only node:zlib. What still can't be read
// — scanned/image PDFs (no text) and encrypted ones — is flagged, never faked.
const inflateMaybe = (data, flate) => {
  if (!flate) return data;
  try { return zlib.inflateSync(data); } catch { try { return zlib.inflateRawSync(data); } catch { return null; } }
};
function parseObjects(buf) {
  const str = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+\d+\s+obj\b/g;
  let m;
  while ((m = re.exec(str))) {
    const start = m.index + m[0].length;
    const endObj = str.indexOf('endobj', start);
    if (endObj === -1) break;
    const sIdx = str.indexOf('stream', start);
    const hasStream = sIdx !== -1 && sIdx < endObj;
    const dict = str.slice(start, hasStream ? sIdx : endObj);
    let stream = null;
    if (hasStream) {
      let ds = sIdx + 6;
      if (str[ds] === '\r') ds++;
      if (str[ds] === '\n') ds++;
      const eIdx = str.indexOf('endstream', ds);
      if (eIdx !== -1) stream = inflateMaybe(buf.subarray(ds, eIdx), /\/FlateDecode/.test(dict));
    }
    objs.set(+m[1], { dict, stream });
    re.lastIndex = endObj + 6;
  }
  return objs;
}
const hexToStr = (hex) => { let s = ''; for (let i = 0; i + 4 <= hex.length; i += 4) s += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16)); return s; };
function parseToUnicode(text) {
  const map = new Map(); let bytes = 1;
  for (const blk of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) { if (p[1].length >= 4) bytes = 2; map.set(parseInt(p[1], 16), hexToStr(p[2])); }
  for (const blk of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      if (p[1].length >= 4) bytes = 2; const lo = parseInt(p[1], 16), hi = parseInt(p[2], 16); let d = parseInt(p[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, safeCp(d++));
    }
    for (const p of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*\[([\s\S]*?)\]/g)) {
      if (p[1].length >= 4) bytes = 2; const lo = parseInt(p[1], 16);
      [...p[3].matchAll(/<([0-9A-Fa-f]+)>/g)].forEach((x, i) => map.set(lo + i, hexToStr(x[1])));
    }
  }
  return { map, bytes };
}
function buildFontMaps(objs) {
  const byObj = new Map();
  for (const [num, o] of objs) {
    if (!/\/BaseFont|\/Type\s*\/Font/.test(o.dict)) continue;
    const tu = o.dict.match(/\/ToUnicode\s+(\d+)\s+\d+\s+R/);
    const cmapObj = tu && objs.get(+tu[1]);
    const cmap = cmapObj && cmapObj.stream ? parseToUnicode(cmapObj.stream.toString('latin1')) : null;
    byObj.set(num, cmap || { map: null, bytes: /\/Type0|\/Identity-?H/.test(o.dict) ? 2 : 1 });
  }
  const nameToFont = new Map();
  for (const o of objs.values())
    for (const fd of o.dict.matchAll(/\/Font\s*<<([\s\S]*?)>>/g))
      for (const p of fd[1].matchAll(/\/([A-Za-z0-9+.\-]+)\s+(\d+)\s+\d+\s+R/g)) nameToFont.set(p[1], byObj.get(+p[2]) || null);
  return nameToFont;
}
function pdfStringBytes(body) {
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\') {
      const nx = body[i + 1]; const map = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
      if (nx in map) { out.push(map[nx]); i++; continue; }
      const oct = body.slice(i + 1, i + 4).match(/^[0-7]{1,3}/);
      if (oct) { out.push(parseInt(oct[0], 8) & 0xff); i += oct[0].length; continue; }
      continue;
    }
    out.push(ch.charCodeAt(0) & 0xff);
  }
  return out;
}
function decodeBytes(b, font) {
  if (font && font.map) {
    const step = font.bytes === 2 ? 2 : 1; let s = '';
    for (let i = 0; i + step <= b.length; i += step) { const code = step === 2 ? (b[i] << 8) | b[i + 1] : b[i]; const ch = font.map.get(code); if (ch != null) s += ch; }
    return s;
  }
  return Buffer.from(b).toString('latin1');
}
// A show-string is either a literal (…) or a hex <…> — both appear, esp. hex inside TJ.
function decodeShow(tok, font) {
  if (tok[0] === '<') {
    const hex = tok.slice(1, -1).replace(/[^0-9A-Fa-f]/g, ''); const b = [];
    for (let i = 0; i + 2 <= hex.length; i += 2) b.push(parseInt(hex.slice(i, i + 2), 16));
    return decodeBytes(b, font);
  }
  return decodeBytes(pdfStringBytes(tok.slice(1, -1)), font);
}
const STR = '\\((?:\\\\[\\s\\S]|[^\\\\()])*\\)|<[0-9A-Fa-f\\s]*>';
function extractPdf(buf) {
  const objs = parseObjects(buf);
  const nameToFont = buildFontMaps(objs);
  let text = '';
  const op = new RegExp(`/([A-Za-z0-9+.\\-]+)\\s+[\\d.+\\-]+\\s+Tf|(${STR})\\s*(?:Tj|')|(\\[(?:${STR}|[^\\]])*\\])\\s*TJ|(T\\*|Td|TD)`, 'g');
  const inner = new RegExp(STR, 'g');
  for (const o of objs.values()) {
    if (!o.stream) continue;
    const c = o.stream.toString('latin1');
    if (!/\b(Tj|TJ)\b/.test(c)) continue;
    let font = null, line = '';
    let m;
    op.lastIndex = 0;
    while ((m = op.exec(c))) {
      if (m[1] !== undefined) { font = nameToFont.get(m[1]) || null; continue; }
      if (m[2] !== undefined) { line += decodeShow(m[2], font); continue; }
      if (m[3] !== undefined) { for (const s of m[3].matchAll(inner)) line += decodeShow(s[0], font); continue; }
      if (m[4] !== undefined) { line += ' '; continue; }
    }
    if (line.trim()) text += line + '\n';
  }
  const cleaned = tidy(text.replace(/[ \t]{2,}/g, ' '));
  if (cleaned.replace(/\s/g, '').length < 8 || printableRatio(cleaned) < 0.7) {
    return { text: '', ok: false, note: 'no extractable text — likely a scanned/image PDF or encrypted' };
  }
  // Quality gate: some PDFs position every glyph individually (common in Chrome-
  // rendered PDFs). Without a full layout engine we can't reconstruct word spacing, so
  // the text comes out letter-spaced. Rather than index garbage, flag it honestly.
  const words = cleaned.split(/\s+/).filter(Boolean);
  const singles = words.filter((w) => w.length === 1).length;
  if (words.length > 20 && singles / words.length > 0.45) {
    return { text: '', ok: false, note: 'text present but per-glyph layout — word spacing not reconstructable zero-dep; indexed by filename' };
  }
  return { text: cleaned, ok: true };
}

// ── dispatcher ───────────────────────────────────────────────────────────────
const TEXT_EXT = new Set(['.txt', '.text', '.log', '.csv', '.tsv', '.markdown', '.md', '.mdown']);
export const EXTRACTABLE_EXT = ['.docx', '.pptx', '.xlsx', '.rtf', '.pdf', ...TEXT_EXT];

export function extractText(buf, ext) {
  const e = String(ext || '').toLowerCase();
  try {
    if (e === '.docx') return extractDocx(buf);
    if (e === '.pptx') return extractPptx(buf);
    if (e === '.xlsx') return extractXlsx(buf);
    if (e === '.rtf') return extractRtf(buf);
    if (e === '.pdf') return extractPdf(buf);
    if (TEXT_EXT.has(e)) return { text: buf.toString('utf8'), ok: true };
  } catch (err) {
    return { text: '', ok: false, note: `extract failed: ${err.message}` };
  }
  return { text: '', ok: false, note: `unsupported type ${e}` };
}

// ── bounded extraction (a time limit and a kill path) ────────────────────────
// The extractors are synchronous and CPU-bound: a pathological document could
// stall the whole process with no way out. The limit is 30 s per file by
// default — long enough for any document that is merely big, short enough that
// one stuck file cannot hold an index run open. Override with
// CAIRN_EXTRACT_TIMEOUT_MS (milliseconds).
//
// A file that hits the limit is REPORTED — { ok:false, timed_out:true,
// note:'EXTRACT_TIMEOUT …' } — and the caller keeps going. It is never dropped
// silently: the file stays findable by filename, with an honest body.
export const DEFAULT_EXTRACT_TIMEOUT_MS = 30000;

export function extractTimeoutMs() {
  const raw = Number(process.env.CAIRN_EXTRACT_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_EXTRACT_TIMEOUT_MS;
}

// Run one extraction in a worker thread with a hard limit. `workerUrl` is the
// seam the tests use to point at a stub that never answers.
export function extractTextBounded(buf, ext, {
  timeoutMs = extractTimeoutMs(),
  workerUrl = new URL('./extract-worker.mjs', import.meta.url),
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let worker = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      // The kill path: whatever happened, this worker does not outlive the call.
      if (worker) worker.terminate().catch(() => {});
      resolve(result);
    };
    try {
      // execArgv: [] — the worker must not inherit the parent's CLI flags. It
      // runs a .mjs FILE, and flags like --input-type (only valid for --eval)
      // make a worker fail to start. The worker is independent, always.
      worker = new Worker(workerUrl, { workerData: { buf, ext }, execArgv: [] });
    } catch (err) {
      return finish({ text: '', ok: false, note: `extract worker failed: ${err.message}` });
    }
    timer = setTimeout(() => {
      finish({ text: '', ok: false, timed_out: true, note: `EXTRACT_TIMEOUT after ${timeoutMs}ms (${String(ext || '').toLowerCase()})` });
    }, timeoutMs);
    worker.on('message', (msg) => finish(msg));
    worker.on('error', (err) => finish({ text: '', ok: false, note: `extract failed: ${err.message}` }));
    worker.on('exit', (code) => {
      if (!settled) finish({ text: '', ok: false, note: `extract worker exited (code ${code})` });
    });
  });
}
