// Phase 4 — surveillance: baseline, no-change, and regression cycles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCycle, diffStates, snapshotState, fileSink, eventsFromDiff } from '../core/surveillance.mjs';

const report = (score, grade, { broken = [], orphans = [], stale = [], cands = [] }) => ({
  integrity_score: score, grade, generated_at: '2026-07-22T00:00:00.000Z',
  findings: [
    { key: 'broken_links', items: broken },
    { key: 'orphans', items: orphans },
    { key: 'stale', items: stale },
    { key: 'duplicate_titles', items: [] },
  ],
  contradictions: { candidates: cands },
});

const BEFORE = report(73, 'C', {
  broken: [{ from: 'data-classification-policy.md', link: 'Cryptographic Key Management Standard' }],
  orphans: [{ note: 'notes/unfiled-meeting-notes.md' }],
  stale: [{ note: 'archive/legacy-retention-note-2019.md' }],
  cands: [
    { a: { note: 'policies/data-retention-policy.md' }, b: { note: 'policies/records-management-standard.md' }, relation: 'contradict' },
    { a: { note: 'policies/access-control-policy.md' }, b: { note: 'policies/incident-response-policy.md' }, relation: 'related' },
  ],
});

const AFTER = report(100, 'A', {
  cands: [{ a: { note: 'policies/access-control-policy.md' }, b: { note: 'policies/incident-response-policy.md' }, relation: 'related' }],
});

const REGRESSED = report(85, 'B', {
  broken: [{ from: 'change-management-policy.md', link: 'Model Risk Standard' }],
  cands: [{ a: { note: 'policies/aml-kyc-policy.md' }, b: { note: 'policies/vendor-risk-management-policy.md' }, relation: 'contradict' }],
});

test('diffStates: resolution and regression are detected', () => {
  const d1 = diffStates(snapshotState(BEFORE), snapshotState(AFTER));
  assert.equal(d1.score_delta, 27);
  assert.ok(d1.resolved_confirmed_contradictions.some((k) => k.includes('data-retention-policy')));
  assert.equal(d1.new_confirmed_contradictions.length, 0);

  const d2 = diffStates(snapshotState(AFTER), snapshotState(REGRESSED));
  assert.equal(d2.score_delta, -15);
  assert.ok(d2.new_confirmed_contradictions.some((k) => k.includes('aml-kyc-policy')));
});

test('eventsFromDiff: first run is silent; regression alerts high', () => {
  assert.deepEqual(eventsFromDiff(diffStates(null, snapshotState(BEFORE))), []); // baseline
  const ev = eventsFromDiff(diffStates(snapshotState(AFTER), snapshotState(REGRESSED)));
  assert.ok(ev.some((e) => e.type === 'new_contradiction' && e.severity === 'high'));
  assert.ok(ev.some((e) => e.type === 'new_broken_link'));
  assert.ok(ev.some((e) => e.type === 'score_drop'));
});

test('runCycle: baseline → clean → regression, with a file sink', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cairn-surv-'));
  const statePath = join(dir, 'state.json');
  const alertPath = join(dir, 'alerts.jsonl');
  const sink = fileSink(alertPath);

  const c1 = await runCycle({ reportFn: async () => BEFORE, statePath, sinks: [sink] });
  assert.equal(c1.diff.first_run, true);
  assert.equal(c1.events.length, 0); // baseline: no alerts
  assert.equal(existsSync(alertPath), false);

  const c2 = await runCycle({ reportFn: async () => AFTER, statePath, sinks: [sink] });
  assert.equal(c2.events.length, 0); // everything improved → nothing to alert

  const c3 = await runCycle({ reportFn: async () => REGRESSED, statePath, sinks: [sink] });
  assert.ok(c3.events.some((e) => e.type === 'new_contradiction'));

  const lines = (await readFile(alertPath, 'utf8')).trim().split('\n');
  assert.ok(lines.length >= 1);
  assert.ok(JSON.parse(lines[0]).message);
});
