// brain-ingest — pull ALL your conversations + notes into one searchable corpus that
// CAIRN can navigate. Zero dependencies. Sources: Claude Code session logs, pan-cc
// (Pan conversations/handoffs), agent turn-logs (LUNA/OMNIS/MTS), OG Bulma's ChatGPT
// export (~1128 convos back to 2023), the chamber soul vault (memory, souls, agents,
// covenant), and the Obsidian vault.
// Output: ~/brain/{claude,pan,agents,bulma,chamber,vault}/*.md — clean, dated, titled transcripts.
//
//   node scripts/brain-ingest.mjs            # full sync
//   node scripts/brain-ingest.mjs --since 2026-05-25   # only sessions on/after a date
//   node scripts/brain-ingest.mjs --scrub [--dry-run]  # mask secrets already in the brain
//
// Re-runnable and incremental: a note is rewritten only when its source is newer. A Claude
// transcript keeps its filename across runs (its header names the session file it came
// from). Nothing in the brain is ever deleted. Credentials (API keys, tokens, private keys,
// *_SECRET= style assignments) are masked to their first 4 chars before anything is
// written. CAIRN watches ~/brain and reindexes on its own.

import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
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
// a note is current when it was written after its source last changed
const current = (dest, srcMtimeMs) => { try { return statSync(dest).mtimeMs >= srcMtimeMs; } catch { return false; } };
// Writes are queued and flushed in one burst at the end of a run. CAIRN's watcher reindexes
// 1.5 s after the last change, and its embed cache doesn't persist at this corpus size, so
// every reindex re-embeds everything. Writes spread across a run (the agent-log walk alone
// takes a minute) set off overlapping reindexes, and two re-embeds in flight pushed
// Studio's engine past its 4 GB heap on 2026-10-02. Each write goes through a temp file +
// rename: a run killed mid-write must never leave a truncated note that looks current.
const pending = [];
const put = (dest, text) => { pending.push([dest, text]); };
function flush() {
  for (const [dest, text] of pending) { const tmp = `${dest}.tmp`; writeFileSync(tmp, text); renameSync(tmp, dest); }
  const n = pending.length; pending.length = 0; return n;
}
function readHead(p, n = 2048) {
  const fd = openSync(p, 'r');
  try { const buf = Buffer.alloc(n); return buf.toString('utf8', 0, readSync(fd, buf, 0, n, 0)); } finally { closeSync(fd); }
}

