// Remediation demo — score the policy library BEFORE and AFTER fixing its planted
// defects, and show the integrity score climb. Uses adjudication so the score
// reflects CONFIRMED contradictions, not mere topical overlap. Run from anywhere:
//   MODEL_BASE_URL=http://localhost:11434/v1 MODEL_NAME=gemma4:latest \
//   MODEL_EMBED=nomic-embed-text EMBEDDINGS=on node examples/remediation-report.mjs

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIndex } from '../lib/index.mjs';
import { embedIndex } from '../lib/embed.mjs';
import { integrityReport } from '../lib/integrity.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const AT = '2026-07-21T00:00:00.000Z'; // fixed so runs are reproducible

// Drop a file from an already-built index (the original corpus carries FINDINGS.md,
// which is documentation, not a policy — exclude it so it doesn't pollute).
function exclude(idx, rel) {
  idx.notes = idx.notes.filter((n) => n.rel !== rel);
  idx.chunks = idx.chunks.filter((c) => c.noteRel !== rel);
  idx.chunks.forEach((c, i) => (c.id = i));
  idx.byRel = new Map(idx.notes.map((n) => [n.rel, n]));
  idx.df = new Map();
  for (const c of idx.chunks) for (const t of c.tf.keys()) idx.df.set(t, (idx.df.get(t) || 0) + 1);
  idx.avgLen = idx.chunks.reduce((s, c) => s + c.len, 0) / (idx.chunks.length || 1);
  idx.N = idx.chunks.length;
  return idx;
}

async function score(dir, { drop } = {}) {
  let idx = await buildIndex(join(here, dir), { exts: ['.md'] });
  if (drop) idx = exclude(idx, drop);
  await embedIndex(idx);
  return integrityReport(idx, { vaultName: dir, adjudicate: true, adjudicateLimit: 8, at: AT });
}

const before = await score('policy-corpus', { drop: 'FINDINGS.md' });
const after = await score('policy-corpus-remediated');

const row = (r) => `${r.integrity_score}/100 (${r.grade})`;
const structural = (r) => Object.fromEntries(r.findings.map((f) => [f.key, f.count]));

console.log('=== CAIRN remediation: BEFORE → AFTER ===\n');
console.log('score:', row(before), '→', row(after), '\n');
console.log('penalties  before:', JSON.stringify(before.penalties));
console.log('penalties   after:', JSON.stringify(after.penalties), '\n');
console.log('confirmed contradictions:', before.contradictions.confirmed_contradictions, '→', after.contradictions.confirmed_contradictions);
console.log('structural  before:', JSON.stringify(structural(before)));
console.log('structural   after:', JSON.stringify(structural(after)), '\n');
console.log('report hashes:');
console.log('  before', before.report_sha256);
console.log('  after ', after.report_sha256);

export { before, after };
