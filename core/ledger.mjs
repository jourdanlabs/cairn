// CAIRN receipt ledger — the "LUNA" pattern. An append-only, hash-chained log
// where each entry seals the one before it, so any later edit to any past line
// is detectable by recomputing the chain. Every answer receipt and integrity
// report gets stamped here, turning them into a verifiable, tamper-evident
// record. Pure Node, zero deps.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const ZERO_HASH = '0'.repeat(64); // prev_hash of the genesis entry
const DEFAULT_PATH = '.cairn/ledger.jsonl';

const sha256 = (s) => createHash('sha256').update(String(s)).digest('hex');

/**
 * Stable, recursive JSON serialization: object keys are sorted at every depth,
 * array order is preserved, undefined object values are dropped. Two payloads
 * that differ only in key order serialize identically, so their hashes match.
 */
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJSON(v === undefined ? null : v)).join(',') + ']';
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(value[k])).join(',') + '}';
}

// The seal: binds position, the prior seal, the kind, and the canonical payload.
// Note: `ts` is intentionally NOT hashed, so a fixed clock is not required for
// reproducible hashes — but tests may still inject one for deterministic ts.
export function entryHash({ seq, prev_hash, kind, payload }) {
  return sha256(seq + '|' + prev_hash + '|' + kind + '|' + canonicalJSON(payload));
}

export class Ledger {
  /**
   * @param {string} [path]              JSONL file (created on first append)
   * @param {object} [opts]
   * @param {() => string} [opts.now]    injectable clock returning an ISO string
   */
  constructor(path = DEFAULT_PATH, { now } = {}) {
    this.path = path;
    this.now = now || (() => new Date().toISOString());
  }

  // Parse every line into an entry. Missing file => empty chain.
  all() {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  }

  // Last sealed entry, or null on an empty/absent ledger.
  tail() {
    const rows = this.all();
    return rows.length ? rows[rows.length - 1] : null;
  }

  // Number of sealed entries (seq of the next append).
  count() {
    return this.all().length;
  }

  /**
   * Seal a new entry onto the tail and persist it. Re-reads the file each call,
   * so it is correct across process restarts and multiple Ledger instances.
   */
  append(kind, payload) {
    const prev = this.tail();
    const seq = prev ? prev.seq + 1 : 0;
    const prev_hash = prev ? prev.entry_hash : ZERO_HASH;
    const entry_hash = entryHash({ seq, prev_hash, kind, payload });
    const entry = { seq, ts: String(this.now()), kind, prev_hash, payload, entry_hash };

    mkdirSync(dirname(this.path) || '.', { recursive: true });
    appendFileSync(this.path, JSON.stringify(entry) + '\n');
    return entry;
  }

  /**
   * Walk the whole chain, recomputing each seal and checking prev_hash linkage.
   * @returns {{ok:boolean, count:number, broken_at:number|null, reason:string|null}}
   */
  verify() {
    const rows = this.all();
    let prev_hash = ZERO_HASH;
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i];
      if (e.seq !== i) return fail(rows.length, e.seq ?? i, `seq out of order: expected ${i}, got ${e.seq}`);
      if (e.prev_hash !== prev_hash) return fail(rows.length, e.seq, 'prev_hash linkage broken');
      if (entryHash(e) !== e.entry_hash) return fail(rows.length, e.seq, 'entry_hash mismatch (payload tampered)');
      prev_hash = e.entry_hash;
    }
    return { ok: true, count: rows.length, broken_at: null, reason: null };
  }
}

const fail = (count, broken_at, reason) => ({ ok: false, count, broken_at, reason });

// Convenience wrappers — the two things CAIRN produces that must be provable.
export const recordAnswerReceipt = (ledger, receipt) => ledger.append('answer_receipt', receipt);
export const recordReportReceipt = (ledger, report) => ledger.append('integrity_report', report);
