# CAIRN — Live Demo Script

**Audience:** Bank risk & compliance (risk officers, control owners, internal audit).
**Length:** ~5 minutes, live.
**Environment:** CAIRN running locally against a sample policy/procedure corpus. Nothing leaves the machine.

---

### Setup line (say this first)

> "What you're about to see is not search and it's not a chatbot. It's a control. CAIRN answers questions over your policy library, but it will only tell you what it can prove — and it hands you a signed receipt for every answer, and for every time it refuses. Everything here runs on this laptop; the corpus never leaves it."

---

### Beat 1 — A grounded, cited, *receipted* answer

**Click:** In the Ask box, type a real policy question — e.g. *"What is our approval threshold for a new counterparty?"* — and run it.

**Point at the screen:** The answer comes back with a bracketed citation `[1]` on the claim, linked to the exact note it came from. "Notice every claim carries a source. This isn't the model's general knowledge — it's locked to your documents."

**Click:** Download the receipt (JSON).

**Point at these fields in the receipt:**
- `verdict: GROUNDED`
- `sources` → each cited passage carries a `content_sha256` and a `source_mtime`
- `index_built_at`, `at` (timestamp), `confidence`, `model`, and the `receipt_sha256`

**Say:**
> "This is the part that matters to you. That `content_sha256` is a fingerprint of the exact text the answer was drawn from, at the moment it was answered. So this isn't 'the answer came from the counterparty policy' — it's 'the answer came from *this exact version* of this document, at this timestamp, and here's the hash to prove it.' If that document changes tomorrow, this receipt still tells you what it said today."

---

### Beat 2 — A refusal that is *also* a control

**Click:** Ask something that isn't in the corpus — e.g. *"What's our policy on crypto custody?"* (when no such policy exists).

**Point at the screen:** CAIRN replies **"Not in your vault."** — no guess, no fabricated paragraph.

**Say:**
> "A normal assistant would have written you a confident, plausible answer about crypto custody. There isn't one in this corpus, so CAIRN declined. And here's why that's not a limitation — it refused *before it ever called the model*. A confidence gate stopped it. It structurally cannot bluff to fill a gap."

**Click:** Download this receipt too.

**Point at:** `verdict: REFUSED_UNGROUNDED`.

**Say:**
> "The refusal is receipted exactly like the answer was. That's proof your system declined rather than guessed — and *that itself is a control*. When someone asks 'did the assistant make something up here,' you don't debate it. You show the receipt that says it refused."

---

### Beat 3 — Does your knowledge base agree with itself?

**Click:** Run the Integrity Report (one click).

**Point at the top:** The **score (0–100) and letter grade** over the whole corpus. "This one number moves as your library gets healthier or rots. It's the same audit every time — deterministic given the same index."

**Point at the findings:** Orphans, broken `[[links]]`, stale notes, duplicate titles — the structural rot. Then scroll to the **contradiction candidates**.

**Point at one pair:** Two policy documents about the same topic that don't agree. "CAIRN found these by meaning, not keywords — two procedures covering the same thing, flagged as a candidate conflict for a human to adjudicate: contradict, duplicate, or merely related."

**Say (controlled sources):**
> "These are marked *controlled* — your authoritative policies. When two controlled documents overlap on the same topic, CAIRN surfaces them as the pairs to review first — a conflict between two authoritative policies is the one you can least afford. One click adjudicates them: this retention pair comes back **contradict** — seven years versus three — while the others come back merely *related*. Candidate, confirmed, done. It doesn't cry wolf; it hands you the one that matters."

**Click:** Download the signed report (JSON).

**Point at:** `integrity_score`, `grade`, `generated_at`, `index_built_at`, and the `report_sha256`.

**Say:**
> "That's a hashed, exportable, regulator-ready snapshot of whether your knowledge base even agrees with itself — on a given date, provable it hasn't been edited since."

---

### Beat 4 — The "so what" (kill shot)

**Say:**
> "Every firm here has an audit trail for money and an audit trail for trades. Nobody has an audit trail for *knowledge* — for how your people, and now your AI assistants, knew to do what they did. Today, when a regulator asks 'how did you know to do X,' the honest answer is 'someone read a document, we think, some version of it.' CAIRN turns that into a receipt. And it tells you, before the regulator does, where your own policies contradict each other."

---

### The one sentence to land it

> "When the examiner asks how your people — or your AI — knew to do the right thing, CAIRN is the difference between an argument and a receipt."
