// CAIRN demo runner — builds an index over the sample compliance corpus, embeds
// it against the local Ollama endpoint, and prints a scored integrity report.
// Confirms the planted 7yr-vs-3yr retention contradiction is detected.
//
// Run from the repo root:  node examples/run-demo.mjs
// Requires a local Ollama at http://localhost:11434 with `nomic-embed-text`.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Model config is read from env at call time, so set it before importing/calling.
process.env.MODEL_BASE_URL = process.env.MODEL_BASE_URL || 'http://localhost:11434/v1';
process.env.MODEL_EMBED = process.env.MODEL_EMBED || 'nomic-embed-text';
process.env.EMBEDDINGS = process.env.EMBEDDINGS || 'on';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..');
const CORPUS = join(HERE, 'policy-corpus');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Import the lib API; if a lib import transiently fails, wait 3s and retry once.
async function loadLib() {
  try {
    return {
      buildIndex: (await import(join(REPO, 'lib/index.mjs'))).buildIndex,
      embedIndex: (await import(join(REPO, 'lib/embed.mjs'))).embedIndex,
      integrityReport: (await import(join(REPO, 'lib/integrity.mjs'))).integrityReport,
    };
  } catch (e) {
    console.error(`lib import failed (${e.message}); retrying in 3s…`);
    await sleep(3000);
    return {
      buildIndex: (await import(join(REPO, 'lib/index.mjs'))).buildIndex,
      embedIndex: (await import(join(REPO, 'lib/embed.mjs'))).embedIndex,
      integrityReport: (await import(join(REPO, 'lib/integrity.mjs'))).integrityReport,
    };
  }
}

// Is a note-pair the two retention docs?
const isRetentionPair = (p) => {
  const set = new Set([p.a.note, p.b.note]);
  return (
    [...set].some((n) => n.includes('data-retention-policy')) &&
    [...set].some((n) => n.includes('records-management-standard'))
  );
};

async function main() {
  const { buildIndex, embedIndex, integrityReport } = await loadLib();

  console.log('CAIRN demo — sample compliance corpus');
  console.log('corpus:', CORPUS);
  console.log('endpoint:', process.env.MODEL_BASE_URL, '| embed model:', process.env.MODEL_EMBED);
  console.log('─'.repeat(70));

  const index = await buildIndex(CORPUS, { exts: ['.md'] });

  // The demo's own output (FINDINGS.md) lives in the corpus dir. Exclude it so the
  // run measures the policy library itself and stays reproducible across reruns.
  const EXCLUDE = new Set(['FINDINGS.md']);
  index.notes = index.notes.filter((n) => !EXCLUDE.has(n.rel));
  index.chunks = index.chunks.filter((c) => !EXCLUDE.has(c.noteRel));
  index.N = index.chunks.length;

  console.log(`indexed ${index.notes.length} notes → ${index.N} chunks`);

  // Embed for contradiction detection; fall back to audit-only if it fails.
  let embedOk = false;
  let embedErr = null;
  try {
    const res = await embedIndex(index, (m) => process.stdout.write(`  ${m}\r`));
    embedOk = res.embedded;
    console.log(`\nembeddings: ${res.model} — ${res.fresh} fresh, ${res.cached} cached, embedded=${res.embedded}`);
  } catch (e) {
    embedErr = e.message;
    console.log(`\nembeddings FAILED: ${e.message}`);
    console.log('Falling back to lexical / audit-only run (no contradiction detection).');
  }

  const report = integrityReport(index, { vaultName: 'policy-corpus' });

  console.log('─'.repeat(70));
  console.log(`Integrity score : ${report.integrity_score}  (grade ${report.grade})`);
  console.log(`Generated at    : ${report.generated_at}`);
  console.log(`Totals          : ${report.totals.notes} notes, ${report.totals.chunks} chunks, embedded=${report.totals.embedded}`);
  console.log('\nPenalties:');
  for (const [k, v] of Object.entries(report.penalties)) console.log(`  ${k.padEnd(18)} -${v}`);

  console.log('\nFindings (counts):');
  for (const f of report.findings) {
    console.log(`  ${f.key.padEnd(18)} ${String(f.count).padStart(3)}  — ${f.label}`);
    if (['orphans', 'broken_links', 'stale'].includes(f.key)) {
      for (const it of f.items) console.log(`        · ${JSON.stringify(it)}`);
    }
  }

  const c = report.contradictions;
  console.log('\nContradiction detection:');
  console.log(`  available: ${c.available} | threshold: ${c.threshold} | candidate_count: ${c.candidate_count}`);
  const top = c.candidates.slice(0, 8);
  top.forEach((p, i) => {
    const flag = isRetentionPair(p) ? '  <<< PLANTED RETENTION CONTRADICTION' : '';
    console.log(`  ${String(i + 1).padStart(2)}. sim=${p.similarity}  ${p.a.note} (${p.a.heading || '-'})  <>  ${p.b.note} (${p.b.heading || '-'})${flag}`);
  });

  const retPair = c.candidates.find(isRetentionPair);
  console.log('\n' + '─'.repeat(70));
  if (retPair) {
    console.log('CONFIRMED: planted 7yr-vs-3yr retention contradiction was detected.');
    console.log(`  ${retPair.a.note}  <>  ${retPair.b.note}`);
    console.log(`  cosine similarity = ${retPair.similarity}`);
  } else if (!c.available) {
    console.log('NOT CONFIRMED: embeddings unavailable — contradiction detection did not run.');
  } else {
    console.log('NOT CONFIRMED: retention pair did not surface above threshold.');
  }

  console.log(`\nreport_sha256 = ${report.report_sha256}`);

  // Machine-readable summary for downstream reporting.
  console.log('\n<<<SUMMARY_JSON>>>');
  console.log(JSON.stringify({
    integrity_score: report.integrity_score,
    grade: report.grade,
    totals: report.totals,
    penalties: report.penalties,
    finding_counts: Object.fromEntries(report.findings.map((f) => [f.key, f.count])),
    findings_detail: Object.fromEntries(report.findings.filter((f) => ['orphans', 'broken_links', 'stale'].includes(f.key)).map((f) => [f.key, f.items])),
    contradictions_available: c.available,
    candidate_count: c.candidate_count,
    retention_pair: retPair || null,
    top_candidates: top,
    embed_ok: embedOk,
    embed_error: embedErr,
    report_sha256: report.report_sha256,
    generated_at: report.generated_at,
    index_built_at: report.index_built_at,
  }, null, 2));
  console.log('<<<END_SUMMARY_JSON>>>');
}

main().catch((e) => { console.error(e); process.exit(1); });
