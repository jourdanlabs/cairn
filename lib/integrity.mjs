// CAIRN Integrity Report — the executive/risk artifact. One scored, hashed,
// exportable document that answers: "is this knowledge base internally
// consistent, current, and reachable?"
//
// Scoring philosophy (defensible on purpose):
//   - STRUCTURAL defects (broken links, stale, orphans, duplicate titles) are
//     deterministic and unambiguous — they drive the score.
//   - CONTRADICTIONS are the worst failure, but same-topic ≠ conflict. So an
//     unadjudicated candidate is only a LIGHT penalty; a CONFIRMED contradiction
//     (via adjudication) is heavy, heaviest between two controlled documents.
//   - Untagged / stub notes are surfaced but NOT scored — a compliance library is
//     not "less trustworthy" because a note lacks a tag.
// Because the score responds to confirmed conflicts and structural rot, fixing the
// knowledge base actually moves the number.

import { createHash } from 'node:crypto';
import { audit } from './audit.mjs';
import { similarPairs, adjudicatePairs } from './contradict.mjs';
import { modelEnabled } from './model.mjs';

const sha256 = (o) => createHash('sha256').update(typeof o === 'string' ? o : JSON.stringify(o)).digest('hex');

export async function integrityReport(index, {
  vaultName = '', staleDays = 180, contradictionThreshold = 0.82, maxPairs = 25,
  adjudicate = false, adjudicateLimit = 8, at = new Date().toISOString(),
} = {}) {
  const a = audit(index, { staleDays });
  const overlaps = similarPairs(index, { threshold: contradictionThreshold, maxPairs });
  const controlledCount = index.notes.filter((n) => n.controlled).length;
  const controlledOverlaps = overlaps.available ? overlaps.pairs.filter((p) => p.both_controlled).length : 0;

  // Optionally confirm which candidates are genuine contradictions.
  let adjudicated = false;
  let relByPair = new Map();
  let confirmed = [];
  if (adjudicate && modelEnabled() && overlaps.available && overlaps.pairs.length) {
    const res = await adjudicatePairs(overlaps.pairs, { limit: adjudicateLimit });
    adjudicated = res.adjudicated;
    for (const p of res.pairs) relByPair.set(`${p.a.note}|${p.b.note}`, p.relation);
    confirmed = res.pairs.filter((p) => p.relation === 'contradict');
  }

  // ---- Penalties ----
  const penalties = {
    broken_links: Math.min(24, a.counts.broken_links * 6),
    stale: Math.min(16, a.counts.stale * 4),
    orphans: Math.min(12, a.counts.orphans * 2),
    duplicate_titles: Math.min(9, a.counts.duplicate_titles * 3),
    contradictions: adjudicated
      // Confirmed contradictions: 15 each between controlled docs, 8 otherwise.
      ? Math.min(40, confirmed.reduce((s, p) => s + (p.both_controlled ? 15 : 8), 0))
      // Unconfirmed candidates: light — they may be merely related.
      : Math.min(10, overlaps.available ? overlaps.pairs.length : 0),
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
      adjudicated,
      threshold: overlaps.threshold,
      candidate_count: overlaps.pairs.length,
      controlled_overlaps: controlledOverlaps,
      confirmed_contradictions: adjudicated ? confirmed.length : null,
      candidates: overlaps.pairs.map((p) => ({
        similarity: p.similarity,
        both_controlled: Boolean(p.both_controlled),
        relation: relByPair.get(`${p.a.note}|${p.b.note}`) || (adjudicated ? 'candidate' : null),
        a: { note: p.a.note, heading: p.a.heading || null },
        b: { note: p.b.note, heading: p.b.heading || null },
      })),
      note: adjudicated
        ? 'Adjudicated: only pairs marked "contradict" are confirmed conflicts and scored heavily; "related"/"duplicate" are not.'
        : overlaps.available
          ? 'Same-topic candidates by similarity — NOT confirmed contradictions (lightly scored). controlled_overlaps are authoritative-doc pairs to review first; adjudicate to confirm.'
          : 'Enable embeddings (a model endpoint + MODEL_EMBED) to surface contradictions.',
    },
  };
  return { ...report, report_sha256: sha256(report) };
}
