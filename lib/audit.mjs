// CAIRN audit — the CRUCIBLE-shaped pass over the vault. It does not answer
// questions; it finds where the knowledge base itself is weak: orphans, broken
// links, stale notes, duplicate titles, stubs, untagged. Deterministic, offline.

export function audit(index, { staleDays = 180 } = {}) {
  const now = Date.now();
  const staleMs = staleDays * 86400000;

  const orphans = [];
  const stale = [];
  const stubs = [];
  const untagged = [];
  const broken = [];
  const titleGroups = new Map();

  for (const n of index.notes) {
    if (n.inbound === 0 && n.outlinks.length === 0) orphans.push({ note: n.rel, title: n.title });
    if ((now - n.mtimeMs > staleMs) && (n.hasMarkers || n.openTasks > 0)) {
      stale.push({ note: n.rel, title: n.title, age_days: Math.round((now - n.mtimeMs) / 86400000), open_tasks: n.openTasks });
    }
    if (n.stub) stubs.push({ note: n.rel, title: n.title, words: n.wordCount });
    if (n.tags.length === 0) untagged.push({ note: n.rel, title: n.title });

    for (const l of n.outlinks) {
      if (!index.byName.has(l.toLowerCase())) broken.push({ from: n.rel, link: l });
    }

    const key = n.title.toLowerCase();
    if (!titleGroups.has(key)) titleGroups.set(key, []);
    titleGroups.get(key).push(n.rel);
  }

  const duplicate_titles = [];
  for (const [title, files] of titleGroups) {
    if (files.length > 1) duplicate_titles.push({ title, notes: files });
  }

  stale.sort((a, b) => b.age_days - a.age_days);

  const findings = [
    { key: 'orphans', label: 'Orphan notes', hint: 'Nothing links in or out — easy to lose.', items: orphans },
    { key: 'broken_links', label: 'Broken links', hint: 'A [[link]] points at a note that does not exist.', items: broken },
    { key: 'stale', label: 'Stale notes', hint: `Older than ${staleDays} days with open tasks or TODO/DRAFT markers.`, items: stale },
    { key: 'duplicate_titles', label: 'Duplicate titles', hint: 'Two notes share a title — retrieval ambiguity.', items: duplicate_titles },
    { key: 'stubs', label: 'Stub notes', hint: 'Under ~12 words — probably unfinished.', items: stubs },
    { key: 'untagged', label: 'Untagged notes', hint: 'No tags — harder to surface by topic.', items: untagged },
  ];

  return {
    total_notes: index.notes.length,
    total_chunks: index.N,
    findings,
    counts: Object.fromEntries(findings.map((f) => [f.key, f.items.length])),
  };
}
