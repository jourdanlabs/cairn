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
