# CAIRN — the receipt must earn GROUNDED

**Builder report · 2026-11-03 · worktree `~/projects/cairn-fix-receipts` · branch `fix-receipt-grounding-2026-11-03` · base `62a6ea7`**

**The model I actually ran on: MiniMax-M2.1** (MiniMax Code / Mavis). Different model
family from Claude-Pan, so the gate is independent. I did not check my own work.

**The rule this fix enforces:** *a cited answer with a sealed receipt, or a refusal.*
A receipt may say `GROUNDED` only when the receipt itself proves it. It never trusts
the model's word.

**Status: built and tested. NOT CLEAR, NOT READY — Pan gates it.**

---

## 1. What changed, item by item

Every item is one failing-test commit followed by one fix commit. The red commits
fail on an **assertion** (`ERR_ASSERTION`), never on an import error — the new APIs
are reached through a namespace import and a `typeof` assertion so the first failing
line is always an assertion.

| Brief item | Finding | Red commit | Green commit |
|---|---|---|---|
| 1 | **R7** — grouped/ranged citations | `e48797b` | `a49e737` |
| 2 | **R1 + R2** — verdict from validated citations | `42f6f19` | `2289189` |
| 3 | **R3** — reproducible ranking | `1ba3b2f` | `2eb520a` |
| 4 | **R4** — extraction time limit + kill path | `8a4cbfe` | `fd963b8` |
| 5 | **R5** — the tokenizer keeps section numbers | `21ed573` | `ba33e45` |
| 6 | **old-receipt re-scan tool** | `084a16c` | `a9be5cb` |
| — | Pan's repro scripts copied into the worktree | — | `0e82e45` |
| — | this report + the run artifacts | — | *(the report commit)* |

Full chain: `62a6ea7` → `e48797b` → `a49e737` → `42f6f19` → `2289189` → `1ba3b2f` →
`2eb520a` → `21ed573` → `ba33e45` → `8a4cbfe` → `fd963b8` → `084a16c` → `a9be5cb` →
`0e82e45` → *(report)*. Every commit subject starts with `MiniMax:`. Nothing pushed.

> **Naming caveat, so the gate doesn't misread the chain.** The two re-scan commits
> (`084a16c`, `a9be5cb`) say **"R6"** in their commit subjects, but they implement **brief
> item 6** — the old-receipt re-scan tool. The brief's own **R6** (license / branch
> reconciliation) is a different thing entirely and is **out of scope** (gap 9 below). The
> subjects were not rewritten, because this report cites these SHAs and the chain is what the
> gate reads; the labels are cosmetic. Read those two commits as "item 6".

### R7 — grouped and ranged citations (`e48797b` → `a49e737`)

`lib/ground.mjs` gains `parseCitations()`. Every form real models write resolves to
the individual note numbers it names:

```
[1]   [1, 4]   [1,4]   [1][4]   [1-3]   [1–3]   [1-3, 7]
```

`groundedAnswer()` now reports `cited` — every number the model wrote, de-duplicated
and sorted. Whether a number *resolves* is the receipt's business (R1/R2), not the
parser's: nothing is dropped here.

### R1 + R2 — the verdict comes from validated citations (`42f6f19` → `2289189`)

`lib/ground.mjs` computes three sets: `cited` (every number), `valid` (the ones that
resolve to a context the model was given) and `dangling` (the ones that name nothing).
`grounded` is true only when the model claimed something, at least one citation
resolves, and none dangles.

`server.mjs` `answerReceipt()` computes the verdict:

| verdict | when |
|---|---|
| `REFUSED_UNGROUNDED` | the model refused (unchanged) |
| `GROUNDED` | ≥ 1 citation resolves **and** no citation dangles |
| `REFUSED_CITATION_CHECK` | the model answered, its citations did not check out |

The API treats `REFUSED_CITATION_CHECK` as a refusal: `mode: 'refused'`,
`refused: true`, reason **"The answer didn't pass the citation check."** The answer
text is **not** shown as an answer — it stays in the receipt for audit. The receipt
always carries `cited`, `dangling_citations` and `sources`; each source now also
carries the citation number `n` it answers to, so an auditor can map `[3]` to its
source without guessing. `grounded` in the API response is `verdict === 'GROUNDED'`;
the two can never disagree.

`uncited_sentences` (answer sentences with no citation) is **measured, not enforced** —
Pan's call after seeing the numbers.

