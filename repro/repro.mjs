// Pan's repro of CAIRN findings 1, 2, 3, 5 at 62a6ea7. Read-only against ~/projects/cairn.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const C = process.argv[2]; // cairn repo root
const { tokenize, buildIndex } = await import(`${C}/lib/index.mjs`);
const { search } = await import(`${C}/lib/search.mjs`);

console.log('== F5 tokenizer ==');
for (const s of ['Rule 3.8 applies', '§3.8(d)(1)', 'SWR 3.13', 'rule-3-8']) console.log(JSON.stringify(s), '->', JSON.stringify(tokenize(s)));

console.log('\n== F1/F2 grounded flag ==');
let reply = '';
const srv = http.createServer((req, res) => { let b=''; req.on('data', d => b += d); req.on('end', () => {
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }], message: { role: 'assistant', content: reply } }));
}); });
await new Promise(r => srv.listen(0, '127.0.0.1', r));
process.env.MODEL_BASE_URL = `http://127.0.0.1:${srv.address().port}/v1`;
delete process.env.MODEL_API_KEY;
const { groundedAnswer } = await import(`${C}/lib/ground.mjs`);
const contexts = [{ n: 1, note: 'a.md', heading: '', text: 'Wells must be plugged within one year.' }, { n: 2, note: 'b.md', heading: '', text: 'Pits must be lined.' }];
for (const r of ['Wells must be plugged within 30 days [7].', 'Wells must be plugged within one year [1]. Also pits need no liner.', 'Wells must be plugged within one year [1] [9].']) {
  reply = r;
  const out = await groundedAnswer({ query: 'plugging deadline?', contexts });
  console.log(JSON.stringify(r), '-> grounded:', out.grounded, 'refused:', out.refused, 'citations:', JSON.stringify(out.citations.map(c => c.n)));
}
srv.close();

console.log('\n== F3 ranking vs wall clock ==');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cairn-f3-'));
const body = '# Plugging\nA well must be plugged within one year after operations cease.\n';
fs.writeFileSync(path.join(dir, 'a-old.md'), body);
fs.writeFileSync(path.join(dir, 'b-fresh.md'), body);
const nowS = Date.now() / 1000;
fs.utimesSync(path.join(dir, 'a-old.md'), nowS - 400 * 86400, nowS - 400 * 86400);
fs.utimesSync(path.join(dir, 'b-fresh.md'), nowS, nowS);
const idx = await buildIndex(dir);
const realNow = Date.now;
for (const shift of [0, 120]) {
  Date.now = () => realNow() + shift * 86400000;
  const r = search(idx, 'plugged within one year', { k: 5 });
  console.log(`day +${shift}:`, (r.hits || []).map(h => `${h.noteRel || h.note || h.title}=${(h.score ?? h.final ?? 0).toFixed?.(4) ?? h.score}`).join('  '));
}
Date.now = realNow;
fs.rmSync(dir, { recursive: true, force: true });
