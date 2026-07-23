// CAIRN consolidation — the "held knowledge" layer. Retrieval answers questions by
// re-reading the corpus every time; consolidation distills what the corpus SAYS about an
// entity into a card of durable facts — and, unlike every other second-brain tool, each
// fact must survive mechanical verification: the model's verbatim quote is checked
// character-for-character against the passage it cites. A fact that can't produce its
// receipt is dropped, not kept. Synthesis you can audit — never synthesis you must trust.
//
// Cards are written into the vault as markdown, so the existing lexical/hybrid search
// indexes them like any note — biographical questions ("what is Pan's surname") hit the
// card's plain factual phrasing instead of gambling on a lucky chunk. Pure Node, no deps.

import { createHash } from 'node:crypto';

export const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'entity';

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const normLoose = (s) => norm(s).replace(/[‘’]/g, "'").replace(/[“”]/g, '"').toLowerCase();

// ── passage gathering ───────────────────────────────────────────────────────────
// Two probes, because question-phrased retrieval alone misses identity facts (nobody
// writes "surname" next to the name):
//  1. search probe — several query variants through the normal search pipeline.
//  2. collocation probe — deterministic scan for capitalized bigrams around the entity
//     name ("Pan Jourdan", "CAIRN Studio"); the chunks holding the top collocates come
//     along even when no query phrasing would surface them.
export function collocations(index, entity, { top = 3 } = {}) {
  const ent = entity.trim();
  // "Pan Jourdan" / "OG Bulma" — entity followed-by or preceded-by a Capitalized word.
  const after = new RegExp(`\\b${escapeRe(ent)}\\s+([A-Z][a-zA-Z]{2,})`, 'g');
  const before = new RegExp(`\\b([A-Z][a-zA-Z]{2,})\\s+${escapeRe(ent)}\\b`, 'g');
  const counts = new Map(); // collocate word -> { n, chunkIds:Set }
  for (const c of index.chunks) {
    if (isDerived(c)) continue; // cards can never be evidence for cards
    if (!c.text || !c.text.includes(ent)) continue;
    for (const re of [after, before]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(c.text))) {
        const w = m[1];
        if (STOP_COLLOCATES.has(w)) continue;
        const e = counts.get(w) || { n: 0, chunkIds: new Set(), phrase: norm(m[0]) };
        e.n++; e.chunkIds.add(c.id);
        counts.set(w, e);
      }
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].n - a[1].n)
    .slice(0, top)
    .map(([word, e]) => ({ word, n: e.n, phrase: e.phrase, chunkIds: [...e.chunkIds] }));
}

// Name evidence — a DETERMINISTIC identity fact. If the corpus pairs the entity with one
// TitleCase neighbor over and over ("Pan Jourdan" ×61, "CAIRN Studio"), that pairing is a
// statistical fact about the corpus; no model gets to overlook it and none is asked to.
// The receipt is a verbatim sample sentence pulled straight from a source chunk.
export function nameEvidence(index, entity, { minMentions = 3 } = {}) {
  // Entity-FIRST bigrams only ("Pan Jourdan", "CAIRN Studio"): the reverse direction is
  // dominated by sentence-start artifacts ("Want Pan", "Now Pan") that are capitalized by
  // position, not by being names. TitleCase filter drops ALLCAPS statuses/gates.
  const col = collocations(index, entity, { top: 8 })
    .find((c) => c.phrase.startsWith(entity) && /^[A-Z][a-z]+$/.test(c.word) && c.n >= minMentions);
  if (!col) return null;
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  for (const id of col.chunkIds) {
    const c = byId.get(id);
    const at = c?.text.indexOf(col.phrase);
    if (at == null || at < 0) continue;
    const start = Math.max(0, at - 80);
    const quote = c.text.slice(start, at + col.phrase.length + 80).replace(/\s+/g, ' ').trim();
    return {
      fact: `Most often named in full as “${col.phrase}” (${col.n} corpus mentions).`,
      phrase: col.phrase, mentions: col.n,
      quote, note: c.noteRel, title: c.noteTitle, deterministic: true,
    };
  }
  return null;
}
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The held-knowledge layer is DERIVED — it must never be its own evidence, or a stale
// card's error re-verifies against itself forever (consolidation ouroboros).
const isDerived = (c) => String(c.noteRel || '').startsWith('cards/');
// Sentence-starters and glue that follow names constantly but identify nothing.
const STOP_COLLOCATES = new Set(['The', 'This', 'That', 'And', 'But', 'For', 'Not', 'You', 'She', 'Her', 'His', 'They', 'Then', 'When', 'What', 'Who', 'Will', 'Was', 'Has', 'Had', 'Can', 'Its', 'Also', 'All', 'Just', 'Says', 'Said', 'Asked']);

