// Extraction worker — runs the zero-dep extractors OFF the main thread.
//
// The extractors are synchronous and CPU-bound, so a pathological document (the
// RRC Chapter 3 PDF never finished inside a 180 s cap) could only stall the
// process — there was no timeout and no kill path anywhere in the call. Here the
// parent owns the limit: it can terminate this worker and move on. The file is
// reported as EXTRACT_TIMEOUT, never silently dropped.
//
// The worker answers exactly once, with the same shape extractText() returns.

import { parentPort, workerData } from 'node:worker_threads';
import { extractText } from './extract.mjs';

const { buf, ext } = workerData || {};
const bytes = Buffer.isBuffer(buf) ? buf : Buffer.from(buf || []);

try {
  parentPort.postMessage(extractText(bytes, ext));
} catch (err) {
  parentPort.postMessage({ text: '', ok: false, note: `extract failed: ${err.message}` });
}
