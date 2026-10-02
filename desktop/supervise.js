// Engine supervisor for CAIRN Studio. The spawned server used to stay dead
// after a crash (an `error` handler but no `exit` handler), so every cairn_*
// tool returned ECONNREFUSED until someone relaunched Studio by hand.
// Now: any unintended exit relaunches with backoff (1s, 2s, 4s … capped), a
// child that stays healthy resets the backoff, and intentional stops
// (vault switch, window close, app quit) never relaunch.
function createSupervisor({ spawn, onEvent = () => {}, baseDelayMs = 1000, maxDelayMs = 30000, healthyAfterMs = 60000 }) {
  let child = null;
  let wantUp = false;
  let everStarted = false;
  let intentional = false; // an exit we caused ourselves (stop/restart)
  let pendingArg;          // restart() arg waiting for the old child to exit
  let hasPending = false;
  let failures = 0;
  let timer = null;
  let healthyTimer = null;
  let lastArg;

  const delayFor = (n) => Math.min(baseDelayMs * 2 ** Math.max(n - 1, 0), maxDelayMs);

  function launch(arg) {
    if (!wantUp) return;
    child = spawn(arg);
    child.on('error', (e) => onEvent(`server error: ${e.message}`));
    child.on('exit', (code, signal) => {
      child = null;
      if (healthyTimer) { clearTimeout(healthyTimer); healthyTimer = null; }
      if (intentional) {
        intentional = false;
        if (wantUp && hasPending) {
          const arg = pendingArg;
          hasPending = false; pendingArg = undefined;
          launch(arg); // vault switch: immediate, no backoff, no failure counted
        }
        return;
      }
      if (!wantUp) return;
      failures++;
      const delay = delayFor(failures);
      onEvent(`server exited (code ${code}, signal ${signal}) — restarting in ${delay} ms (attempt ${failures})`);
      timer = setTimeout(() => { timer = null; launch(lastArg); }, delay);
    });
    if (healthyAfterMs > 0) {
      healthyTimer = setTimeout(() => { healthyTimer = null; failures = 0; }, healthyAfterMs);
    }
  }

  return {
    start(arg) {
      wantUp = true; everStarted = true; failures = 0; lastArg = arg;
      if (timer) { clearTimeout(timer); timer = null; }
      if (!child) launch(arg);
    },
    restart(arg) {
      if (!everStarted) { this.start(arg); return; }
      failures = 0; lastArg = arg;
      if (timer) { clearTimeout(timer); timer = null; }
      if (child) {
        intentional = true; hasPending = true; pendingArg = arg;
        try { child.kill('SIGINT'); } catch { intentional = false; hasPending = false; launch(arg); }
      } else {
        launch(arg);
      }
    },
    stop() {
      wantUp = false; failures = 0;
      if (timer) { clearTimeout(timer); timer = null; }
      if (healthyTimer) { clearTimeout(healthyTimer); healthyTimer = null; }
      hasPending = false; pendingArg = undefined;
      if (child) { intentional = true; try { child.kill('SIGINT'); } catch { intentional = false; child = null; } }
    },
    get child() { return child; },
    get failures() { return failures; },
  };
}

module.exports = { createSupervisor };
