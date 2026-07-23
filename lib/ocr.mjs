// Scanned-PDF OCR fallback — the one place the zero-dep extractor genuinely can't go
// (an image PDF has no text to extract). The promise is preserved the honest way: ZERO
// npm dependencies; if the operator has installed the local tools (poppler's pdftoppm +
// tesseract — `brew install poppler tesseract`), scanned PDFs get OCR'd ON THIS MACHINE
// and become searchable. If not, they stay flagged, never faked. Nothing leaves the box
// either way — the privilege/local-only story survives intact.
//
// OCR is slow (seconds per page), so results are cached by file identity (path+mtime+size)
// in the state dir; a reindex re-reads the cache, not the scanner.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const CACHE_DIR = process.env.CAIRN_STATE_DIR
  ? join(process.env.CAIRN_STATE_DIR, 'ocr-cache')
  : join(dirname(fileURLToPath(import.meta.url)), '..', '.cache', 'ocr');

const MAX_PAGES = 20; // per-file cap; capped files say so in their note — no silent caps

let avail = null; // cached tool detection: null = unchecked, else boolean
export async function ocrAvailable() {
  if (avail !== null) return avail;
  try {
    await run('pdftoppm', ['-v']).catch((e) => { if (e.code === 'ENOENT') throw e; }); // -v exits 0 or writes version to stderr
    await run('tesseract', ['--version']);
    avail = true;
  } catch { avail = false; }
  return avail;
}
export function resetOcrDetection() { avail = null; } // for tests

export async function ocrPdf(path, { mtimeMs = 0, size = 0 } = {}) {
  if (!(await ocrAvailable())) {
    return { text: '', ok: false, note: 'scanned PDF — install poppler + tesseract for local OCR (brew install poppler tesseract)' };
  }
  const key = createHash('sha1').update(`${path}:${mtimeMs}:${size}`).digest('hex');
  const cacheFile = join(CACHE_DIR, `${key}.json`);
  if (existsSync(cacheFile)) {
    try { return JSON.parse(await readFile(cacheFile, 'utf8')); } catch { /* re-OCR */ }
  }

  let tmp;
  try {
    tmp = await mkdtemp(join(tmpdir(), 'cairn-ocr-'));
    await run('pdftoppm', ['-r', '150', '-png', '-f', '1', '-l', String(MAX_PAGES), path, join(tmp, 'p')], { timeout: 120000 });
    const pages = (await readdir(tmp)).filter((f) => f.endsWith('.png')).sort();
    if (!pages.length) return { text: '', ok: false, note: 'OCR: no pages rendered' };
    const parts = [];
    for (const p of pages) {
      const { stdout } = await run('tesseract', [join(tmp, p), 'stdout'], { timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
      parts.push(stdout.trim());
    }
    const text = parts.filter(Boolean).join('\n\n');
    const capped = pages.length >= MAX_PAGES;
    const result = {
      text, ok: text.trim().length > 0,
      note: `OCR (tesseract, local) — ${pages.length} page(s)${capped ? ` — CAPPED at first ${MAX_PAGES} pages` : ''}`,
    };
    try { await mkdir(CACHE_DIR, { recursive: true }); await writeFile(cacheFile, JSON.stringify(result)); } catch { /* cache best-effort */ }
    return result;
  } catch (e) {
    return { text: '', ok: false, note: `OCR failed: ${String(e.message || e).slice(0, 120)}` };
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}
