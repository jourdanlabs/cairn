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
- **Hash-chained receipt ledger.** Every answer and every integrity report is
  sealed into an append-only JSONL where each entry binds the prior entry's hash.
  Any later edit to any past line is detectable. — `core/ledger.mjs`,
  `test/ledger.test.mjs`
- **Verification endpoint** recomputes the whole chain: `GET /api/ledger/verify`.
- **Evidence export** bundles the current integrity posture + the full sealed
  chain + its verification for an auditor: `GET /api/compliance/export`.

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
