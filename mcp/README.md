# CAIRN MCP — the knowledge-integrity engine as agent tools

Give any MCP client (Claude Code, Claude Desktop, your own harness) grounded,
cite-or-refuse access to a CAIRN corpus. **Zero dependencies** — the server speaks
MCP's stdio transport (JSON-RPC 2.0, one message per line) with Node built-ins only,
same as the rest of CAIRN.

It is a **thin client to a running CAIRN engine**: the engine owns the one index and
the one hash-chained receipt ledger (single-writer by design), so the browser UI,
CAIRN Studio, curl, and every agent session all read and seal against the same brain.

## Setup

Start a CAIRN engine (or have CAIRN Studio running):

```bash
node server.mjs        # serves on 127.0.0.1:4600 by default
```

Register the MCP server:

```bash
# Claude Code (user scope = every project gets the tools)
claude mcp add cairn --scope user \
  --env CAIRN_URL=http://127.0.0.1:4600 \
  -- node /path/to/cairn/mcp/server.mjs
```

| Env | Default | Purpose |
|---|---|---|
| `CAIRN_URL` | `http://127.0.0.1:4600` | The running engine (Studio serves on `:4611`) |
| `CAIRN_API_KEY` | — | Closed-mode key, sent as `x-api-key` |

No engine running? Tools return a clear how-to-start message instead of forking state.

## Tools

| Tool | What it does |
|---|---|
| `cairn_search` | Grounded search; ranked passages + calibrated confidence; `weak:true` means "not established by the corpus" |
| `cairn_ask` | Cite-or-refuse answer with source citations and a hash-sealed receipt; a refusal is a reliable negative, sealed on the record |
| `cairn_consolidate` | Distill a held-knowledge card for an entity; every fact must survive character-level quote verification — unverifiable extractions are dropped and counted |
| `cairn_cards` | List held-knowledge cards with receipts |
| `cairn_integrity` | Audit + contradiction report (0–100 score, grade, findings; `adjudicate:true` for model-confirmed contradictions) |
| `cairn_verify_ledger` | Recompute the receipt chain; `ok:false` + `broken_at` means the sealed record was altered |
| `cairn_status` | Vault, counts, active edition profile, strictness, search mode |

## Why agents want this

An agent with CAIRN tools **cannot confabulate a memory**: recall either comes back
with citations and a receipt, or it comes back refused — and the refusal itself is
sealed in the ledger. That constraint is the point.
