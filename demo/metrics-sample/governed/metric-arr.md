---
demo: synthetic
doc: Governed metric definition — ARR
owner: RevOps
effective: 2026-01-15
---

# ARR — Annual Recurring Revenue (governed definition)

*(Synthetic demo document — Brightpath Software Inc. is fictional.)*

**Definition.** ARR is the sum of active subscription contract MRR multiplied by twelve, measured as of the last calendar day of the month. ARR excludes usage overages, one-time professional services, and credits issued in the period.

**Formula.** `ARR = Σ(active subscription MRR at month end) × 12`

**Grain and window.** Company-wide, month-end snapshot. Contracts in a signed-but-not-live state are excluded until the service start date.

**Owner.** Revenue Operations (RevOps). Changes to this definition require a governance-board vote.

**Effective.** January 15, 2026, superseding the 2024 interim definition.

**Systems of record.** The semantic layer publishes this definition to the executive dashboard and the board pack. Any document that states ARR differently is out of date and should be corrected.
