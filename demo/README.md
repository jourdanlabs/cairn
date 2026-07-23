# Demo matter — *Meridian Fabrication LLC v. Copperline Industrial Supply Co.*

**SYNTHETIC DEMO DATA.** Every party, person, document, and event in this folder is
fictional, written to demonstrate the CAIRN law edition. Any resemblance to real
matters or persons is coincidental.

A small breach-of-contract matter file: complaint, answer, two deposition excerpts,
an email exhibit, and an issues memo. It contains one deliberately planted
inconsistency between a witness's testimony and a contemporaneous email — the kind
of thing a witness card must surface with pin cites, never characterize.

## Run the demo

```bash
CAIRN_PROFILE=law VAULT_DIR=demo/matter-sample PORT=4650 node server.mjs
```

Then, in another shell:

```bash
# build a witness card — every fact must survive verbatim-quote verification
curl -s -X POST localhost:4650/api/consolidate \
  -H 'content-type: application/json' \
  -d '{"entity":"Daniel Hargrove","kind":"witness"}' | head -c 2000

# grounded answers with pin cites
curl -s -X POST localhost:4650/api/answer -H 'content-type: application/json' \
  -d '{"q":"When does Hargrove say he inspected the shipment, and what does Exhibit 12 say?"}'

# THE refusal — a case that is not in the matter file
curl -s -X POST localhost:4650/api/answer -H 'content-type: application/json' \
  -d '{"q":"What did the court hold in Zenith Corp v. Balfour?"}'
```

The third answer is the sale: CAIRN is architecturally incapable of citing a case
that is not in the matter file. It refuses, on the record, with a sealed receipt.

---

# Demo corpus — Brightpath metrics (`metrics-sample/`)

**SYNTHETIC DEMO DATA.** Brightpath Software Inc. is fictional. The corpus plants the
classic enterprise disease: **ARR defined three ways** — the governed semantic-layer
definition (`governed/`, controlled), a stale Finance wiki FAQ that annualizes usage
overages, and an analyst crib sheet that multiplies last month's total revenue by twelve.
Only one of the three is the law; CAIRN's job is to say so with receipts.

## Run the data edition

```bash
CAIRN_PROFILE=data CAIRN_VAULT_DIR=demo/metrics-sample CONTROLLED_DIRS=governed \
  PORT=4640 node server.mjs
```

Then:

```bash
# the metric card — every definition recorded WITH its source, never merged
curl -s -X POST localhost:4640/api/consolidate \
  -H 'content-type: application/json' \
  -d '{"entity":"ARR","kind":"metric"}'

# the contradiction sweep — governed definition vs the drift orbiting it
curl -s localhost:4640/api/integrity

# the refusal — a metric nobody ever defined
curl -s -X POST localhost:4640/api/answer -H 'content-type: application/json' \
  -d '{"q":"What is our CAC payback period definition?"}'
```

The pitch in one line: **the semantic layer is the law; CAIRN audits everything that
cites the law.**

---

# Demo corpus — Unit 300 amine treating (`unit-sample/`)

**SYNTHETIC DEMO DATA.** Gulf Coast Gas Processing LLC is fictional. The corpus plants
the classic process-safety disease: an approved MOC reduced the nitrogen purge for
amine contactor V-301 startup to **fifteen (15) minutes**, the controlled SOP still
says **thirty (30) minutes**, the crews are already running the new number, training
is unrecorded, and the follow-up to revise the SOP is still OPEN — all under the
annual "current and accurate" certification the PSM coordinator must sign
(29 CFR 1910.119(f)(3)).

## Run the energy edition

```bash
CAIRN_PROFILE=energy CAIRN_VAULT_DIR=demo/unit-sample CONTROLLED_DIRS=controlled \
  PORT=4642 node server.mjs
```

Then:

```bash
# the MOC card — every follow-up quote-verified; no completion evidence means OPEN
curl -s -X POST localhost:4642/api/consolidate \
  -H 'content-type: application/json' \
  -d '{"entity":"MOC-2026-018","kind":"moc"}'

# the contradiction under the signature — 30-minute SOP vs 15-minute MOC, both CONTROLLED
curl -s -X POST localhost:4642/api/integrity \
  -H 'content-type: application/json' -d '{"adjudicate":true}'

# THE refusal — a standard clause that is not in the controlled document set
curl -s -X POST localhost:4642/api/answer -H 'content-type: application/json' \
  -d '{"q":"What does API RP 521 section 5.3 require for our flare header?"}'
```

The third answer is the sale: CAIRN is architecturally incapable of citing a standard
that is not in the controlled set. It refuses, on the record, with an audit receipt —
the thing to have in hand before signing this year's certification.

---

# Demo corpus — Town of Alder Creek (`town-sample/`)

**SYNTHETIC DEMO DATA.** The Town of Alder Creek and every official, ordinance, and
meeting in this folder are fictional. The corpus plants the clerk's nightmare:
**adopted law vs published code** — Ordinance 2026-04 (in `adopted/`, the controlled
folder) cut the short-term rental cap to ninety (90) days, but the codified Chapter 5
still says one hundred twenty (120). Plus a fee resolution whose annual review is two
years overdue (backdate its mtime so the staleness detector has an honest clock):

```bash
touch -t 202408011200 demo/town-sample/adopted/resolution-2019-33.md
```

## Run the civic edition

```bash
CAIRN_PROFILE=civic CAIRN_VAULT_DIR=demo/town-sample CONTROLLED_DIRS=adopted \
  PORT=4641 node server.mjs
```

Then:

```bash
# the ordinance card — every fact survives verbatim-quote verification against the record
curl -s -X POST localhost:4641/api/consolidate \
  -H 'content-type: application/json' \
  -d '{"entity":"Ordinance 2026-04","kind":"ordinance"}'

# the contradiction sweep — the adopted 90-day cap vs the codified 120-day text
curl -s -X POST localhost:4641/api/integrity -H 'content-type: application/json' \
  -d '{"adjudicate":true}'

# THE refusal — an ordinance that was never adopted
curl -s -X POST localhost:4641/api/answer -H 'content-type: application/json' \
  -d '{"q":"What does Ordinance 2026-11 require?"}'
```

The third answer is the sale: no Ordinance 2026-11 exists anywhere in the record, so
CAIRN refuses, on the record, with a sealed receipt — the exact answer the NYC MyCity
chatbot could not give. Your published code disagrees with your adopted law; CAIRN
finds it before a resident's lawyer does.
