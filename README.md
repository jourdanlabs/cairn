# CAIRN

**Find what you know — and see exactly where it came from.**

CAIRN is a local, grounded search + audit layer over an [Obsidian](https://obsidian.md) vault. It fixes the three things that make a big second-brain hard to live in:

- **Can't find it / can't remember where you put it** → retrieval that ranks by meaning: BM25 boosted by Obsidian's own structure (titles, headings, tags, link-authority), and — with a local embedding model — **hybrid** BM25 + semantic so synonyms surface too. Location stops mattering.
- **Hallucinations** → every result is a *real passage from a real note*, deep-linked back to it. The optional **Ask** mode is locked to your notes: it cites every claim, and if the answer isn't there it says **"Not in your vault."** — it never guesses. A confidence gate refuses weak matches *before* it ever calls a model.
- **Overlaps / contradictions** → embeddings find note pairs about the *same thing*; the model then adjudicates whether they **contradict**, **duplicate**, or merely **relate** — catching redundancy and conflicting decisions.
- **The vault itself rotting** → a one-click **audit** finds orphans, broken `[[links]]`, stale notes, duplicate titles, stubs, and untagged notes.
- **Prove it (for regulated environments)** → every answer (or refusal) emits a hashed **receipt** tying it to the exact sources, each content-hashed, with a timestamp. A one-click **Integrity Report** scores the whole base (0–100 + grade), rolls up every finding + contradiction, and exports as a signed JSON artifact. Provenance a risk team — or a regulator — can check.
- **Controlled sources (compliance)** → mark authoritative docs (`authority: controlled` in frontmatter, or a top-level folder listed in `CONTROLLED_DIRS`). Answers grounded on a non-controlled source are flagged, and a contradiction between **two controlled documents** is escalated to **HIGH severity** — the signal a compliance owner actually cares about.

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

### Optional — turn on the local model (Ask · semantic search · contradictions)

Point CAIRN at any OpenAI-compatible endpoint. **Recommended: a local [Ollama](https://ollama.com)** — everything (chat + embeddings) then runs on your machine and nothing leaves it. No API key needed for a local endpoint.

```bash
ollama pull nomic-embed-text   # embeddings
ollama pull qwen3:4b           # or any chat model you like
```
```bash
# .env
MODEL_BASE_URL=http://localhost:11434/v1
MODEL_NAME=qwen3:4b
MODEL_EMBED=nomic-embed-text
EMBEDDINGS=on
```
That enables: **hybrid** semantic search, **Ask** (grounded cited answers), and **Overlaps** (contradiction/duplicate detection). Chunks are embedded once and cached to `.cache/`, so restarts are instant.

Prefer a hosted model? Set `MODEL_BASE_URL`/`MODEL_API_KEY` to OpenAI or your gateway instead. Without any model, **Search** and **Audit** still work fully — ranked passages, zero network.

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

Edits **auto-reindex** (file-watch, debounced) — no restart needed. `POST /api/reindex` forces it.

## Beyond a vault: find work you forgot you made

Point `VAULT_DIR` at a whole project tree and CAIRN becomes a "what did I build?" engine — it skips `node_modules`, `.git`, `dist`, etc. automatically:

```bash
VAULT_DIR=~/projects INDEX_EXT=.md,.markdown,.txt PORT=4601 node server.mjs
```

Now search or ask across every README and note on disk: *"which project had the deterministic pricing model?"* → the forgotten repo, deep-linked.

## Why not just a RAG plugin?

Plenty of "chat with your vault" plugins exist. CAIRN's difference is the two things they skip: **grounding you can trust** (cite-or-refuse, every claim traceable to a note) and the **audit** (finding the gaps in your own knowledge). And it's yours — local, offline, MIT.

## License

MIT © JourdanLabs
