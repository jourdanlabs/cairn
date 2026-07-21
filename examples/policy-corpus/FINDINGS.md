# CAIRN Integrity Findings — `policy-corpus`

Proof that CAIRN surfaces real integrity defects in a realistic controlled-policy
library. This report was produced by `examples/run-demo.mjs`, which builds an
index over this corpus, embeds every chunk against a **local** Ollama endpoint
(`nomic-embed-text`), and runs `integrityReport()`. Everything ran offline; no
data left the machine.

Reproduce with:

```
node examples/run-demo.mjs
```

## Headline result

| Metric | Value |
| --- | --- |
| Integrity score | **73 / 100** |
| Grade | **C** |
| Notes indexed | 11 |
| Chunks indexed | 46 |
| Embeddings | on (`nomic-embed-text`, local Ollama), `embedded=true` |
| Controlled coverage | 9 / 11 (authoritative) |
| Contradiction candidates | 9 (threshold 0.82) |
| **Confirmed** contradictions (adjudicated) | **1** |

Score penalties breakdown (adjudicated): contradictions −15 (1 confirmed,
controlled↔controlled), broken links −6, stale −4, orphans −2 → **100 − 27 = 73**.

> The score weights **confirmed** contradictions (a local model classifies each
> candidate) and deterministic structural defects — not mere topical overlap. See
> [`../REMEDIATION.md`](../REMEDIATION.md) for the same library remediated to **100 / A**.

The library reads like a real one — 9 cross-linked controlled policies (access
control, incident response, vendor risk, AML/KYC, change management, data
classification, plus the two retention documents and an umbrella information
security policy) — yet CAIRN still pins down every planted defect.

## 1. Contradiction caught (the headline defect)

Two **controlled** policies disagree on how long client records must be kept.
CAIRN paired their retention sections by embedding similarity and surfaced them
as the **top** candidate, well above the 0.82 threshold:

| Field | Value |
| --- | --- |
| Cosine similarity | **0.963** |
| Document A | `policies/data-retention-policy.md` › *Client Record Retention* |
| Document B | `policies/records-management-standard.md` › *Client Record Retention* |

- `data-retention-policy.md` requires client records be retained for a minimum of
  **seven (7) years** after the relationship closes.
- `records-management-standard.md` requires the same records be retained for a
  minimum of **three (3) years**.

Both are marked `authority: controlled`, so this is exactly the kind of silent,
authoritative-vs-authoritative conflict that a keyword search or a table of
contents will never catch — a 7-vs-3-year retention gap is a live regulatory
exposure. CAIRN flags it as the single strongest overlap in the whole library.

> Note: the report lists these as high-similarity *candidates*, not confirmed
> contradictions. Because both retention docs are `authority: controlled`, this
> pair is surfaced among the **controlled overlaps** — the review-first list.
>
> Adjudicated (local `gemma4`): this pair returns **`contradict`** — *"conflicting
> minimum retention periods… seven or three years"* — while the other controlled
> overlaps (e.g. `access-control` ↔ `incident-response`) return **`related`**. The
> surveillance surfaces nine same-topic candidates; adjudication confirms the one
> that is a genuine authoritative-vs-authoritative contradiction. It does not cry wolf.

## 2. Stale document caught

| Field | Value |
| --- | --- |
| Note | `archive/legacy-retention-note-2019.md` |
| Title | Legacy Data Retention Working Note (2019) |
| Age | 2689 days (file mtime dated 2019-03-11) |
| Trigger | `DRAFT` / `TODO` / `FIXME` markers present |

An abandoned 2019 working note about retention, still carrying `DRAFT` and `TODO`
markers, that nobody retired when the schedule was formalized. CAIRN flags notes
older than 180 days that still carry open tasks or draft markers.

## 3. Orphan document caught

| Field | Value |
| --- | --- |
| Note | `notes/unfiled-meeting-notes.md` |
| Title | Unfiled Compliance Sync Notes |

Meeting notes that link to nothing and that nothing links to — unreachable from
the rest of the control library, so easy to lose. Zero inbound and zero outbound
links.

## 4. Broken link caught

| Field | Value |
| --- | --- |
| From | `policies/data-classification-policy.md` |
| Broken `[[wikilink]]` | `Cryptographic Key Management Standard` |

The Data Classification Policy points readers at a "Cryptographic Key Management
Standard" for how encryption keys are handled — but that standard does not exist
in the library. A control that references a non-existent control is a real gap;
CAIRN resolves every `[[wikilink]]` and reports the dangling one.

## Findings summary

| Finding | Count |
| --- | --- |
| Contradiction candidates | 9 (top pair 0.963) |
| Broken links | 1 |
| Stale notes | 1 |
| Orphan notes | 1 |
| Duplicate titles | 0 |
| Stub notes | 0 |
| Untagged notes | 0 |

## Integrity report hash

```
report_sha256 = 549e7fc355423be5631ac42e9d909de1cc3234a71f96efe1c73165944859ddb2
generated_at  = 2026-07-21T21:10:52.494Z
```

The report is a single hashed artifact. The hash covers the full report object,
which includes the `generated_at` timestamp — so it is reproducible for a fixed
index **and** a fixed generation time. Re-running the demo produces the same
findings and the same `0.963` retention pair, with a fresh timestamp and
therefore a fresh hash. The value above corresponds to the run at the
`generated_at` shown.

---

*Generated by CAIRN — a local, zero-dependency knowledge-integrity tool. Node
built-ins only; embeddings served by a local Ollama instance; nothing leaves the
box.*
