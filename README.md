# CAIRN

**Find what you know — and see exactly where it came from.**

CAIRN is a local, grounded search + audit layer over an [Obsidian](https://obsidian.md) vault. It fixes the three things that make a big second-brain hard to live in:

- **Can't find it / can't remember where you put it** → semantic-ish retrieval (BM25 ranked, boosted by Obsidian's own structure: titles, headings, tags, links). Ask by meaning; location stops mattering.
- **Hallucinations** → every result is a *real passage from a real note*, deep-linked back to it. The optional AI "Ask" mode is locked to your notes: it cites every claim, and if the answer isn't there it says **"Not in your vault."** — it never guesses.
- **The vault itself rotting** → a one-click **audit** finds orphans, broken `[[links]]`, stale notes, duplicate titles, stubs, and untagged notes.

Zero runtime dependencies. Runs fully local — **your vault never leaves the machine.** Grounded search needs no network and no API key at all.

---

## Quickstart

```bash
git clone <this-repo> cairn
cd cairn
cp .env.example .env          # then set VAULT_DIR to your vault folder
node server.mjs               # → http://localhost:4600
```

Requires **Node 18+**. No `npm install`, no build step.

`.env` at minimum:
```bash
VAULT_DIR=~/Documents/MyVault
```

### Optional — AI "Ask" answers

Set an OpenAI-compatible endpoint and CAIRN's **Ask** mode will synthesize a grounded, cited answer (or refuse):
```bash
MODEL_BASE_URL=https://api.openai.com/v1   # or your internal/local gateway
MODEL_API_KEY=…
MODEL_NAME=gpt-4o-mini
```
Without it, **Search** mode still returns ranked passages — fully useful, zero network.

---

## How it works

```
vault/*.md ──► index (frontmatter, headings, [[links]], #tags; chunk by heading)
                 ├─ Search : BM25 + structural boosts → ranked passages, deep-linked, with a confidence score
                 ├─ Ask    : retrieve → answer LOCKED to those passages, cite [n] each claim, or "Not in your vault"
                 └─ Audit  : orphans · broken links · stale · duplicate titles · stubs · untagged
```

- `lib/index.mjs` — walk + parse + chunk the vault (in memory).
- `lib/search.mjs` — BM25 with title/heading/tag boosts, snippets, and a confidence gate that **refuses weak matches** instead of dressing them up.
- `lib/ground.mjs` — optional grounded answer; the model may only use the retrieved notes.
- `lib/audit.mjs` — the CRUCIBLE-shaped pass: where is the knowledge base itself weak?

`POST /api/reindex` rebuilds after you edit the vault (or just restart).

## Why not just a RAG plugin?

Plenty of "chat with your vault" plugins exist. CAIRN's difference is the two things they skip: **grounding you can trust** (cite-or-refuse, every claim traceable to a note) and the **audit** (finding the gaps in your own knowledge). And it's yours — local, offline, MIT.

## License

MIT © JourdanLabs