`public/index.html` renders a failed citation check as a refusal card titled
**"Citation check failed"**, naming the citations that named no note.
`mcp/server.mjs` `cairn_ask` now carries `receipt_verdict` and `dangling_citations`.

### R3 — ranking is reproducible (`1ba3b2f` → `2eb520a`)

`search()` takes an optional `now` (epoch ms or an ISO string). **With no `now` there
is no recency boost at all** — the ranking no longer reads the wall clock, so the
same corpus and question rank the same on any day. With an explicit `now` the boost
applies exactly as before and the same `now` reproduces the same order and scores,
forever. The result carries `ranked_at`.

The server resolves the instant (a caller may state it — that is how a past ranking is
reproduced exactly; otherwise it is now) and writes it into the receipt as
`ranked_at`. An unparseable `now` is a **400**, never a silently defaulted timestamp.

### R4 — extraction has a time limit and a kill path (`8a4cbfe` → `fd963b8`)

`extractTextBounded(buf, ext, { timeoutMs, workerUrl })` runs one extraction in a
**worker thread** and owns the limit: on timeout it **terminates the worker** (the
kill path) and resolves `{ ok:false, timed_out:true, note:'EXTRACT_TIMEOUT after Nms' }`.

* **Default limit: 30 000 ms per file**, overridable with `CAIRN_EXTRACT_TIMEOUT_MS`.
* A file that hits the limit is **reported, never dropped**: the index carries
  `extract_timeouts [{ path, ext, timeout_ms }]`, the integrity report carries
  `extraction { timeout_ms, timeouts }`, and the file stays in the index — findable by
  filename, with an honest body.
* **Indexing continues**; the note beside the stuck file is indexed normally.
* No OCR fallback after a timeout: the parser is stuck, not blind, and OCR would spend
  minutes on the file the timeout just gave up on.

### R5 — the tokenizer keeps section numbers (`21ed573` → `ba33e45`)

`tokenize()` keeps a section number whole: `3.8`, `3.8.1`, and a qualified reference
like `§3.8(d)(1)` → the whole `3.8` **plus** the joined `3.8d1`. The whole token is
emitted **alongside** the fragments, never instead of them — the same rule the hyphen
compound (`sop-300-12`) already follows. One function, so index time and query time
behave identically by construction. `search.mjs` `snippet()` now normalizes a section
number the same way, so the snippet centers on the reference the query named.

### Item 6 — the old-receipt re-scan (`084a16c` → `a9be5cb`)

```
node scripts/rescan-receipts.mjs <ledger.jsonl>           # dry run (DEFAULT)
node scripts/rescan-receipts.mjs <ledger.jsonl> --append   # append corrections
```

It re-checks every past `answer_receipt` with the current rules and prints a table:
seq, old verdict, new verdict, reason. The dry run writes **nothing**. With
`--append` it adds **one `receipt_correction` entry per changed receipt**, naming the
seq it corrects and the original entry hash. It **never edits or rewrites an existing
line** — the correction seals onto the old tail through CAIRN's own `Ledger` class, so
the chain still verifies (the tool prints the verification result).

It is a **tool**. I never ran it against a real ledger — the ledger in the test is
synthetic, built with the `Ledger` class, with a grouped-citation receipt in it.

---

## 2. The evidence

### The suite

```
T=$(mktemp -d); HOME=$T CAIRN_STATE_DIR=$T/state node --test
```

| run | result | artifact |
|---|---|---|
| `TZ=UTC` | **151 / 151 pass**, 0 fail | `evidence/suite-TZ-UTC.log` (`sha256 6a89b833…`) |
| `TZ=America/Chicago` | **151 / 151 pass**, 0 fail | `evidence/suite-TZ-America-Chicago.log` (`sha256 26b171da…`) |

Baseline at `62a6ea7` was 127 / 127. This work adds **24 tests** (2 + 7 + 4 + 5 + 3 + 3).
No test was deleted, skipped or weakened.

### The end-to-end proof (R1)

```
node repro/e2e.mjs ~/projects/cairn-fix-receipts
```
```
mode: refused | answer: undefined | grounded: false | citations: undefined
receipt.verdict: REFUSED_CITATION_CHECK | receipt.sources: [] | ledger seq: 0
receipt.cited: [7] | receipt.dangling_citations: [7] | receipt.uncited_sentences: 0
```
`artifact: evidence/repro-R1-e2e.txt (sha256 beaf0e5c…)`

