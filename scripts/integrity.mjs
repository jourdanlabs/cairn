#!/usr/bin/env node
// Integrity report against a corpus path — does not require a running server.
// Use this to audit a *curated* vault (the demo boxes score clean) without
// pointing the chamber engine at ~/brain.
//
//   node scripts/integrity.mjs --corpus ./demo/matter-sample
//   node scripts/integrity.mjs --corpus ~/policies --controlled policies,standards

import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { buildIndex } from '../lib/index.mjs';
import { integrityReport, RAW_ARCHIVE_NOTE } from '../lib/integrity.mjs';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const corpus = arg('--corpus');
if (!corpus) {
  console.error('usage: node scripts/integrity.mjs --corpus <path> [--controlled dir,dir] [--stale-days 180]');
  process.exit(1);
}
const dir = resolve(corpus.replace(/^~/, process.env.HOME || '~'));
if (!existsSync(dir)) {
  console.error(`corpus not found: ${dir}`);
  process.exit(1);
}
const controlled = (arg('--controlled', '') || '').split(',').map((s) => s.trim()).filter(Boolean);
const staleDays = Number(arg('--stale-days', 180)) || 180;

const index = await buildIndex(dir, { exts: ['.md', '.markdown'], controlledDirs: controlled });
const rep = await integrityReport(index, { vaultName: dir, staleDays });

if (rep.raw_archive) console.log(rep.archive_note || RAW_ARCHIVE_NOTE);
console.log(`${rep.integrity_score}/100  grade ${rep.grade}  notes ${rep.totals.notes}  sha256 ${rep.report_sha256.slice(0, 16)}…`);
if (rep.raw_archive) {
  console.log('(score is not a curation-quality signal — this looks like a raw archive)');
}
for (const f of rep.findings || []) {
  if (f.count) console.log(`  ${f.key}: ${f.count}`);
}
if (process.argv.includes('--json')) console.log(JSON.stringify(rep, null, 2));
