// C-1 evidence probe — the unbounded citation range.
//
// Prints what the parser does now, what the server seals for an answer that
// cites a huge range, and what the re-scan tool says about a stored receipt
// that contains one. Run from the worktree root:
//
//   node scripts/probe-c1-range-cap.mjs
//
// It boots a throwaway server against a throwaway vault and a throwaway state
// dir. It never touches a real ledger, a real vault, or a real box.

import http from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseCitationGroups, citedFromGroups } from '../lib/ground.mjs';
import { recheckReceipt } from './rescan-receipts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function ms(fn) {
  const t = Date.now();
  let out; let threw = null;
  try { out = fn(); } catch (e) { threw = e; }
  return { ms: Date.now() - t, out, threw };
}

console.log('== the parse, with four contexts ==');
for (const text of ['Answer [1-999999999].', 'Answer [3-1].', 'Answer [1-4].', 'Answer [1-64].']) {
  const r = ms(() => citedFromGroups(parseCitationGroups(text, { contextCount: 4 })));
  const shown = r.threw ? `THREW ${r.threw.constructor.name}: ${r.threw.message}` : JSON.stringify(r.out);
  console.log(`${text.padEnd(22)} -> ${shown.padEnd(30)} in ${r.ms}ms`);
}

console.log('\n== the same, with no context count (the default cap is 64) ==');
for (const text of ['Answer [1-999999999].', 'Answer [1-65].']) {
  const r = ms(() => citedFromGroups(parseCitationGroups(text)));
  console.log(`${text.padEnd(22)} -> ${JSON.stringify(r.out).padEnd(30)} in ${r.ms}ms`);
}

console.log('\n== the server: an answer citing a huge range ==');
const reply = 'A well must be plugged within 30 days [1-999999999].';
const model = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
  });
});
model.listen(0, '127.0.0.1');
await once(model, 'listening');
const modelUrl = `http://127.0.0.1:${model.address().port}/v1`;

const vault = mkdtempSync(join(tmpdir(), 'cairn-c1-vault-'));
const state = mkdtempSync(join(tmpdir(), 'cairn-c1-state-'));
mkdirSync(vault, { recursive: true });
writeFileSync(join(vault, 'plugging.md'), '# Plugging\nA well must be plugged within one year after operations cease.\n');
writeFileSync(join(vault, 'pits.md'), '# Pits\nPits must be lined with an approved liner.\n');

const port = 6000 + Math.floor(Math.random() * 900);
const child = spawn(process.execPath, [join(ROOT, 'server.mjs')], {
  env: {
    ...process.env,
    PORT: String(port), HOST: '127.0.0.1',
    CAIRN_VAULT_DIR: vault, CAIRN_STATE_DIR: state,
    MODEL_BASE_URL: modelUrl, MODEL_NAME: 'mock-range', MODEL_API_KEY: 'test',
    EMBEDDINGS: 'off', WATCH: 'off',
  },
  stdio: 'ignore',
});
const base = `http://127.0.0.1:${port}`;
for (let i = 0; i < 60; i++) {
  try { const r = await fetch(`${base}/api/health`); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}

try {
  const res = await fetch(`${base}/api/answer`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ q: 'how long until a well must be plugged' }),
  });
  const body = await res.json();
  console.log(`mode: ${body.mode} | refused: ${body.refused} | grounded: ${body.grounded}`);
  console.log(`answer shown: ${body.answer === undefined ? 'undefined (not shown)' : 'SHOWN'}`);
  console.log(`reason: ${body.reason}`);
  console.log(`receipt.verdict: ${body.receipt.verdict}`);
  console.log(`receipt.cited: ${JSON.stringify(body.receipt.cited)}`);
  console.log(`receipt.dangling_citations: ${JSON.stringify(body.receipt.dangling_citations)}`);
  console.log(`receipt.invalid_citations: ${JSON.stringify(body.receipt.invalid_citations)}`);
  console.log(`receipt.sources: ${JSON.stringify(body.receipt.sources)}`);
  console.log(`receipt.answer (kept for audit): ${JSON.stringify(body.receipt.answer)}`);
  const led = await (await fetch(`${base}/api/ledger`)).json();
  console.log(`ledger answer_receipt entries: ${led.entries.filter((e) => e.kind === 'answer_receipt').length}`);
  console.log(`chain verify: ok=${(await (await fetch(`${base}/api/ledger/verify`)).json()).ok}`);
} finally {
  child.kill();
  model.close();
}

console.log('\n== the re-scan tool: a stored receipt with a huge range ==');
const check = recheckReceipt({
  verdict: 'GROUNDED',
  answer: 'A well must be plugged within 30 days [1-999999999].',
  sources: [{ n: 1, note: 'plugging.md', heading: null, content_sha256: 'x' }],
  uncited_sentences: 0,
});
console.log(`old_verdict: ${check.old_verdict} -> new_verdict: ${check.new_verdict}`);
console.log(`reason: ${check.reason}`);
console.log(`cited: ${JSON.stringify(check.cited)} | dangling_citations: ${JSON.stringify(check.dangling_citations)}`);
console.log(`invalid_citations: ${JSON.stringify(check.invalid_citations)}`);
