# CAIRN — One Page
### Answer only what you can prove. Get a receipt for every answer — and every refusal.

**Knowledge integrity and answer provenance for regulated environments.**

`SOFTWARE: WORKING  ·  TESTS: 53 / 53  ·  DEPENDENCIES: 0  ·  RUNS: FULLY LOCAL  ·  STATUS: ● GREEN-GATED`

---

### WHAT THIS IS

CAIRN reads your own documents and answers questions about them — but **only with things it can prove are actually in there**, and it hands you a cryptographic **receipt** for every answer. It also watches your knowledge base for the quiet rot that breaks it: contradictions, stale pages, broken links, and orphaned notes.

It is not a chatbot and not a search bar. It answers the question *"can we prove it, and does the knowledge base even agree with itself?"*

### THE PROBLEM

In a regulated firm, the knowledge base **is** a control surface — policies and procedures are how people (and now AI assistants) know what to do. But it rots quietly: two procedures conflict and nobody notices; the superseded version is still what search returns; answers get pulled from the nearest-sounding document, not the correct one; and when a regulator asks *"how did your people know to do X,"* there is no record tying the action to its source.

AI assistants do not fix this — they **amplify** it. A confident, fluent answer from the wrong or stale document is not a productivity gain; it is a compliance incident waiting to be discovered.

### HOW CAIRN WORKS — THREE THINGS

- **Cite-or-refuse answers, receipted.** Every claim carries a citation, or CAIRN replies exactly *"Not in your vault."* A confidence gate refuses weak matches **before the model is ever called**, so it cannot hallucinate to fill a gap. Every answer *and* every refusal emits a hashed receipt: the question, the verdict (`GROUNDED` / `REFUSED_UNGROUNDED`), each cited source **SHA-256-hashed** (proof of what it said at answer time), the model, the confidence, and a `receipt_sha256`. Downloadable as JSON.
- **Contradiction & staleness surveillance.** A deterministic audit finds orphans, broken `[[links]]`, stale notes, duplicate titles, and stubs. Embedding-based overlap detection surfaces same-topic note pairs, and a model adjudicates whether they **contradict**, **duplicate**, or merely **relate**. No search engine does this — it interrogates the corpus for internal conflict.
- **A hashed integrity score.** One click produces a 0–100 **Integrity Report** with a letter grade over the whole corpus, rolled into a hashed, downloadable JSON artifact — a regulator-ready snapshot of whether the knowledge base is consistent, current, and reachable.

### WHY YOU CAN TRUST IT

- **Tamper-evident by construction.** Every answer and report is sealed into a hash-chained ledger; any edit to a past entry — payload, link, or a deleted line — is detectable. (Independently stress-tested three ways; each tampering was caught.)
- **Zero dependencies.** Pure Node.js, no third-party packages — nothing to install, nothing to supply-chain-attack. `git clone` → `node server.mjs` and it runs.
- **Fully local.** The corpus never leaves the machine. Grounded search needs no network at all; answers can run against a local model (Ollama).
- **53 automated tests**, and re-executed independently rather than taken on faith.

### WHAT IT IS — AND ISN'T (HONESTLY)

CAIRN is a **control you operate**, not a certification. It generates the evidence a SOC 2 / model-risk review asks for; it is not itself "certified." It ships coded-to-real-API connectors (filesystem live; Confluence on the Cloud v2 API, fixture-tested) and an SSO-ready auth hook — but the last mile that needs *your* tenant token, *your* identity provider, and *your* deployment runs on your systems, not ours. Those boundaries are documented, not hidden.

### WHO BUILDS IT

JourdanLabs builds one kind of system: **deterministic, receipted, and unwilling to bluff** — STRATA (governed semantic layer), CRUCIBLE (deterministic audit + deploy brake), PHAROS (refuses when it cannot prove). CAIRN is that same thesis applied to **knowledge**: a receipt on every answer, and a refusal instead of a guess.

---

**Leland Jourdan II** — Founder & Chief Architect, JourdanLabs · `leland@jourdanlabs.com`
*Built by JourdanLabs. We build tools that refuse to bluff.*
