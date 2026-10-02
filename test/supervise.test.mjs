// desktop/supervise.js: a dead engine relaunches with backoff; intentional
// stops never relaunch. Real child processes (spawned, SIGKILLed) — no mocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const { createSupervisor } = createRequire(import.meta.url)('../desktop/supervise.js');
const tick = (n = 10) => new Promise((r) => setTimeout(r, n));
const sleeper = () => spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
async function waitFor(cond, ms = 4000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out waiting for condition');
    await tick();
  }
}

test('SIGKILLed child relaunches with a new pid', async () => {
  const events = [];
  const s = createSupervisor({ spawn: sleeper, onEvent: (m) => events.push(m), baseDelayMs: 50 });
  s.start();
  await waitFor(() => s.child && s.child.pid);
  const first = s.child.pid;
  s.child.kill('SIGKILL');
  await waitFor(() => s.child && s.child.pid !== first);
  assert.ok(events.some((m) => /restarting in 50 ms/.test(m)), JSON.stringify(events));
  s.stop();
});

test('backoff escalates across rapid crashes, then resets after healthy time', async () => {
  const events = [];
  const s = createSupervisor({
    spawn: sleeper, onEvent: (m) => events.push(m), baseDelayMs: 60, healthyAfterMs: 120,
  });
  s.start();
  await waitFor(() => s.child && s.child.pid);
  s.child.kill('SIGKILL');
  await waitFor(() => events.some((m) => /attempt 1/.test(m)));
  await waitFor(() => s.child && s.child.pid);
  s.child.kill('SIGKILL');
  await waitFor(() => events.some((m) => /attempt 2/.test(m)));
  assert.ok(events.some((m) => /restarting in 60 ms/.test(m)));
  assert.ok(events.some((m) => /restarting in 120 ms/.test(m)));
  s.stop();
});

test('stop() never relaunches', async () => {
  const events = [];
  const s = createSupervisor({ spawn: sleeper, onEvent: (m) => events.push(m), baseDelayMs: 40 });
  s.start();
  await waitFor(() => s.child && s.child.pid);
  s.stop();
  await tick(250);
  assert.equal(s.child, null);
  assert.ok(!events.some((m) => /restarting/.test(m)));
});

test('restart() swaps to the new arg immediately without backoff', async () => {
  const seen = [];
  const events = [];
  const s = createSupervisor({
    spawn: (arg) => { seen.push(arg); return sleeper(); },
    onEvent: (m) => events.push(m),
    baseDelayMs: 40,
  });
  s.start('vault-a');
  await waitFor(() => s.child && s.child.pid);
  const first = s.child.pid;
  s.restart('vault-b');
  await waitFor(() => s.child && s.child.pid !== first);
  assert.deepEqual(seen, ['vault-a', 'vault-b']);
  assert.ok(!events.some((m) => /restarting/.test(m)));
  s.stop();
});
