#!/usr/bin/env node
// CAIRN receipt re-scan — re-check every past answer_receipt with the CURRENT
// rules and report what would change.
//
//   node scripts/rescan-receipts.mjs <ledger.jsonl>           # dry run (default)
//   node scripts/rescan-receipts.mjs <ledger.jsonl> --append   # append corrections
//
// It never edits or rewrites an existing line. With --append it adds ONE
// receipt_correction entry per changed receipt, naming the seq it corrects, so
// the hash chain stays valid and the correction is auditable in its own right.
//
// What "the current rules" means (see lib/ground.mjs):
//   - citations are parsed as [1], [1, 4], [1-3], [1–3] … — every form;
//   - GROUNDED only when at least one cited number is backed by a source AND
//     no cited number dangles;
//   - otherwise REFUSED_CITATION_CHECK.
//
// It is a TOOL. It is never run against a real ledger by the builder; the
// operator runs the dry run on a copy and decides.

import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Ledger } from '../core/ledger.mjs';
import { parseCitations, countUncitedSentences } from '../lib/ground.mjs';

// The citation parse the OLD code used: only "[n]". Kept so the re-scan can
// tell what the old receipt saw — and therefore what it dropped.
function parseCitationsOld(text) {
  return [...new Set([...String(text || '').matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/**
 * Re-check one receipt payload against the current rules.
 * @param {object} receipt  the answer_receipt payload as stored in the ledger
 */
export function recheckReceipt(receipt) {
  const answer = receipt?.answer ?? '';
  const cited = parseCitations(answer);
  const sources = Array.isArray(receipt?.sources) ? receipt.sources : [];

  // Which citation numbers does this receipt actually back with a source?
  let backed;
  if (sources.length && typeof sources[0].n === 'number') {
    // A receipt written by the current code carries the number each source
    // answers to — the mapping is exact.
    backed = sources.map((s) => s.n).filter((n) => Number.isFinite(n));
  } else {
    // An OLD receipt stored no mapping at all. The old code kept the citations
    // that resolved, in ascending order, so the first M parsed numbers are the
    // ones it backed — M being the number of sources it sealed.
    backed = parseCitationsOld(answer).slice(0, sources.length);
  }
  const backedSet = new Set(backed);
  const valid = cited.filter((n) => backedSet.has(n));
  const dangling = cited.filter((n) => !backedSet.has(n));

  const oldVerdict = receipt?.verdict ?? 'UNKNOWN';
  let newVerdict;
  if (oldVerdict === 'REFUSED_UNGROUNDED') {
    // The model refused. The citation rules do not apply — nothing was claimed.
    newVerdict = 'REFUSED_UNGROUNDED';
  } else if (valid.length >= 1 && dangling.length === 0) {
    newVerdict = 'GROUNDED';
  } else {
    newVerdict = 'REFUSED_CITATION_CHECK';
  }

  let reason;
  if (newVerdict === 'REFUSED_UNGROUNDED') reason = 'the model refused — nothing was claimed';
  else if (!cited.length) reason = 'the answer cites nothing';
  else if (dangling.length && valid.length) reason = `cites ${dangling.map((n) => `[${n}]`).join(' ')} — no source backs ${dangling.length === 1 ? 'it' : 'them'}`;
  else if (dangling.length) reason = `cites ${dangling.map((n) => `[${n}]`).join(' ')} and no citation resolves to a source`;
  else if (!valid.length) reason = 'no citation resolves to a source';
  else reason = 'every citation resolves to a source';

  return {
    old_verdict: oldVerdict,
    new_verdict: newVerdict,
    changed: newVerdict !== oldVerdict,
    reason,
    cited,
    valid,
    dangling_citations: dangling,
    uncited_sentences: Number.isFinite(receipt?.uncited_sentences)
      ? receipt.uncited_sentences
      : countUncitedSentences(answer),
  };
}

/**
 * Re-scan a ledger file.
 * @param {string} path        the ledger JSONL
 * @param {object} [opts]
 * @param {boolean} [opts.append]  append a receipt_correction per changed receipt
 * @returns {{rows: Array, corrections: Array, appended: Array}}
 */
export function rescanLedger(path, { append = false } = {}) {
  if (!existsSync(path)) throw new Error(`ledger not found: ${path}`);
  const rows = [];
  const corrections = [];
  const entries = new Ledger(path).all();
  for (const entry of entries) {
    if (entry.kind !== 'answer_receipt') continue;
    const check = recheckReceipt(entry.payload || {});
    const row = { seq: entry.seq, ...check, entry_hash: entry.entry_hash };
    rows.push(row);
    if (check.changed) {
      corrections.push({
        corrects_seq: entry.seq,
        corrects_entry_hash: entry.entry_hash,
        tool: 'cairn-rescan',
        old_verdict: check.old_verdict,
        new_verdict: check.new_verdict,
        reason: check.reason,
        cited: check.cited,
        valid: check.valid,
        dangling_citations: check.dangling_citations,
        uncited_sentences: check.uncited_sentences,
      });
    }
  }
  const appended = [];
  if (append && corrections.length) {
    const ledger = new Ledger(path);
    for (const correction of corrections) appended.push(ledger.append('receipt_correction', correction));
  }
  return { rows, corrections, appended };
}

const pad = (s, n) => String(s).padEnd(n);
function printTable(rows) {
  if (!rows.length) { console.log('no answer_receipt entries found'); return; }
  console.log(`${pad('seq', 6)}${pad('old verdict', 26)}${pad('new verdict', 26)}reason`);
  console.log('-'.repeat(100));
  for (const r of rows) {
    const mark = r.changed ? '*' : ' ';
    console.log(`${pad(mark + r.seq, 6)}${pad(r.old_verdict, 26)}${pad(r.new_verdict, 26)}${r.reason}`);
  }
  const changed = rows.filter((r) => r.changed).length;
  console.log(`\n${rows.length} answer_receipt(s) checked, ${changed} would change.`);
}

function main(argv) {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  const append = args.includes('--append');
  if (!path) {
    console.error('usage: node scripts/rescan-receipts.mjs <ledger.jsonl> [--append]');
    console.error('  default is a dry run: nothing is written. --append adds one');
    console.error('  receipt_correction per changed receipt — existing lines are never touched.');
    process.exit(2);
  }
  const { rows, corrections, appended } = rescanLedger(path, { append });
  printTable(rows);
  if (!append) {
    console.log('\ndry run — nothing was written. Re-run with --append to append corrections.');
  } else {
    console.log(`\nappended ${appended.length} receipt_correction entr${appended.length === 1 ? 'y' : 'ies'}.`);
    appended.forEach((entry, i) => {
      console.log(`  ledger seq ${entry.seq} → corrects seq ${corrections[i].corrects_seq} (${corrections[i].old_verdict} → ${corrections[i].new_verdict})`);
    });
    const v = new Ledger(path).verify();
    console.log(`chain verify: ok=${v.ok} count=${v.count}${v.ok ? '' : ` broken_at=${v.broken_at} ${v.reason}`}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv); } catch (e) { console.error(String(e.message || e)); process.exit(1); }
}
