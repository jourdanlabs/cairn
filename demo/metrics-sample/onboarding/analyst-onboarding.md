---
demo: synthetic
doc: Analyst onboarding guide
updated: 2025-11-20
---

# Welcome to the analytics team — metric crib sheet

*(Synthetic demo document — Brightpath Software Inc. is fictional.)*

A quick crib sheet for your first week. When in doubt, ask in the data-help channel.

- **ARR** — take last month's total revenue and multiply by twelve. Quick and close enough for most analyses; Finance has a fancier version for the board.
- **NRR** — cohort MRR now over cohort MRR a year ago. New logos excluded.
- **Active User** — any account with a login event in the trailing 30 days.
- **Churn** — logo churn unless someone says "revenue churn"; check which one the dashboard uses before you copy a number.

Dashboards live in the BI folder; the semantic layer is the source of truth for anything it covers — if your SQL disagrees with the semantic layer, your SQL is wrong (or the docs are, in which case tell governance).