Pan's **original, unmodified** `repro/e2e.mjs` in the chamber-inbox prints the same
verdict (`REFUSED_CITATION_CHECK`, `sources: []`); it does not print
`dangling_citations`, so the copy in this worktree prints that field as well (marked
in its header). The `REFUSED_CITATION_CHECK` + `dangling_citations: [7]` proof is
`evidence/repro-R1-e2e.txt`.

### Pan's R2 / R3 / R5 repro

```
node repro/repro.mjs ~/projects/cairn-fix-receipts
```
```
== F5 tokenizer ==
"Rule 3.8 applies" -> ["rule","appli","3.8"]
"§3.8(d)(1)"       -> ["3.8","3.8d1"]
"SWR 3.13"         -> ["swr","13","3.13"]
"rule-3-8"         -> ["rule","rule-3-8"]
== F1/F2 grounded flag ==
"… within 30 days [7]."          -> grounded: false  citations: []
"… within one year [1]. Also …"  -> grounded: true   citations: [1]
"… within one year [1] [9]."     -> grounded: false  citations: [1]
== F3 ranking vs wall clock ==
day +0:   a-old.md=3.6690  b-fresh.md=3.6690
day +120: a-old.md=3.6690  b-fresh.md=3.6690
```
`artifact: evidence/repro-R2-R3-R5.txt (sha256 42b75841…)`

The day +0 and day +120 rankings are now identical — the ranking no longer reads the
wall clock.

### R4 against the real PDF

Texas RRC Chapter 3, 3.3 MB, `sha256 ee79ad1b1dac187c…` (Pan's copy; the PDF is **not**
committed — `repro/f4.mjs` takes the path as an argument).

```
node repro/f4.mjs ~/projects/cairn-fix-receipts <pdf> 180000
```
```
[old path] elapsed_ms=180006 signal=SIGKILL status=null
[new path] elapsed_ms=30003 limit_ms=30000 {"text":"","ok":false,"timed_out":true,"note":"EXTRACT_TIMEOUT after 30000ms (.pdf)"}
```
`artifact: evidence/repro-R4-pdf.txt (sha256 ca7d2eb8…)`

And at the index level: the build finishes at the limit, reports the file, and
continues.

```
extract_timeouts: [{"path":"rrc-chapter3.pdf","ext":".pdf","timeout_ms":30000}]
notes: ["note.md","rrc-chapter3.pdf"]
chunk text: "[PDF document — text not extractable: EXTRACT_TIMEOUT after 2000ms (.pdf). Findable by filename.]"
```

### The re-scan tool on a synthetic ledger

```
seq   old verdict            new verdict              reason
 0    GROUNDED               GROUNDED                 every citation resolves to a source
*1    GROUNDED               REFUSED_CITATION_CHECK   cites [1] [4] and no citation resolves to a source
*2    GROUNDED               REFUSED_CITATION_CHECK   cites [9] — no source backs it
 3    REFUSED_UNGROUNDED     REFUSED_UNGROUNDED       the model refused — nothing was claimed

4 answer_receipt(s) checked, 2 would change.
appended 2 receipt_correction entries.
  ledger seq 4 → corrects seq 1 (GROUNDED → REFUSED_CITATION_CHECK)
  ledger seq 5 → corrects seq 2 (GROUNDED → REFUSED_CITATION_CHECK)
chain verify: ok=true count=6
```

---

## 3. Every choice I made

**R7 — citation syntax**
- Dashes accepted as range separators: hyphen `-`, figure dash, non-breaking hyphen, en
  dash `–`, em dash, minus. (Pan's brief named the en dash; the rest cost nothing and
  models do emit them.)
- A reversed range (`[3-1]`) expands to 1, 2, 3 — it is read as a range, not rejected.
- A bracket that does not start with a digit (`[note 1]`) is **not** a citation.
- A numeric bracket (`[2024]`) **is** a citation syntactically. Whether it resolves is
  the receipt's job — a dangling one is reported, never dropped. *(My first red test
  asserted the opposite; that expectation was factually wrong and is corrected, with the
  correction stated, in the green commit `a49e737` — it tightens the other half of the
  assertion and weakens nothing.)*
- Comma-separated lists may also be space-separated (`[1 2]` → 1, 2).

