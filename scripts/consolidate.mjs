// consolidate — build held-knowledge cards for entities via the RUNNING CAIRN server
// (one index, one ledger, one receipt chain — no parallel state).
//
//   node scripts/consolidate.mjs Pan COSMIC "OG Bulma" AtScale
//   PORT=4600 node scripts/consolidate.mjs Pan          # target a different instance
//
// Each card lands in <vault>/cards/ and the file-watcher reindexes it, so the facts are
// searchable moments later. Facts that fail quote-verification are reported as dropped.

const port = process.env.PORT || process.env.CAIRN_PORT || 4611;
const base = `http://127.0.0.1:${port}`;
const entities = process.argv.slice(2);
if (!entities.length) {
  console.error('usage: node scripts/consolidate.mjs <entity> [entity …]');
  process.exit(1);
}

const st = await fetch(`${base}/api/status`).then((r) => r.json()).catch(() => null);
if (!st?.ready) { console.error(`no ready CAIRN at ${base} — is the app running?`); process.exit(1); }
console.log(`consolidating against ${base} (vault: ${st.vault})\n`);

for (const entity of entities) {
  process.stdout.write(`◆ ${entity} … `);
  try {
    const r = await fetch(`${base}/api/consolidate`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entity }),
    }).then((x) => x.json());
    if (r.error) { console.log(`✗ ${r.error}`); continue; }
    if (!r.written) { console.log(`— ${r.reason}`); continue; }
    console.log(`${r.facts.length} facts verified, ${r.dropped.length} dropped → ${r.file}  (ledger #${r.ledger.seq})`);
    if (r.name_evidence) console.log(`    ★ ${r.name_evidence.fact}`);
    for (const f of r.facts) console.log(`    · ${f.fact}`);
    for (const d of r.dropped) console.log(`    ✗ dropped: ${d.fact}  [${d.reason}]`);
  } catch (e) {
    console.log(`✗ ${e.message}`);
  }
}
