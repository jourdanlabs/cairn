# CAIRN — Positioning

**Knowledge integrity and answer provenance for regulated environments.**

---

## The problem

In a regulated firm, the knowledge base *is* a control surface. Policies, procedures, risk memos, and control narratives are how people — and, increasingly, AI assistants — know what to do. But that knowledge base quietly rots:

- It becomes **inconsistent** — two procedures give conflicting instructions and nobody notices.
- It goes **stale** — the authoritative version was superseded, but the old one is still what search returns.
- It is **ungrounded** — answers get sourced from the nearest-sounding document, not the correct one.
- It is **un-auditable** — when a regulator asks *"how did your people know to do X,"* there is no record tying the action to the source that informed it.

AI assistants do not fix this. They amplify it. A confident, fluent answer drawn from the wrong or stale document is not a productivity gain — it is a compliance incident waiting to be discovered. The more the firm leans on "chat with your docs," the larger the un-auditable surface grows.

In most industries this is a nuisance. In regulated finance it is a control failure.

## The category

CAIRN is not enterprise search, and it is not a document chatbot. Those categories optimize for *finding* and *answering*. CAIRN optimizes for **integrity and provenance**: whether the corpus agrees with itself, and whether every answer can be traced — cryptographically — back to the exact source that produced it.

Search asks *"what's relevant?"* CAIRN asks *"can we prove it, and does the knowledge base even agree with itself?"* Different question, different category.

## What it does — three pillars

**1. Receipted, cite-or-refuse answers.**
Ask a question over the corpus and CAIRN returns an answer **locked to the retrieved notes**. Every claim carries a citation, or the system replies exactly *"Not in your vault."* A confidence gate refuses weak matches **before the model is ever called**, so it cannot hallucinate to fill a gap. Every answer *and* every refusal emits a hashed **receipt**: the question, the verdict (`GROUNDED` / `REFUSED_UNGROUNDED`), each cited source **content-hashed with SHA-256** (proof of what the source said at answer time), the model, the confidence, the index build time, a timestamp, and a `receipt_sha256`. Downloadable as JSON.

**2. Contradiction and staleness surveillance.**
A deterministic audit finds the structural rot — orphans, broken `[[links]]`, stale notes, duplicate titles, stubs, untagged notes. Embedding-based **overlap detection** surfaces note pairs about the same topic, and a model adjudicates whether they **contradict**, **duplicate**, or merely **relate**. This is the part no search engine does: it does not just retrieve the corpus, it interrogates it for internal conflict.

**3. A hashed knowledge-integrity score.**
One click produces an **Integrity Report**: a 0–100 score and letter grade over the whole corpus, combining the deterministic audit with the contradiction candidates, rolled into a single **hashed (`report_sha256`), downloadable JSON artifact**. A regulator-ready snapshot of whether the knowledge base is internally consistent, current, and reachable.

**Controlled sources.** Authoritative documents are marked *controlled* (by folder or frontmatter). The Integrity Report shows controlled coverage, and same-topic overlaps between two controlled documents are surfaced as **review priorities** — the pairs to adjudicate first, because a genuine conflict between two authoritative policies is the costliest kind. Adjudication then confirms which are true contradictions, which merely relate.

## Why JourdanLabs, why now

JourdanLabs builds one kind of system: **deterministic, receipted, and unwilling to bluff** — STRATA (governed semantic layer), CRUCIBLE (deterministic audit and deploy brake), PHAROS (refuses when it cannot prove). CAIRN is that same thesis applied to **knowledge**: determinism where the corpus is audited, a receipt on every answer, and a refusal instead of a guess.

The timing is not incidental. Firms are wiring AI assistants directly onto their internal knowledge bases right now — which means the volume of confident, unsourced, un-auditable answers is rising fast, precisely inside the environments least able to absorb the risk. The control needs to exist before the incident does.

## Competitive landscape (honestly)

- **Enterprise search (Glean and peers)** finds documents well. It does not verify them, does not score the corpus for internal conflict, and does not receipt its answers.
- **Document AI (Notion AI, Copilot)** answers fluently and cloud-side. Fluency is not provenance; a good answer from the wrong document is still wrong, and there is no artifact proving where it came from.
- **RAG plugins** ground answers in retrieved chunks but stop there — no cite-or-refuse discipline, no corpus-level integrity score, no hashed receipt.

Nobody in the field scores the corpus for internal contradiction, and nobody hands you a signed receipt for the answer. That is the open lane.

## What CAIRN is NOT

- **Not a chatbot.** It refuses rather than improvises; a wrong-but-confident answer is the exact failure it is built to prevent.
- **Not a search bar.** Retrieval is the input, not the product. The product is provenance and integrity.
- **Not cloud RAG.** It runs fully local — local Ollama or any OpenAI-compatible endpoint — and the corpus never leaves the machine. Grounded search needs no network at all.

---

**Positioning statement:** *CAIRN is the knowledge-integrity layer for regulated firms — it surveils your knowledge base for contradiction and staleness, and answers only what it can prove, with a hashed receipt for every answer and every refusal.*
