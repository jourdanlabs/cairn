// CAIRN surveillance — continuous knowledge-integrity monitoring. It snapshots the
// integrity state, diffs it against the previous snapshot, and raises alerts on
// what is NEW: a fresh confirmed contradiction, a newly-broken link, a score drop.
// That is what turns a one-time report into a control you can staff an alert on.
//
// Pure Node. State is a small serializable JSON snapshot persisted per source.

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

// ---- state snapshot (compact, serializable, comparable) --------------------

function itemKey(key, it) {
  if (key === 'broken_links') return `${it.from}->${it.link}`;
  if (key === 'duplicate_titles') return `title:${it.title}`;
  return it.note || it.title || JSON.stringify(it);
}
const pairKey = (c) => [c.a.note, c.b.note].sort().join(' <> ');

// Normalize a full integrity report into a small snapshot we can diff & store.
export function snapshotState(report) {
  const findings = {};
  for (const f of report.findings || []) findings[f.key] = (f.items || []).map((it) => itemKey(f.key, it));
  const cands = report.contradictions?.candidates || [];
  return {
    at: report.generated_at || null,
    score: report.integrity_score,
    grade: report.grade,
    findings,                                   // { key: [itemKey…] }
    candidates: cands.map(pairKey),
    confirmed: cands.filter((c) => c.relation === 'contradict').map(pairKey),
  };
}

const setDiff = (a = [], b = []) => { const B = new Set(b); return a.filter((x) => !B.has(x)); };

// Diff two snapshots → what appeared and what was resolved.
export function diffStates(prev, next) {
  const p = prev || { score: next.score, findings: {}, candidates: [], confirmed: [] };
  const keys = new Set([...Object.keys(p.findings || {}), ...Object.keys(next.findings || {})]);
  const findings = {};
  for (const k of keys) {
    const nw = setDiff(next.findings?.[k], p.findings?.[k]);
    const rs = setDiff(p.findings?.[k], next.findings?.[k]);
    if (nw.length || rs.length) findings[k] = { new: nw, resolved: rs };
  }
  return {
    first_run: !prev,
    score_before: p.score, score_after: next.score, score_delta: next.score - p.score,
    grade_before: p.grade, grade_after: next.grade,
    findings,
    new_confirmed_contradictions: setDiff(next.confirmed, p.confirmed),
    resolved_confirmed_contradictions: setDiff(p.confirmed, next.confirmed),
    new_candidates: setDiff(next.candidates, p.candidates),
  };
}

// Turn a diff into discrete, severity-tagged alert events for the sinks.
export function eventsFromDiff(diff, { source = 'corpus', scoreDropAlert = 5 } = {}) {
  const ev = [];
  // The first run establishes a baseline — the report itself is the record; do not
  // alert-storm on every pre-existing issue. Alerts fire on CHANGE from here on.
  if (diff.first_run) return ev;
  const push = (severity, type, message, detail) => ev.push({ severity, type, source, message, detail });
  for (const c of diff.new_confirmed_contradictions) push('high', 'new_contradiction', `New confirmed contradiction: ${c}`, { pair: c });
  for (const b of diff.findings?.broken_links?.new || []) push('medium', 'new_broken_link', `New broken reference: ${b}`, { ref: b });
  for (const s of diff.findings?.stale?.new || []) push('low', 'new_stale', `Note went stale: ${s}`, { note: s });
  if (!diff.first_run && diff.score_delta <= -scoreDropAlert) {
    push('medium', 'score_drop', `Integrity score dropped ${-diff.score_delta} (${diff.score_before}→${diff.score_after}, grade ${diff.grade_after})`, { from: diff.score_before, to: diff.score_after });
  }
  return ev;
}

// ---- alert sinks (each: async (event) => void) ------------------------------

export const consoleSink = async (e) => console.log(`[${e.severity.toUpperCase()}] ${e.source}: ${e.message}`);

export function fileSink(path) {
  return async (e) => {
    if (!existsSync(dirname(path))) await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify({ ts: new Date().toISOString(), ...e }) + '\n', { flag: 'a' });
  };
}

export function webhookSink(url, fetchImpl = globalThis.fetch) {
  return async (e) => {
    try { await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(e) }); }
    catch { /* alerting must never crash the cycle */ }
  };
}

// ---- state persistence + one surveillance cycle -----------------------------

export async function loadState(statePath) {
  try { return JSON.parse(await readFile(statePath, 'utf8')); } catch { return null; }
}
async function saveState(statePath, state) {
  if (!existsSync(dirname(statePath))) await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

/**
 * Run one surveillance cycle: produce a report, diff vs the stored snapshot,
 * persist the new snapshot, and fire alerts for what is new.
 * @param {object} o
 * @param {() => Promise<object>} o.reportFn  produces a fresh integrity report
 * @param {string} o.statePath                where the snapshot lives
 * @param {Array<Function>} [o.sinks]         alert sinks
 * @param {string} [o.source]
 */
export async function runCycle({ reportFn, statePath, sinks = [consoleSink], source = 'corpus', scoreDropAlert = 5 }) {
  const report = await reportFn();
  const next = snapshotState(report);
  const prev = await loadState(statePath);
  const diff = diffStates(prev, next);
  await saveState(statePath, next);
  const events = eventsFromDiff(diff, { source, scoreDropAlert });
  for (const e of events) for (const sink of sinks) await sink(e);
  return { diff, events, report_score: report.integrity_score, report_grade: report.grade };
}

// Schedule cycles on an interval. Returns a stop() fn. (Wire from the server.)
export function startSurveillance({ intervalMs = 3600_000, ...cycleOpts }) {
  let running = false;
  const tick = async () => { if (running) return; running = true; try { await runCycle(cycleOpts); } catch (e) { console.error('surveillance cycle failed:', e.message); } finally { running = false; } };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  tick();
  return () => clearInterval(timer);
}
