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
