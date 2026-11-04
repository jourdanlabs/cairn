// End-to-end: CAIRN server at 62a6ea7, temp vault/state/home, mock local model. Never touches ~/brain or :4611.
//
// Pan's script (~/chamber-inbox/minimax/cairn-fix-receipts-2026-11-03/repro/e2e.mjs),
// copied here so the gate can run it from the repo root. The ONLY change is the
// last line: it also prints the receipt's citation fields, so the citation check
// is visible in the output rather than implied.
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawn } from 'node:child_process';
const C = process.argv[2];
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-e2e-'));
const vault = path.join(root, 'vault'); fs.mkdirSync(vault);
fs.writeFileSync(path.join(vault, 'plugging.md'), '# Plugging\nA well must be plugged within one year after operations cease.\n');
fs.writeFileSync(path.join(vault, 'pits.md'), '# Pits\nPits must be lined with an approved liner.\n');
const mock = http.createServer((q, s) => { let b=''; q.on('data', d => b += d); q.on('end', () => { s.setHeader('content-type','application/json'); s.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'A well must be plugged within 30 days [7].' } }] })); }); });
await new Promise(r => mock.listen(0, '127.0.0.1', r));
const port = 47000 + (process.pid % 900);
const env = { PATH: process.env.PATH, HOME: root, CAIRN_STATE_DIR: path.join(root, 'state'), VAULT_DIR: vault, CAIRN_VAULT_DIR: vault, PORT: String(port), HOST: '127.0.0.1', WATCH: '0', MODEL_BASE_URL: `http://127.0.0.1:${mock.address().port}/v1`, MODEL_NAME: 'mock', EMBEDDINGS: 'off' };
const srv = spawn(process.execPath, [path.join(C, 'server.mjs')], { env, cwd: C, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const kill = setTimeout(() => { srv.kill('SIGKILL'); console.log('TIMEOUT', log.slice(-500)); process.exit(1); }, 60000);
let out = null;
for (let i = 0; i < 100 && !out; i++) {
  await new Promise(r => setTimeout(r, 300));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/answer`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: 'how long until a well must be plugged' }) });
    const j = await res.json(); if (j.error === 'index not ready') continue; out = j;
  } catch {}
}
clearTimeout(kill); srv.kill('SIGKILL'); mock.close();
console.log('mode:', out?.mode, '| answer:', JSON.stringify(out?.answer), '| grounded:', out?.grounded, '| citations:', JSON.stringify(out?.citations));
console.log('receipt.verdict:', out?.receipt?.verdict, '| receipt.sources:', JSON.stringify(out?.receipt?.sources), '| ledger seq:', out?.ledger?.seq);
console.log('receipt.cited:', JSON.stringify(out?.receipt?.cited), '| receipt.dangling_citations:', JSON.stringify(out?.receipt?.dangling_citations), '| receipt.uncited_sentences:', out?.receipt?.uncited_sentences);
fs.rmSync(root, { recursive: true, force: true });
