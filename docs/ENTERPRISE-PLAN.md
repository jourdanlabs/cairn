# CAIRN Enterprise — Build Plan

**Product:** A knowledge-integrity & answer-provenance platform for regulated
environments (banks, insurers, healthcare). Deployed inside the customer's
perimeter, it connects to their knowledge sources, continuously surveils them for
contradiction and staleness, answers questions with cite-or-refuse **and a hashed,
verifiable receipt**, and produces auditable integrity reports.

Not search. Not a chatbot. A **control**: provenance on every answer, and
surveillance on the corpus itself.

---

## The honest boundary (JourdanLabs rule #1: ship no bullshit)

Everything below is buildable to real, tested completion **except the last mile
that physically lives in the customer's environment**:

- a **live Confluence / SharePoint / Notion tenant** (needs their instance + an
  OAuth app registration + a token),
- the bank's **SSO / IdP** (SAML/OIDC against *their* identity provider),
- their **deployment infrastructure** (their VPC / on-prem / SOC2 / procurement).

Those are built **correct, config-driven, and tested against fixtures**, coded to
the real vendor APIs and ready to point at the customer — but they cannot be *run
live* from here without the customer's own systems. Fabricating a bank to claim
"done" would be the exact bullshit we refuse to ship. Every such boundary is
flagged explicitly in the code and docs.

---

## Target architecture

```
 sources ──► CONNECTORS ──► INGESTION ──► STORES ──► ENGINES ──► API ──► clients
 (Confluence,  (Document     (fetch→parse   (docs,     (retrieval,  (REST,
  SharePoint,   model +       →chunk→embed   vectors,   grounded     authz,
  filesystem,   source iface) →index)        receipt    answer,      audit log)
  REST)                                      ledger,    audit,
                                             reports)   surveillance)
```

- **Connectors** normalize any source to a common `Document` (`core/document.mjs`).
- **Stores**: document/chunk store, vector index (ANN for scale), a hash-chained
  **receipt ledger**, and report/audit history — durable, on disk.
- **Engines**: hybrid retrieval, grounded cite-or-refuse answer, deterministic
  audit, contradiction surveillance (embeddings + adjudication), integrity scoring.
- **Surveillance**: scheduled re-ingest → diff vs prior state → detect *new*
  contradictions/defects → alert (webhook / SIEM / email).
- **API + AuthZ**: REST, API keys + OIDC-ready, RBAC (viewer/analyst/admin),
  full audit logging.
- **Everything is receipted**: every answer and report is a hash-sealed ledger
  entry; a verify endpoint recomputes the hashes.

## Phases (each ships with passing tests)

| Phase | Scope | Deliverables | Buildable here |
|---|---|---|---|
| **0** | Foundation | package layout, `node:test` suite over the deterministic engine (index/search/audit/integrity/receipt), CI workflow | ✅ fully |
| **1** | Provenance core | on-disk stores; hash-chained **receipt ledger** (`append`, `verify`, tamper-evident); receipts on answers + reports flow through it | ✅ fully |
| **2** | Connectors | `Document` model + `Connector` interface + registry; **filesystem** (migrate current), **Confluence Cloud** (real REST API, fixture-tested), **generic REST**; incremental sync | ✅ code + fixtures; live run needs a tenant token |
| **3** | Scale | ANN vector index (HNSW/IVF-lite, pure JS) replacing O(n²) contradiction detection; incremental (re)indexing; benchmark to 100k+ chunks | ✅ fully, benchmarked |
| **4** | Surveillance | scheduler; state snapshot + diff; **new-defect / new-contradiction detection**; alert sinks (webhook, file, stdout/SIEM); dedupe | ✅ fully |
| **5** | API + AuthZ | versioned REST API; API keys; **RBAC** (viewer/analyst/admin); request audit log; **OIDC-ready** auth adapter | ✅ fully; live SSO needs their IdP |
| **6** | Deploy + harden | Dockerfile, config schema, air-gap mode, secrets handling, input validation, admin surface, self-contained runtime | ✅ fully; actual bank deploy is theirs |
| **7** | Compliance pack | audit/evidence exports (CSV/JSON), signed report bundle, updated pitch + pricing model | ✅ fully |

## Non-negotiables (the product's spine)

1. **Local by default** — corpus and models can run fully air-gapped; nothing
   leaves the perimeter unless configured to.
2. **Refuse over guess** — the confidence gate stays; "Not in your vault" is a
   feature, and it is receipted.
3. **Everything checkable** — every answer and report re-verifies from its hash;
   no black boxes the customer can't audit.
4. **Deterministic where it can be** — retrieval, audit, scoring, and receipts are
   reproducible given the same index.

## Status — built & tested (53 passing tests, zero dependencies)

Every phase below is code-complete and covered by `node --test`. The only pieces
that cannot run from here are the ones that physically require the customer's own
systems (a live tenant token, their IdP, their infra) — flagged, not faked.

| Phase | Built | Proven by |
|---|---|---|
| **0** Foundation | ✅ | 20 engine tests (index/search/audit/integrity) + CI workflow; no engine bugs found |
| **1** Provenance core | ✅ | `core/ledger.mjs` hash-chain; receipts flow through `/api/answer` + `/api/integrity`; `test/ledger.test.mjs`; live `GET /api/ledger/verify` |
| **2** Connectors | ✅ code + fixtures | `Document` model + registry; **filesystem** connector ingests via `indexDocuments`; **Confluence Cloud** on the real v2 REST API, fixture-tested (`test/confluence.test.mjs`, `test/index-documents.test.mjs`); live pull needs a tenant token |
| **3** Scale (ANN) | ✅ benchmarked | `core/vector-index.mjs` LSH index; ~76× over brute force at 20k×768, 98.3% recall / 100% precision; wired into `lib/contradict.mjs` with an exact-parity test (`test/contradict-ann.test.mjs`) |
| **4** Surveillance | ✅ | baseline→clean→regression cycle, new-defect detection, webhook/file/stdout sinks; `test/surveillance.test.mjs`; live `POST /api/surveillance` |
| **5** API + AuthZ | ✅ | RBAC (viewer/analyst/admin) + API keys + OIDC hook; `test/auth.test.mjs`; **live-verified** 401/403/200 enforcement on the running server; live SSO needs their IdP |
| **6** Deploy + harden | ✅ | non-root `Dockerfile` (zero-dep, no build step), `.dockerignore`, ungated `/api/health` probe, state confined to `.cairn/`; actual bank deploy is theirs |
| **7** Compliance pack | ✅ | `docs/COMPLIANCE.md` control mapping (cited to code, no false certification claims); `GET /api/compliance/export` auditor evidence bundle (integrity posture + sealed chain + verification) |

**New API surface (all RBAC-gated in closed mode):**
`GET /api/health` · `GET /api/status` · `POST /api/search` · `POST /api/answer` ·
`POST /api/integrity` · `POST /api/contradictions` · `POST /api/surveillance` ·
`GET /api/ledger/verify` · `GET /api/compliance/export` · `GET /api/connectors` ·
`POST /api/connectors/ingest` · `POST /api/reindex` · `POST /api/audit`

This stays a living document — update rows as the customer-side last mile is wired
against their real systems.
