// lib/reindex.mjs: one build+embed pass in flight at a time; writes during a
// pass queue exactly one follow-up; the superseded pass sees shouldAbort().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRunner } from '../lib/reindex.mjs';

const tick = (n = 5) => new Promise((r) => setTimeout(r, n));

test('concurrent schedules collapse to one follow-up', async () => {
  let runs = 0;
  const release = [];
  const gate = () => new Promise((r) => release.push(r));
  const r = createRunner(async () => { runs++; await gate(); });
  r.schedule();
  await tick();
  r.schedule(); r.schedule(); r.schedule(); // three writes during the pass
  assert.equal(runs, 1);
  release.shift()(); // finish pass 1 → exactly one follow-up
  await tick(20);
  assert.equal(runs, 2);
  release.shift()();
  await tick(20);
  assert.equal(runs, 2); // no third pass
});

test('the superseded pass observes abort when the follow-up begins', async () => {
  const seen = [];
  const release = [];
  const r = createRunner(async (shouldAbort) => {
    seen.push(shouldAbort());
    await new Promise((res) => release.push(res));
    seen.push(shouldAbort());
  });
  r.schedule();
  await tick();
  r.schedule(); // invalidates pass 1 immediately, queues the follow-up
  assert.deepEqual(seen, [false]);
  release.shift()(); // pass 1 ends → follow-up starts
  await tick(20);
  // pass 1 observed the abort (true); the follow-up is current (false)
  assert.deepEqual(seen, [false, true, false]);
  release.shift()();
  await tick(20);
});

test('abort fires for a pass still running when the next begins', async () => {
  // Slow first pass that never resolves on its own; the follow-up must still run.
  let firstAborted = null;
  let secondRan = false;
  const r = createRunner(async (shouldAbort) => {
    if (firstAborted === null) {
      await new Promise((res) => {
        const t = setInterval(() => {
          if (shouldAbort()) { clearInterval(t); firstAborted = true; res(); }
        }, 5);
      });
    } else {
      secondRan = true;
    }
  });
  r.schedule();
  await tick();
  r.schedule();
  // The queued follow-up cannot start until the first pass returns; the first
  // pass returns once it sees the abort. Drive it: poll until settled.
  for (let i = 0; i < 200 && !secondRan; i++) await tick();
  assert.equal(firstAborted, true);
  assert.equal(secondRan, true);
});

test('a throwing pass still drains the queue', async () => {
  let runs = 0;
  const errors = [];
  const r = createRunner(async () => {
    runs++;
    if (runs === 1) throw new Error('boom');
  }, (e) => errors.push(e.message));
  r.schedule();
  await tick();
  r.schedule();
  await tick(20);
  assert.equal(runs, 2);
  assert.deepEqual(errors, ['boom']);
});
