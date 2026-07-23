---
demo: synthetic
doc: Governed metric definition — NRR
owner: RevOps
effective: 2026-02-01
---

# NRR — Net Revenue Retention (governed definition)

*(Synthetic demo document — Brightpath Software Inc. is fictional.)*

**Definition.** NRR is the current MRR of the customer cohort that was active twelve months ago, divided by that cohort's MRR twelve months ago, expressed as a percentage. Expansion, contraction, and churn within the cohort are all included; new logos are excluded.

**Formula.** `NRR = (cohort MRR now ÷ cohort MRR 12 months ago) × 100`

**Grain and window.** Monthly cohort basis, trailing twelve months.

**Owner.** Revenue Operations (RevOps). Last reviewed February 1, 2026.

**Known exception.** Acquired-company cohorts are excluded for the first six months post-close, per the governance-board decision of March 2026.