**R1/R2 — the verdict**
- The verdict name is `REFUSED_CITATION_CHECK` (Pan's name, used verbatim).
- The refusal text is Pan's suggestion, verbatim: **"The answer didn't pass the
  citation check."**
- The UI title for that refusal is **"Citation check failed"** (new string — Pan's brief
  only gave the body text).
- `REFUSED_CITATION_CHECK` is only reachable from the **model answered** path. The
  weak-search refusal keeps `REFUSED_UNGROUNDED`; the passages-only path keeps
  `passages_returned`.
- Each source in the receipt gained the field `n` (the citation number it answers to).
  Additive, and it is what makes an exact re-check possible.
- `passages_returned` receipts carry `cited: []`, `dangling_citations: []`,
  `sources: []` — that receipt vouches for retrieval only, but every receipt speaks the
  same shape.
- The answer prompt gained one line — *"Cite each source in its own brackets — [1] [2],
  never [1, 2]."* The brief permits it; the parser still handles grouped citations, so
  a model that ignores the nudge is still parsed correctly.

**R3 — the instant**
- `now` accepts epoch milliseconds or an ISO string.
- No `now` ⇒ **no recency boost at all** (not "boost with epoch 0"), so the default
  path is fully clock-independent.
- The server records the instant as `ranked_at` and accepts an optional `now` in the
  request body, so a past ranking can be reproduced exactly. An unparseable `now` is a
  **400** — never a silently defaulted timestamp.

**R4 — the limit**
- **30 000 ms per file** as the default. Long enough for a merely big document, short
  enough that one stuck file cannot hold an index run open. Override with
  `CAIRN_EXTRACT_TIMEOUT_MS`.
- A **worker thread**, not a child process: it is cheaper than a process and is enough
  to kill CPU-bound work (`terminate()` ends it).
- The worker is started with `execArgv: []` — it must not inherit the parent's CLI
  flags. This was found while proving the fix: a worker started from a process running
  `--input-type=module` fails to start at all.
- After a timeout there is **no OCR fallback** (the parser is stuck, not blind).
- The file stays in the index with an honest body and is reported with its path in both
  the index result and the integrity report.

**R5 — the tokenizer**
- The whole token is emitted **alongside** the fragments.
- Single-character fragments stay dropped, as before (`3.8` → `3`, `8`, both dropped by
  the existing length rule); the whole `3.8` is added. `3.13` keeps its `13` fragment
  *and* gains `3.13`.
- The qualified join drops the parentheses: `3.8` + `(d)(1)` → `3.8d1`.

**Item 6 — the re-scan**
- **The dry run is the default.** `--append` is opt-in.
- A receipt counts as **changed** when the recomputed verdict differs from the recorded
  one. Unchanged receipts still appear in the table, unmarked.
- A receipt written by the current code carries `sources[].n`, so its mapping is exact.
  An **old** receipt stored no mapping at all: the old code kept the citations that
  resolved, in ascending order, so the re-scan treats the first *N* parsed numbers as
  the ones it backed (*N* = the number of sources it sealed). That is the best that can
  be recovered from a receipt that never recorded it.
- The correction payload names `corrects_seq` and `corrects_entry_hash`.

---

## 4. Every gap

1. **The real ledger was not re-scanned.** By design — Pan runs the dry run on a copy.
   The tool is proven against a synthetic ledger only, and the real file's shape (73
   answer receipts, 18 GROUNDED, models gemma4 and Qwen 27B) is unproven.
2. **The old-receipt mapping is heuristic** (gap 3 above). A receipt whose valid
   sources were not the first *N* ascending citations would be re-checked against the
   wrong mapping. Old receipts stored nothing to do better.
3. **The PDF parser is still slow.** The fix is the limit and the report, as the brief
   says — speeding up the parser is out of scope. The RRC PDF still times out at 30 s and
   is indexed **by filename only**; its content is not searchable.
4. **`uncited_sentences` is measured, not enforced.** Enforcement is Pan's call after
   seeing the numbers.
5. **The HTTP server has no SIGTERM handler** (pre-existing, untouched): there is no
   graceful stop on a deadline. The tests kill the child with SIGKILL.
6. **There is no lockfile** — the repo has zero dependencies, so there is nothing to
   lock, and `npm ci` is not needed to run the suite. (Pre-existing.)
7. **Dev/prod parity caveat:** the suite ran on macOS (the dev machine); the public
   boxes are Linux. The code is plain Node with no OS-specific paths (the index
   normalizes path separators to `/`).
