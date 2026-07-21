// CAIRN Integrity Report — the executive/risk artifact. One scored, hashed,
// exportable document that answers: "is this knowledge base internally
// consistent, current, and reachable?" Combines the deterministic audit with
// embedding-based contradiction candidates. Deterministic given the same index.

import { createHash } from 'node:crypto';
import { audit } from './audit.mjs';
import { similarPairs } from './contradict.mjs';

const sha256 = (o) => createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex');

export function integrityReport(index, { vaultName = '', staleDays = 180, contradictionThreshold = 0.82, maxPairs = 25, at = new Date().toISOString() } = {}) {
  const a = audit(index, { staleDays });
  const overlaps = similarPairs(index, { threshold: contradictionThreshold, maxPairs });
  const N = Math.max(1, index.notes.length);

  // Controlled = authoritative/governing docs. A contradiction between two of them
  // is the worst kind of integrity failure — escalate it to HIGH severity.
  const controlledCount = index.notes.filter((n) => n.controlled).length;
  const highSev = overlaps.available ? overlaps.pairs.filter((p) => p.both_controlled).length : 0;

  // Each dimension penalizes the score, capped, so no single issue tanks it.
  const dim = (count, cap) => Math.min(cap, Math.round((count / N) * cap * 4));
  const penalties = {
    broken_links: dim(a.counts.broken_links, 20),
    // Base 2/pair, +8 extra for each controlled↔controlled pair (the worst kind).
    contradictions: overlaps.available ? Math.min(30, overlaps.pairs.length * 2 + highSev * 8) : 0,
    stale: dim(a.counts.stale, 12),
    orphans: dim(a.counts.orphans, 12),
    duplicate_titles: dim(a.counts.duplicate_titles, 10),
  };
  const score = Math.max(0, 100 - Object.values(penalties).reduce((s, x) => s + x, 0));
  const grade = score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F';

  const report = {
    tool: 'cairn',
    kind: 'integrity_report',
    vault: vaultName,
    integrity_score: score,
    grade,
    generated_at: at,
    index_built_at: index.builtAt || null,
    totals: { notes: index.notes.length, chunks: index.N, embedded: Boolean(index.embedded) },
    controlled_coverage: { controlled: controlledCount, total: index.notes.length },
    penalties,
    findings: a.findings.map((f) => ({ key: f.key, label: f.label, hint: f.hint, count: f.items.length, items: f.items.slice(0, 100) })),
    contradictions: {
      available: overlaps.available,
      threshold: overlaps.threshold,
      candidate_count: overlaps.pairs.length,
      high_severity_contradictions: highSev,
      candidates: overlaps.pairs.map((p) => ({
        similarity: p.similarity,
        both_controlled: Boolean(p.both_controlled),
        a: { note: p.a.note, heading: p.a.heading || null },
        b: { note: p.b.note, heading: p.b.heading || null },
      })),
      note: overlaps.available
        ? 'Candidate overlaps by embedding similarity. Run adjudication (/api/contradictions with adjudicate) for contradict/duplicate verdicts.'
        : 'Enable embeddings (a model endpoint + MODEL_EMBED) to surface contradictions.',
    },
  };
  return { ...report, report_sha256: sha256(report) };
}
