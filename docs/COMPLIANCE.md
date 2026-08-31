# CAIRN — Compliance & Controls Mapping

This maps CAIRN's **actual, shipped capabilities** to the control families a
regulated buyer (bank, insurer, healthcare) evaluates. It claims nothing CAIRN
does not do. CAIRN is a **control you operate**, not a certification: it produces
the evidence and enforcement, your environment provides the perimeter and identity.

Every row cites the code that implements it, so this document is verifiable, not
marketing.

---

## What CAIRN provides vs. what your environment provides

| CAIRN provides | Your environment provides |
|---|---|
| Grounded cite-or-refuse answers, each hash-receipted | The deployment perimeter (VPC / on-prem / air-gap) |
| A tamper-evident receipt ledger + verification | Your identity provider (SAML/OIDC) — CAIRN plugs into it |
| RBAC and API-key auth, OIDC-ready | The knowledge source tenants (Confluence/SharePoint) + their tokens |
| Continuous integrity + contradiction surveillance | TLS termination, secrets storage, backup of `.cairn/` |
| An auditor-ready evidence export | Certification of your overall system (SOC 2, etc.) |

CAIRN is **not** SOC 2 / ISO / HIPAA *certified* — certification is a property of
your operated system, not of a component. CAIRN is built to sit inside a certified
environment and generate the evidence those audits ask for.

---

## Control mapping

### 1. Data residency & confidentiality
- **Local by default.** The corpus is indexed in memory on the host; nothing is
  sent anywhere unless you configure an external model endpoint. Embeddings and
  chat can run fully local via Ollama. — `lib/model.mjs`, `lib/embed.mjs`
- **Air-gap capable.** With a local model endpoint and the filesystem connector,
  CAIRN needs no outbound network. — `Dockerfile` (`WATCH=off`, no egress required)
- *Boundary:* if you point `MODEL_API_KEY` at a hosted model, data leaves the
  perimeter — that is your configuration choice, flagged in `.env.example`.

### 2. Access control (least privilege)
- **RBAC** with three roles — `viewer` (search/ask/read), `analyst` (integrity,
  contradictions, surveillance, audit export), `admin` (reindex, connector ingest,
  management). Deny-by-default on unmapped routes. — `core/auth.mjs`
- **API keys** via `CAIRN_API_KEYS`; **OIDC-ready** via a `verifyBearer(token)`
  hook that validates your IdP's JWT and returns the principal — no code change to
  wire your SSO. — `core/auth.mjs`, tested in `test/auth.test.mjs`
- **Open mode** (no keys) is the single-user local default; closed mode activates
  automatically once keys or a verifier are configured.

### 3. Audit trail & evidence integrity
- **Hash-chained receipt ledger.** Every answer path (refusal, retrieved passages,
  grounded synthesis), every integrity report, and every held-knowledge card is
  sealed into an append-only JSONL where each entry binds the prior entry's hash.
  Any edit to a hashed field of any past entry — the sequence, prior-hash link, or
  payload — is detectable, as is deleting or reordering a line. — `core/ledger.mjs`,
  `test/ledger.test.mjs`
  - *Single-writer assumption:* the chain is correct for one writer. Two processes
    appending to the same ledger file concurrently can fork it — run one writer per
    ledger, or a ledger per instance.
- **Verification endpoint** recomputes the whole chain: `GET /api/ledger/verify`.
- **Evidence export** bundles the current integrity posture + the full sealed
  chain + its verification for an auditor: `GET /api/compliance/export`.

### 3a. What the seal binds (and what it deliberately does not)

The entry hash is:

```
sha256( seq | prev_hash | kind | canonicalJSON(payload) )
```

**Binds:** position in the chain (`seq`), linkage to the prior seal (`prev_hash`),
the entry kind (`answer_receipt` / `passages_returned` / `integrity_report` / …),
and the canonical payload (sorted keys, no undefined). Tamper any of those and
`GET /api/ledger/verify` returns `ok: false` with `broken_at` set to the first
broken sequence number.

**Does not bind:** the wall-clock `ts` field. That is deliberate. A receipt is a
proof of *order and content*, not a proof of *when*. Wall-clock trust is a
separate problem (NTP, a timestamping authority, a signed TSA token). Folding
`ts` into the hash would make two honest machines with skewed clocks produce
irreproducible seals, and would still not prove the clock was honest.

**What an auditor should check:** recompute the chain. Do not treat `ts` as
evidence. If you need time, bring your own clocking discipline and record it
*inside the payload* of the thing you are sealing — that field *is* hashed.

See `core/ledger.mjs` (`entryHash`) and `test/ledger.test.mjs`.

### 4. AI output traceability (model-risk hygiene)
- **Cite-or-refuse.** The confidence gate refuses to answer when the corpus does
  not support it — "Not in your vault" is a receipted outcome, not a hallucination.
  — `lib/search.mjs` (weak-result gate), `lib/ground.mjs`
- Every answer carries its **source passages + a hashed receipt**, so a reviewer
  can trace any AI statement back to the controlled document it came from.

### 5. Ongoing monitoring of knowledge controls
- **Integrity report** scores the corpus (broken/stale/orphan/duplicate structure,
  controlled-doc coverage, contradiction candidates) deterministically, with a
  reproducible `report_sha256`. — `lib/integrity.mjs`, `test/integrity.test.mjs`
- **Surveillance** re-runs on a schedule, diffs against the prior sealed state, and
  alerts only on **new** defects/contradictions (webhook / file / SIEM sink). The
  first run is a silent baseline. — `core/surveillance.mjs`,
  `test/surveillance.test.mjs`
- **Contradiction detection** at scale uses an in-process ANN index (no external
  vector DB), with a model adjudication pass turning "these look similar" into a
  verdict. — `lib/contradict.mjs`, `core/vector-index.mjs`

---

## Deploy posture
- Runs as a **non-root** user in a minimal container; no dependencies to patch
  (Node built-ins only). — `Dockerfile`
- Writable state is confined to `.cairn/` (ledger, surveillance snapshots, alerts)
  — mount it as a persistent, backed-up volume.
- Ungated `GET /api/health` for liveness probes; everything else is RBAC-gated in
  closed mode.

## Honest boundaries (JourdanLabs rule #1: ship no bullshit)
- **SSO** is wired to *your* IdP via the OIDC hook; CAIRN ships the adapter and
  fixture tests, not a live connection to an identity provider it doesn't have.
- **Connectors** (Confluence, etc.) are coded to the real vendor REST APIs and
  fixture-tested; a live pull needs *your* tenant + token.
- **Certification** of the surrounding system is yours; CAIRN supplies the evidence.