// ── secrets never land in the brain ─────────────────────────────────────────────
// Known credential shapes, masked to their first 4 chars. Conservative on purpose: prose,
// code and hashes must survive, so a bare `token: x` is left alone, and an env-style
// assignment (FOO_TOKEN=value) or Bearer header is masked only when the value looks
// random (letters and digits, not a process.env/os.environ reference). The third field
// marks those looser shapes.
const SECRET_RES = [
  // PEM bodies: multi-line, or one line with escaped \n (a JSON private_key field). The
  // body class has no `*` or quotes, so a match can't run across transcript turns; the
  // second shape catches a pasted key whose END line never made it in.
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=\s\\:,.-]{16,6000}?-----END [A-Z ]*PRIVATE KEY-----/g],
  ['private-key', /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:\\n|\s)+[A-Za-z0-9+/=]{64,}(?:(?:\\n|\s)+[A-Za-z0-9+/=]{16,})*/g],
  ['sk-key', /\bsk-[A-Za-z0-9_-]{20,}/g], // Anthropic, OpenAI, OpenRouter, DeepSeek, Moonshot
  ['stripe', /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g],
  ['github', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})/g],
  ['slack', /\bxox[abcdeposr]-[A-Za-z0-9%+/=_-]{10,}/g], // incl. xoxc- client and URL-encoded xoxd- cookie tokens
  ['resend', /\bre_[A-Za-z0-9]{8,}_?[A-Za-z0-9]{16,}/g], // re_ + 24+, or re_<id>_<secret>
  ['fly', /\bfm[12][ar]?_[A-Za-z0-9+/=_-]{40,}/g], // Fly.io fm1a_/fm2a_/fm2_ (often after "FlyV1 ")
  ['aws', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['google', /\b(?:AIza[0-9A-Za-z_-]{35}|ya29\.[A-Za-z0-9_-]{20,})/g],
  ['huggingface', /\bhf_[A-Za-z0-9]{30,}/g],
  ['fireworks', /\bfw_[A-Za-z0-9]{20,}/g],
  ['xai', /\bxai-[A-Za-z0-9]{40,}/g],
  ['groq', /\bgsk_[A-Za-z0-9]{40,}/g],
  ['npm', /\bnpm_[A-Za-z0-9]{36}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  ['url-password', /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:([^\s:/@]{6,})(?=@)/g], // postgres://user:PASS@host
  ['env-assign', /\b[A-Z][A-Z0-9_]*(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|APIKEY|ACCESS_KEY|PRIVATE_KEY)\s*=\s*["']?([^\s"'`$<>{}]{8,})/g, true],
  ['bearer', /\bBearer\s+([A-Za-z0-9._~+/-]{20,}=*)/g, true],
];
const MASK = '…[masked]';
const masked = { total: 0, kinds: {} };
const looksRandom = (v) => /\d/.test(v) && /[A-Za-z]/.test(v) &&
  !/^(?:process\.env|os\.environ|os\.getenv|getenv|env\.|ENV\[|secrets\.)/i.test(v);
function mask(text) {
  let out = text;
  for (const [kind, re, loose] of SECRET_RES) {
    out = out.replace(re, (m, val) => {
      if (m.includes('[masked')) return m;
      if (loose && !looksRandom(val)) return m;
      masked.total++; masked.kinds[kind] = (masked.kinds[kind] || 0) + 1;
      if (kind === 'private-key') {
        const head = /^-----BEGIN [A-Z ]*PRIVATE KEY-----/.exec(m)[0];
        const foot = (/-----END [A-Z ]*PRIVATE KEY-----$/.exec(m) || [''])[0];
        return `${head}[masked private key]${foot}`;
      }
      if (typeof val === 'string') return m.slice(0, m.length - val.length) + val.slice(0, 4) + MASK;
      return m.slice(0, 4) + MASK;
    });
  }
  return out;
}

// ── Claude Code session logs → transcripts ──────────────────────────────────────
function ingestClaude() {
  const root = join(HOME, '.claude', 'projects');
  if (!existsSync(root)) return { wrote: 0, upToDate: 0, skipped: 0, empty: 0, total: 0 };
  const files = walk(root, (n) => n.endsWith('.jsonl'));
  const outDir = ensure(join(BRAIN, 'claude'));
  // existing notes by the session file their header names, so a session that grew is
  // rewritten under the same name instead of landing as a duplicate
  const owned = new Map();
  for (const n of readdirSync(outDir)) {
    if (!n.endsWith('.md')) continue;
    let head; try { head = readHead(join(outDir, n)); } catch { continue; }
    const m = /^\*Claude Code · [^\n]*? · `([^`\n]+\.jsonl)`\*$/m.exec(head);
    if (m && !owned.has(m[1])) owned.set(m[1], n.slice(0, -3));
  }
  let wrote = 0, skipped = 0, empty = 0, upToDate = 0;
  const used = new Set(owned.values());
  const seen = new Set();
  for (const file of files) {
    const base = basename(file);
    const mine = seen.has(base) ? null : owned.get(base);
    seen.add(base);
    let srcMtime; try { srcMtime = statSync(file).mtimeMs; } catch { continue; }
    if (mine && current(join(outDir, mine + '.md'), srcMtime)) { upToDate++; continue; }
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
    let name = mine;
    if (!name) {
      name = `${date}-${slug(title)}`;
      while (used.has(name) || existsSync(join(outDir, name + '.md'))) name += '-' + base.slice(0, 4);
      used.add(name);
    }
    const dest = join(outDir, name + '.md');
    const body = `# ${title.replace(/\n/g, ' ')}\n\n*Claude Code · ${date} · \`${base}\`*\n\n---\n\n` +
      turns.map((t) => `**${t.who}:** ${t.text}`).join('\n\n');
    put(dest, mask(body));
    wrote++;
  }
  return { wrote, upToDate, skipped, empty, total: files.length };
}

// ── copy an existing markdown tree (pan-cc, chamber, vault) ─────────────────────
function copyTree(srcRoot, label) {
  if (!existsSync(srcRoot)) return { wrote: 0, total: 0 };
  const files = walk(srcRoot, (n) => n.endsWith('.md') || n.endsWith('.markdown'));
  const outDir = ensure(join(BRAIN, label));
  let wrote = 0;
  for (const f of files) {
    const rel = relative(srcRoot, f).replace(/[\/]/g, '__');
    const dest = join(outDir, rel);
    try {
      if (current(dest, statSync(f).mtimeMs)) continue;
      put(dest, mask(readFileSync(f, 'utf8'))); wrote++;
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
    const proj = relative(join(HOME, 'projects'), file).split('/')[0];
    const dest = join(outDir, `${proj}__${slug(basename(file, '.jsonl'))}.md`);
    try { if (current(dest, statSync(file).mtimeMs)) continue; } catch { continue; }
    let raw; try { raw = readFileSync(file, 'utf8'); } catch { continue; }
    const rows = raw.split('\n').filter((l) => l.trim()).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    if (!rows.length) continue;
    const lines = rows.map((r) => {
      const t = r.timestamp || r.ts || r.created_at || '';
      const who = r.role || r.kind || r.type || 'entry';
      const txt = r.text || r.response_text || r.message || r.content || (r.payload ? JSON.stringify(r.payload).slice(0, 400) : '');
      return txt ? `**${who}** ${t ? `(${String(t).slice(0, 19)})` : ''}: ${typeof txt === 'string' ? txt : JSON.stringify(txt).slice(0, 400)}` : '';
    }).filter(Boolean);
    if (!lines.length) continue;
    put(dest, mask(`# ${proj} — ${basename(file)}\n\n*Agent turn-log*\n\n---\n\n${lines.join('\n\n')}`));
    wrote++;
  }
  return { wrote, total: logs.length };
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
    let list, shardMtime; try { shardMtime = statSync(join(root, shard)).mtimeMs; list = JSON.parse(readFileSync(join(root, shard), 'utf8')); } catch { continue; }
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
      const dest = join(outDir, name + '.md');
      if (current(dest, shardMtime)) continue;
      const body = `# ${title}\n\n*OG Bulma · ChatGPT · ${date}*\n\n---\n\n` +
        msgs.map((m) => `**${m.role === 'user' ? 'You' : 'Bulma'}:** ${m.text}`).join('\n\n');
      put(dest, mask(body));
      wrote++;
    }
  }
  return { wrote, convos, empty, shards: shards.length };
}

// ── mask secrets in notes already in the brain (one pass, in place) ─────────────
function scrub(dryRun) {
  const files = walk(BRAIN, (n) => n.endsWith('.md') || n.endsWith('.markdown'));
  const byDir = {};
  let changed = 0;
  for (const f of files) {
    let raw; try { raw = readFileSync(f, 'utf8'); } catch { continue; }
    const before = masked.total;
    const out = mask(raw);
    if (out === raw) continue;
    changed++;
    const top = relative(BRAIN, f).split('/')[0];
    byDir[top] = (byDir[top] || 0) + (masked.total - before);
    if (!dryRun) put(f, out);
  }
  return { files: files.length, changed, byDir };
}

const maskLine = () => masked.total
  ? `  masked:  ${masked.total} secrets (${Object.entries(masked.kinds).map(([k, n]) => `${k} ${n}`).join(', ')})`
  : '  masked:  0 secrets';

if (args.includes('--scrub')) {
  const dry = args.includes('--dry-run');
  const s = scrub(dry);
  flush();
  console.log(`brain-ingest --scrub${dry ? ' (dry run, nothing written)' : ''} → ${BRAIN}`);
  console.log(`  notes:   ${s.changed} of ${s.files} carry secrets${s.changed ? ` (${Object.entries(s.byDir).map(([d, n]) => `${d} ${n}`).join(', ')})` : ''}`);
  console.log(maskLine());
} else {
  let failed = 0;
  // one source failing must not stop the rest of the sync
  const step = (label, fn) => { try { return fn(); } catch (e) { failed++; console.error(`  ${label}: FAILED — ${e.message}`); return null; } };
  console.log(`brain-ingest → ${BRAIN}${since ? ` (since ${since})` : ''} · ${new Date().toISOString()}`);
  const c = step('claude', ingestClaude);
  if (c) console.log(`  claude:  ${c.wrote} transcripts written, ${c.upToDate} up to date (${c.total} sessions, ${c.empty} empty, ${c.skipped} skipped)`);
  const p = step('pan', () => copyTree(join(HOME, 'projects', 'pan-cc'), 'pan'));
  if (p) console.log(`  pan:     ${p.wrote} files (${p.total} md)`);
  const a = step('agents', ingestAgentLogs);
  if (a) console.log(`  agents:  ${a.wrote} turn-logs (${a.total} found)`);
  const b = step('bulma', ingestChatGPT);
  if (b) console.log(`  bulma:   ${b.wrote} transcripts (${b.convos} convos across ${b.shards || 0} shards, ${b.empty || 0} empty)`);
  // the distilled OG Bulma corpus (SOUL, memory, migration notes) rides along with the raw logs
  step('bulma-cc', () => copyTree(join(HOME, 'projects', 'bulma-cc'), 'bulma'));
  step('soul-sista-bulma-cc', () => copyTree(join(HOME, 'projects', 'soul-sista-bulma-cc'), 'bulma'));
  // the soul vault: Pan's memory, souls, agent boots, the covenant. The Obsidian vault only
  // symlinks to these folders, and directory symlinks aren't walked, so read them directly.
  const ch = step('chamber', () => copyTree(join(HOME, 'chamber-soul-vault'), 'chamber'));
  if (ch) console.log(`  chamber: ${ch.wrote} files (${ch.total} md)`);
  const v = step('vault', () => copyTree(join(HOME, 'Obsidian', 'JourdanLabs'), 'vault'));
  if (v) console.log(`  vault:   ${v.wrote} notes (${v.total} md)`);
  console.log(maskLine());
  const t0 = Date.now();
  const flushed = step('write', flush);
  if (flushed !== null) console.log(`  wrote:   ${flushed} notes in one burst (${Date.now() - t0} ms), so CAIRN reindexes once`);
  const totalMd = walk(BRAIN, (n) => n.endsWith('.md')).length;
  console.log(`\n${failed ? `✗ ${failed} source(s) failed.` : '✓'} brain has ${totalMd} markdown files. CAIRN watches ${BRAIN} and reindexes on its own.`);
  if (failed) process.exitCode = 1;
}