export function gatherPassages(index, entity, { searchFn, maxPassages = 14, window = 900 } = {}) {
  const byId = new Map(index.chunks.map((c) => [c.id, c]));
  const picked = new Map(); // chunkId -> { chunk, why }
  const add = (id, why) => {
    const c = byId.get(id);
    if (c && !isDerived(c) && !picked.has(id)) picked.set(id, { chunk: c, why });
  };

  // Probe 1 — collocations FIRST: chunks holding the strongest name-neighbors carry the
  // identity facts search can't phrase, and running them first both tags them correctly
  // and guarantees they survive the passage cap.
  for (const col of collocations(index, entity)) {
    for (const id of col.chunkIds.slice(0, 2)) add(id, `collocation:${col.word}`);
  }

  // Probe 2 — search variants (identity, role, decisions: the durable-fact angles).
  const variants = [
    entity,
    `who is ${entity} identity full name role`,
    `what is ${entity} status decision plan`,
    `${entity} relationship history background`,
  ];
  for (const q of variants) {
    const r = searchFn(q, { k: 6, perNote: 2 });
    for (const h of r.hits || []) add(h.id, 'search');
  }

  // Excerpt each chunk around the FIRST entity mention (context budget beats chunk size).
  const out = [];
  for (const { chunk, why } of picked.values()) {
    let text = chunk.text || '';
    const at = text.indexOf(entity);
    if (text.length > window) {
      const start = Math.max(0, (at < 0 ? 0 : at) - Math.floor(window / 3));
      text = (start > 0 ? '…' : '') + text.slice(start, start + window) + (start + window < chunk.text.length ? '…' : '');
    }
    out.push({ id: chunk.id, note: chunk.noteRel, title: chunk.noteTitle, why, text });
    if (out.length >= maxPassages) break;
  }
  return out; // Map preserves insertion order: collocation passages lead by construction

}

// ── extraction (model, temp 0) ──────────────────────────────────────────────────
export function extractionPrompt(entity, passages) {
  const listed = passages.map((p, i) => `[${i + 1}] (source: ${p.note}) ${norm(p.text)}`).join('\n\n');
  return [
    { role: 'system', content: 'You consolidate knowledge from a personal archive into verified facts. You output STRICT JSON only — no prose, no code fences. You never invent: every fact must be directly supported by a verbatim quote copied character-for-character from one passage.' },
    { role: 'user', content: `Entity: "${entity}"\n\nPassages:\n${listed}\n\nExtract durable facts about ${entity}. Output exactly this JSON shape:\n{"type":"person|project|company|concept|other","facts":[{"fact":"<short declarative sentence>","quote":"<exact verbatim substring from ONE passage>","passage":<number>}]}\n\nRules: at most 12 facts. The quote must be copied exactly from the passage it cites (it will be machine-checked; paraphrased quotes are discarded). Prefer identity facts (full name, role, relationships), decisions, and current status. Skip speculation, plans that never happened, and anything a quote does not directly support.` },
  ];
}

