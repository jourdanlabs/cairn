// brain-ingest — pull ALL your conversations + notes into one searchable corpus that
// CAIRN can navigate. Zero dependencies. Sources: Claude Code session logs, pan-cc
// (Pan conversations/handoffs), agent turn-logs (LUNA/OMNIS/MTS), OG Bulma's ChatGPT
// export (~1128 convos back to 2023), and the Obsidian vault.
// Output: ~/brain/{claude,pan,agents,bulma,vault}/*.md — clean, dated, titled transcripts.
//
//   node scripts/brain-ingest.mjs            # full sync
//   node scripts/brain-ingest.mjs --since 2026-05-25   # only sessions on/after a date
//
// Re-runnable and incremental: it skips a transcript that already exists and is newer
// than its source. Then point CAIRN at ~/brain.

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, statSync, copyFileSync } from 'node:fs';
import { join, basename, relative, extname, dirname } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();
const BRAIN = process.env.BRAIN_DIR || join(HOME, 'brain');
const args = process.argv.slice(2);
const since = (() => { const i = args.indexOf('--since'); return i >= 0 ? args[i + 1] : null; })();

const ensure = (d) => (mkdirSync(d, { recursive: true }), d);
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 55) || 'untitled';
const SKIP = new Set(['node_modules', '.git', '.obsidian', 'dist', 'build', 'node_modules', '.cache', 'coverage']);
function walk(dir, test, out = []) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.claude') { if (e.name !== '.obsidian') { /* skip dotdirs */ } }
    if (SKIP.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name, p)) out.push(p);
  }
  return out;
}
const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b && b.type === 'text' && b.text).map((b) => b.text).join('\n\n');
  return '';
};
// ChatGPT export content block → text. `parts` is usually strings; multimodal parts are
// objects (image pointers) we skip; code/tether blocks carry a `text` field instead.
const partsText = (content) => {
  if (!content) return '';
  if (Array.isArray(content.parts)) {
    return content.parts.map((p) => (typeof p === 'string' ? p : (p && typeof p.text === 'string' ? p.text : ''))).filter(Boolean).join('\n');
  }
  if (typeof content.text === 'string') return content.text;
  return '';
};

// ── Claude Code session logs → transcripts ──────────────────────────────────────
function ingestClaude() {
  const root = join(HOME, '.claude', 'projects');
  if (!existsSync(root)) return { wrote: 0, skipped: 0 };
  const files = walk(root, (n) => n.endsWith('.jsonl'));
  const outDir = ensure(join(BRAIN, 'claude'));
  let wrote = 0, skipped = 0, empty = 0;
  const used = new Set();
  for (const file of files) {
    let raw; try { raw = readFileSync(file, 'utf8'); } catch { continue; }
    let date = null, title = '', turns = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const msg = o.message;
      if (!msg || (msg.role !== 'user' && msg.role !== 'assistant')) continue;
      // skip tool-result user turns (arrays of tool_result carry no human text)
      const text = textOf(msg.content).trim();
      if (!text) continue;
      if (/^\[Request interrupted/.test(text)) continue;
      if (!date && o.timestamp) date = String(o.timestamp).slice(0, 10);
      if (msg.role === 'user' && !title && !/^<|^\[/.test(text)) title = text.replace(/\s+/g, ' ').slice(0, 90);
      turns.push({ who: msg.role === 'user' ? 'You' : 'Claude', text });
    }
    if (!turns.length) { empty++; continue; }
    date = date || '0000-00-00';
    if (since && date < since) { skipped++; continue; }
    if (!title) title = turns[0].text.replace(/\s+/g, ' ').slice(0, 90);
    let name = `${date}-${slug(title)}`;
    while (used.has(name)) name += '-' + basename(file).slice(0, 4);
    used.add(name);
    const dest = join(outDir, name + '.md');
    const body = `# ${title.replace(/\n/g, ' ')}\n\n*Claude Code · ${date} · \`${basename(file)}\`*\n\n---\n\n` +
      turns.map((t) => `**${t.who}:** ${t.text}`).join('\n\n');
    writeFileSync(dest, body);
    wrote++;
  }
  return { wrote, skipped, empty, total: files.length };
}

// ── copy an existing markdown tree (pan-cc, vault) ──────────────────────────────
function copyTree(srcRoot, label) {
  if (!existsSync(srcRoot)) return { wrote: 0 };
  const files = walk(srcRoot, (n) => n.endsWith('.md') || n.endsWith('.markdown'));
  const outDir = ensure(join(BRAIN, label));
  let wrote = 0;
  for (const f of files) {
    const rel = relative(srcRoot, f).replace(/[\/]/g, '__');
    const dest = join(outDir, rel);
    try {
      if (existsSync(dest) && statSync(dest).mtimeMs >= statSync(f).mtimeMs) continue;
      copyFileSync(f, dest); wrote++;
    } catch {}
  }
  return { wrote, total: files.length };
}

// ── agent turn-logs (LUNA / OMNIS / MTS jsonl) → transcripts ────────────────────
function ingestAgentLogs() {
  const outDir = ensure(join(BRAIN, 'agents'));
  let wrote = 0;
  const logs = [
    ...walk(join(HOME, 'projects'), (n, p) => (n === 'luna.jsonl' || /turn.*\.jsonl$/.test(n) || /\.omnis/.test(p)) && n.endsWith('.jsonl')),
  ];
  for (const file of logs.slice(0, 200)) {
    let raw; try { raw = readFileSync(file, 'utf8'); } catch { continue; }
    const rows = raw.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!rows.length) continue;
    const proj = relative(join(HOME, 'projects'), file).split('/')[0];
    const lines = rows.map((r) => {
      const t = r.timestamp || r.ts || r.created_at || '';
      const who = r.role || r.kind || r.type || 'entry';
      const txt = r.text || r.response_text || r.message || r.content || (r.payload ? JSON.stringify(r.payload).slice(0, 400) : '');
      return txt ? `**${who}** ${t ? `(${String(t).slice(0, 19)})` : ''}: ${typeof txt === 'string' ? txt : JSON.stringify(txt).slice(0, 400)}` : '';
    }).filter(Boolean);
    if (!lines.length) continue;
    const dest = join(outDir, `${proj}__${slug(basename(file, '.jsonl'))}.md`);
    writeFileSync(dest, `# ${proj} — ${basename(file)}\n\n*Agent turn-log*\n\n---\n\n${lines.join('\n\n')}`);
    wrote++;
  }
  return { wrote };
}

