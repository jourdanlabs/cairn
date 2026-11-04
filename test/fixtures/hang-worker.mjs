// A stub extractor that NEVER answers.
//
// The extraction timeout has to be able to kill a stuck file — this is that
// file. It accepts the worker's message and does not reply, and it keeps its
// event loop alive so that only an explicit terminate() can end it. That is
// exactly the shape of the real failure: a pathological PDF that stalls the
// parser indefinitely.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', () => {
  // deliberately silent — the parent's timeout is the only way out
});

setInterval(() => {}, 1000);