8. **`execArgv: []`** means a worker cannot inherit parent flags. Fine for a `.mjs`
   worker; a future worker needing a flag must pass it explicitly.
9. **R6** (license / branch divergence) is **out of scope** — Captain's push call.
10. **The public site copy** is out of scope. Its refusal path already handles the new
    mode, because the API returns `mode: 'refused'`.

---

## 5. The Twelve-Factor line

One line of evidence per factor, per
`~/projects/pan-cc/standards/DEFINITION-OF-DONE-AND-READY-TO-DEPLOY-2026-11-03.md`.

| # | Factor | Verdict | Evidence |
|---|---|---|---|
| 1 | Codebase | **PASS** | One repo, one branch `fix-receipt-grounding-2026-11-03` off `62a6ea7`; the work is committed (14 commits, `MiniMax:` subjects) and the tree is clean; nothing pushed, no deploy. |
| 2 | Dependencies | **PASS** | `package.json` declares `"dependencies": {}` and nothing was added — no lockfile exists because there is nothing to install; the new code uses only `node:worker_threads`. |
| 3 | Config | **PASS** | Every setting is an env var (`CAIRN_EXTRACT_TIMEOUT_MS`, `MODEL_*`, `CAIRN_STATE_DIR`, `PORT`/`HOST`); no secrets in commits; all 14 commits are authored `Forseti Research <pan@forsetiresearch.com>` (the repo-local identity, left unchanged as instructed) — never the machine default. |
| 4 | Backing services | **PASS** | Model endpoint absent ⇒ the server answers with passages, never an answer (tested, `answer-paths.test.mjs`); embeddings absent ⇒ lexical mode; a stuck file ⇒ reported and skipped, never silently empty; a ledger that cannot be appended ⇒ the answer path falls back to a passages receipt. |
| 5 | Build, release, run | **PASS** | There is no build step (plain ESM, zero deps): the release *is* the committed sha and `node server.mjs` runs exactly that tree. |
| 6 | Processes | **PASS** | The receipt ledger is the named store, on disk, hash-chained and re-read on every append; the index is in memory and rebuilt at boot, so a restart loses nothing that must survive. |
| 7 | Port binding | **PASS** | The server binds `HOST`/`PORT` from the environment (loopback `127.0.0.1` in every test); nothing external is required to serve it. |
| 8 | Concurrency | **PASS** | The declared process model is single-writer: the reindex runner is single-flight (`lib/reindex.mjs`, a newer pass supersedes the running one) and the ledger append is a single writer that re-reads the tail; extraction runs one worker per file, in sequence. |
| 9 | Disposability | **PASS (with a gap)** | Every network call and spawned process now has a timeout and a kill path: the model call aborts at 120 s (`lib/model.mjs`), extraction is killed at `CAIRN_EXTRACT_TIMEOUT_MS` (default 30 s) — that is the R4 fix — and the worker is terminated on every exit path. **Gap:** the HTTP server still has no SIGTERM handler, so there is no graceful stop on a deadline (pre-existing; gap 5 above). |
| 10 | Dev/prod parity | **PASS (with a caveat)** | The full suite was run twice — `TZ=UTC` and `TZ=America/Chicago` — 151/151 both times, artifacts kept in `evidence/`; the code is plain Node with no OS-specific paths. **Caveat:** it ran on macOS, the boxes are Linux (gap 7). |
| 11 | Logs | **PASS** | The two suite transcripts and the three repro transcripts are committed under `evidence/` and hashed in this report (sha256 per file), next to the results they support. |
| 12 | Admin processes | **PASS** | The one-off task — re-checking old receipts — is `scripts/rescan-receipts.mjs`: same codebase, versioned and committed, **dry run by default** so it cannot touch real data by accident, and its output is recorded in the ledger as `receipt_correction` entries. |

---

## 6. What I did NOT do

- I did not touch `~/projects/cairn` (the live checkout), `~/brain`, CAIRN Studio's
  state, or any real ledger. Every run used a temporary `HOME` and a temporary
  `CAIRN_STATE_DIR`.
- I did not reindex anything real.
- I did not push, deploy, or touch the public boxes.
- I did not run the re-scan against a real ledger — that is Pan's dry run on a copy.
- I did not change the repo-local git identity, and I did not push anything.
- **I am not calling this CLEAR or READY. Pan gates it.**
