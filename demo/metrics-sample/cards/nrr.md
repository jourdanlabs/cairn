---
entity: "NRR"
card: held-knowledge
type: concept
kind: metric
generated: 2026-07-23T21:39:43.991Z
sources: 4
facts_verified: 8
facts_dropped: 2
receipt: sha256:a453f5f3c40f3383cecbf25c0b3a7bc63b7744ed7ac4fc02c1dbdfee1dccd0e6
---

# NRR — held knowledge

Consolidated card for **NRR** (concept). Every fact below carries a verbatim quote verified mechanically against its source passage; extractions that failed verification were dropped, not kept.

- **The formal definition of NRR is provided as: 'NRR is the current MRR of the customer cohort that was active twelve months ago, divided by that cohort's MRR twelve months ago, expressed as a percentage.'** — “NRR is the current MRR of the customer cohort that was active twelve months ago, divided by that cohort's MRR twelve months ago, expressed as a percentage.” — `governed/metric-nrr.md`
- **The formula for NRR is defined as: 'NRR = (cohort MRR now ÷ cohort MRR 12 months ago) × 100'** — “`NRR = (cohort MRR now ÷ cohort MRR 12 months ago) × 100`” — `governed/metric-nrr.md`
- **For NRR, expansion, contraction, and churn within the cohort are included, but new logos are excluded.** — “Expansion, contraction, and churn within the cohort are all included; new logos are excluded.” — `governed/metric-nrr.md`
- **The grain and window for NRR is a monthly cohort basis, trailing twelve months.** — “Monthly cohort basis, trailing twelve months.” — `governed/metric-nrr.md`
- **NRR compares this month's cohort MRR to the same cohort a year ago; expansion and churn count, but new customers do not.** — “NRR compares this month's cohort MRR to the same cohort a year ago. Expansion and churn both count; new customers don't.” — `wiki/finance-faq.md`
- **The NRR panel uses a cohort basis, trailing twelve months, and is owned by RevOps.** — “NRR panel: cohort basis, trailing twelve months, per the governed definition owned by RevOps.” — `wiki/dashboard-notes.md`
- **Acquired-company cohorts are excluded for the first six months post-close, per the governance-board decision of March 2026.** — “Acquired-company cohorts are excluded for the first six months post-close, per the governance-board decision of March 2026.” — `governed/metric-nrr.md`
- **The acquired-cohort exclusion (six months post-close) was applied to the Meridian Data acquisition cohort in March.** — “The acquired-cohort exclusion (six months post-close) was applied to the Meridian Data acquisition cohort in March.” — `wiki/dashboard-notes.md`

*Derived from 4 passages · 8 facts verified · 2 dropped as unverifiable · regenerate via `POST /api/consolidate`.*
