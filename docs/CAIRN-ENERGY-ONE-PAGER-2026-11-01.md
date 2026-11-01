# CAIRN for process-safety documents

**Forseti Research · DRAFT 2026-11-01 · not for send until Captain reads it**

## The problem, in one example

An approved MOC cuts the nitrogen purge on a contactor from thirty minutes to fifteen. The follow-up to revise the SOP is assigned, due, and never closed. Six months later the SOP still says thirty, the MOC says fifteen, and two crews are running two different procedures. Every year someone signs that the operating procedures are current and accurate.

## What CAIRN does

- **Answers from your controlled documents, with sources, or refuses.** Ask "what is the purge time?" and CAIRN cites both documents and shows the conflict instead of averaging it away. Ask about a standards clause that isn't in your document set and it refuses. The refusal is a confidence check that runs before any model is called.
- **Finds where your own documents disagree.** A contradiction sweep pairs similar passages across the set and flags the worst kind: two **controlled** documents that conflict. It reports these as candidates. Confirming one takes a person or a model.
- **MOC cards mark a required action with no completion evidence as OPEN.** The card never assumes the follow-up was done. Every fact on a card has to survive a word-for-word quote check against its source, or the card drops it and counts the drop.
- **Writes a receipt for every answer and every refusal.** Each one goes into a hash-chained ledger that you can recompute yourself. If anyone edits a past entry, the chain breaks at that line.
- **Can run fully local.** It has a zero-dependency core and runs local models on your hardware. Your documents don't have to leave the building.

## See it

The public demo at **cairnsemantics.com/energy** runs on a fictional unit (Unit 300, amine treating). It takes four live steps: the MOC card, the purge question, the contradiction sweep, and a refusal you verify yourself. The demo box sends retrieved snippets of its synthetic documents to a hosted model. A local install doesn't need to.

## Why we trust it

We run the same engine every day on our own archive of more than 6,000 documents. It has stopped us from repeating claims our own records didn't support.

## What it is not

- **Not proof that a document is right.** A verified quote proves the document said it. It doesn't prove the procedure is correct.
- **Not a document-control system.** It reads your controlled set; it doesn't replace it. It flags staleness by file age, not by your review dates.
- **Not WORM storage.** The ledger is tamper-evident, not tamper-proof. It assumes a single writer, and the timestamp sits outside the seal on purpose.
- **Not certified.** SOC 2, ISO and similar certifications belong to the system you run it in. CAIRN produces the evidence those audits ask for.

**Contact:** [FILL: Captain]
