// R4: the large-PDF extract.
//
// Pan's script (~/chamber-inbox/minimax/cairn-fix-receipts-2026-11-03/repro/f4.mjs),
// copied here so the gate can run it from the repo root, with the NEW bounded
// path added: the same PDF through extractTextBounded(), which owns the limit
// and has the kill path.
//
//   node repro/f4.mjs <repo-root> <pdf> <capMs>
//
// The PDF is NOT committed (3.3 MB). Pan's copy:
//   ~/chamber-inbox/minimax/cairn-fix-receipts-2026-11-03/repro/rrc-chapter3.pdf
import { spawnSync } from 'node:child_process';

const [C, pdf, capMs] = process.argv.slice(2);

// 1. The OLD path, under Pan's cap: no timeout and no kill path inside the
//    extractor, so the cap is the only thing that can end it.
const code = `import fs from 'node:fs'; const { extractText } = await import(${JSON.stringify(C + '/lib/extract.mjs')}); const t0=Date.now(); const out = await extractText(fs.readFileSync(${JSON.stringify(pdf)}), '.pdf'); const s = typeof out === 'string' ? out : JSON.stringify(out); console.log('DONE ms=' + (Date.now()-t0) + ' chars=' + s.length);`;
const t0 = Date.now();
const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { timeout: Number(capMs), killSignal: 'SIGKILL', encoding: 'utf8' });
console.log('[old path] elapsed_ms=' + (Date.now() - t0), 'signal=' + r.signal, 'status=' + r.status, (r.stdout || '').trim(), (r.stderr || '').slice(0, 300));

// 2. The NEW path: the extraction runs in a worker thread under a limit the
//    caller owns, and a file that hits the limit is REPORTED, never dropped.
const { extractTextBounded, DEFAULT_EXTRACT_TIMEOUT_MS } = await import(C + '/lib/extract.mjs');
const fs = await import('node:fs');
const buf = fs.readFileSync(pdf);
const t1 = Date.now();
const out = await extractTextBounded(buf, '.pdf', { timeoutMs: DEFAULT_EXTRACT_TIMEOUT_MS });
console.log('[new path] elapsed_ms=' + (Date.now() - t1), 'limit_ms=' + DEFAULT_EXTRACT_TIMEOUT_MS, JSON.stringify(out).slice(0, 400));