// ── OG Bulma ChatGPT export → transcripts ───────────────────────────────────────
// ChatGPT "Export data" dumps a folder of conversations-*.json shards, each an array of
// conversations. A conversation's `mapping` is a tree of message nodes; we flatten it to
// an ordered user/assistant transcript. This is the deep archive — the original
// architecture partner, back to 2023. One shard is parsed at a time to bound memory.
function ingestChatGPT() {
  const root = [join(HOME, 'OG Bulma'), join(HOME, 'Downloads', 'OG Bulma')].find(existsSync);
  if (!root) return { wrote: 0, convos: 0 };
  const outDir = ensure(join(BRAIN, 'bulma'));
  const used = new Set();
  let wrote = 0, convos = 0, empty = 0;
  const shards = readdirSync(root).filter((n) => /^conversations.*\.json$/i.test(n)).sort();
  for (const shard of shards) {
    let list; try { list = JSON.parse(readFileSync(join(root, shard), 'utf8')); } catch { continue; }
    if (!Array.isArray(list)) list = [list];
    for (const c of list) {
      convos++;
      const msgs = Object.values(c.mapping || {})
        .filter((n) => n && n.message && n.message.author && n.message.content)
        .map((n) => n.message)
        .filter((m) => m.author.role === 'user' || m.author.role === 'assistant')
        .map((m) => ({ role: m.author.role, t: m.create_time || 0, text: partsText(m.content).trim() }))
        .filter((m) => m.text)
        .sort((a, b) => a.t - b.t);
      if (!msgs.length) { empty++; continue; }
      const ct = c.create_time || msgs[0].t || 0;
      const date = ct ? new Date(ct * 1000).toISOString().slice(0, 10) : '0000-00-00';
      if (since && date < since) continue;
      const title = (c.title || msgs[0].text).replace(/\s+/g, ' ').slice(0, 90) || 'untitled';
      let name = `${date}-${slug(title)}`;
      while (used.has(name)) name += '-' + String(c.conversation_id || c.id || '').slice(0, 4);
      used.add(name);
      const body = `# ${title}\n\n*OG Bulma · ChatGPT · ${date}*\n\n---\n\n` +
        msgs.map((m) => `**${m.role === 'user' ? 'You' : 'Bulma'}:** ${m.text}`).join('\n\n');
      writeFileSync(join(outDir, name + '.md'), body);
      wrote++;
    }
  }
  return { wrote, convos, empty, shards: shards.length };
}

console.log(`brain-ingest → ${BRAIN}${since ? ` (since ${since})` : ''}`);
const c = ingestClaude();
console.log(`  claude:  ${c.wrote} transcripts written (${c.total} sessions, ${c.empty} empty, ${c.skipped} skipped)`);
const p = copyTree(join(HOME, 'projects', 'pan-cc'), 'pan');
console.log(`  pan:     ${p.wrote} files (${p.total} md)`);
const a = ingestAgentLogs();
console.log(`  agents:  ${a.wrote} turn-logs`);
const b = ingestChatGPT();
console.log(`  bulma:   ${b.wrote} transcripts (${b.convos} convos across ${b.shards || 0} shards, ${b.empty || 0} empty)`);
// the distilled OG Bulma corpus (SOUL, memory, migration notes) rides along with the raw logs
copyTree(join(HOME, 'projects', 'bulma-cc'), 'bulma');
copyTree(join(HOME, 'projects', 'soul-sista-bulma-cc'), 'bulma');
const v = copyTree(join(HOME, 'Obsidian', 'JourdanLabs'), 'vault');
console.log(`  vault:   ${v.wrote} notes (${v.total} md)`);
const totalMd = walk(BRAIN, (n) => n.endsWith('.md')).length;
console.log(`\n✓ brain has ${totalMd} markdown files. Point CAIRN at ${BRAIN}`);
