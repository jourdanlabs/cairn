// Single-flight reindex runner. Vault writes arriving while a build+embed pass
// is running must not start a second pass (two full indexes plus two embed
// passes is what pushed Studio's engine past its heap on 2026-10-02). Instead
// they queue exactly one follow-up, and the superseded pass is told to stop
// via shouldAbort() the moment the new write lands.
export function createRunner(run, onError = () => {}) {
  let running = false;
  let queued = false;
  let gen = 0;
  async function pump() {
    if (running) return;
    running = true;
    try {
      do {
        queued = false;
        const mine = gen;
        try {
          await run(() => mine !== gen);
        } catch (e) { onError(e); }
      } while (queued);
    } finally {
      running = false;
    }
  }
  return {
    schedule() {
      gen++; // invalidate the in-flight pass first: it winds down instead of
      // running to completion while its replacement waits behind it.
      if (running) { queued = true; return; }
      pump().catch(onError);
    },
  };
}