export function parseFacts(raw) {
  // Models fence or preface JSON despite instructions; dig the object out.
  const text = String(raw).replace(/```json|```/g, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in model output');
  const j = JSON.parse(text.slice(start, end + 1));
  return { type: typeof j.type === 'string' ? j.type : 'other', facts: Array.isArray(j.facts) ? j.facts : [] };
}

// ── verification — the part that makes this CAIRN and not a vibes engine ────────
// A fact survives only if its quote is a real substring of the passage it cites
// (whitespace-normalized, quote-mark-tolerant). Everything else is dropped and counted;
// dropped facts are reported, never silently kept.
export function verifyFacts(facts, passages) {
  const verified = [], dropped = [];
  for (const f of facts) {
    const idx = Number(f.passage) - 1;
    const p = passages[idx];
    const quote = norm(String(f.quote || ''));
    if (!p) { dropped.push({ ...f, reason: 'cites a passage that does not exist' }); continue; }
    if (quote.length < 12) { dropped.push({ ...f, reason: 'quote too short to verify' }); continue; }
    if (!normLoose(p.text).includes(normLoose(quote))) {
      dropped.push({ ...f, reason: 'quote not found verbatim in cited passage' });
      continue;
    }
    verified.push({ fact: norm(String(f.fact || '')), quote, note: p.note, title: p.title });
  }
  return { verified, dropped };
}

// ── card rendering ──────────────────────────────────────────────────────────────
export function renderCard({ entity, type, verified, dropped, passages, generatedAt, nameFact = null }) {
  // The deterministic name line leads, phrased the way people actually ask ("full name")
  // and labeled for what it is: corpus evidence, not an assertion from anywhere else.
  const nameLine = nameFact
    ? `- **Full name (corpus evidence):** ${nameFact.phrase} — ${nameFact.mentions} mentions across the corpus — “${nameFact.quote.length > 220 ? nameFact.quote.slice(0, 220) + '…' : nameFact.quote}” — \`${nameFact.note}\`\n`
    : '';
  const factLines = verified.map((f) =>
    `- **${f.fact}** — “${f.quote.length > 220 ? f.quote.slice(0, 220) + '…' : f.quote}” — \`${f.note}\``).join('\n');
  const body = `# ${entity} — held knowledge\n\n` +
    `Consolidated card for **${entity}** (${type}). Every fact below carries a verbatim quote ` +
    `verified mechanically against its source passage; extractions that failed verification were ` +
    `dropped, not kept.\n\n${nameLine}${factLines}\n\n` +
    `*Derived from ${passages.length} passages · ${verified.length} facts verified · ${dropped.length} dropped as unverifiable · regenerate via \`POST /api/consolidate\`.*\n`;
  const receipt = createHash('sha256').update(body).digest('hex');
  const fm = `---\nentity: ${JSON.stringify(entity)}\ncard: held-knowledge\ntype: ${type}\ngenerated: ${generatedAt}\nsources: ${passages.length}\nfacts_verified: ${verified.length}\nfacts_dropped: ${dropped.length}\nreceipt: sha256:${receipt}\n---\n\n`;
  return { markdown: fm + body, receipt };
}

// ── orchestration ───────────────────────────────────────────────────────────────
export async function consolidateEntity(index, entity, { chatFn, searchFn, now } = {}) {
  const passages = gatherPassages(index, entity, { searchFn });
  if (!passages.length) return { entity, passages, verified: [], dropped: [], markdown: null, receipt: null };
  const raw = await chatFn(extractionPrompt(entity, passages));
  const { type, facts } = parseFacts(raw);
  const { verified, dropped } = verifyFacts(facts, passages);
  // The deterministic name-evidence fact exists whether or not the model noticed the
  // name — its quote is its receipt, and it leads the rendered card.
  const nameFact = nameEvidence(index, entity);
  const generatedAt = now || new Date().toISOString();
  const { markdown, receipt } = renderCard({ entity, type, verified, dropped, passages, generatedAt, nameFact });
  return { entity, type, passages, verified, dropped, nameFact, markdown, receipt, generatedAt };
}
