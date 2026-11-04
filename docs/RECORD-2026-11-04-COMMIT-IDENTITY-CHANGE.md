# Record: commit identities changed before first publish (2026-11-04)

This note discloses a change Forseti Research made to this repository's history **before** it was published, so that anyone auditing the repo can see it and check it. Nothing here was hidden; this note exists so it isn't.

## What happened
- On 2026-11-04, before pushing to `main`, **9 commits** that had been made under the developer machine's default identity (`sokpyeon@Sokpyeons-MacBook-Pro-3.local`) were re-signed to `Forseti Research <pan@forsetiresearch.com>`.
- **Only the author and committer name and email changed.** Each commit's content (its tree), message and dates are unchanged.
- Because a commit's hash includes its parent's hash, the **17 commits after them** (already signed by Forseti Research) also received new hashes, with no change to their content, identity, message or dates.
- This was done under a pre-publish rule that has since been **withdrawn**. Forseti Research's rule now: **history is never rewritten.** The organisation identity is set when a repository is created, and earlier commits are published exactly as they were made.

## How to check it
Each row lists the original commit, the published commit, and the content tree hash, which is the same for both. For any published commit:

```bash
git rev-parse <published-commit>^{tree}   # equals the tree hash in the table
```

The original commits are retained privately by Forseti Research (branch `backup/main-pre-resign-2026-11-04` and the original feature branch) and are available to an auditor on request.

## The 9 commits whose identity changed
| Original | Published | Tree (identical) | Subject |
|---|---|---|---|
| `4ddc6ea2d164` | `3764e91aaad9` | `d3468943d148` | Engine OOM fixes F1-F3: sharded embed cache, single-flight reindex, su |
| `8040f237cc45` | `9496c5d232c6` | `ca5b6e0eb36a` | brain-ingest: mask Resend, Fly and Slack xoxc/xoxd secrets before they |
| `39fb0b422fa4` | `f4f0465f25d1` | `62695ffc8835` | Answer model on OpenAI gpt-6.1-terra; honest Act II copy in both state |
| `397cc2b5012d` | `243fa59a2775` | `2866a037d1ef` | Review fixes (local Qwen 27B): byte-identical body when MODEL_TEMPERAT |
| `69437c26a781` | `22fa3258672f` | `b3c693bc4462` | Move Act II down-state logic out of beats.js into answer-state.js (bea |
| `e0cdb4dfa5ee` | `08f0903affca` | `4acc3df9501f` | Civic Act II copy: don't promise both numbers (live gpt-6.1-terra answ |
| `c1011249c462` | `8414fe13975c` | `5b889f3a246f` | answer-state.js: render the answer model's **bold** as <b> via text no |
| `e17e6d5e2bb7` | `3f0a25a1631e` | `7c411dab618a` | Merge answer-model-2026-11-01: gpt-6.1-terra answer model, honest Act  |
| `62a6ea78c452` | `9ecd3526e78f` | `22854e3b8bb5` | Docs: drop 'nobody' market claims (10-25 scan found others); add energ |

## The 17 commits that received new hashes only (identity already Forseti Research)
| Original | Published | Tree (identical) | Subject |
|---|---|---|---|
| `e48797b3a1ca` | `c2792e5b7a23` | `911c34075d1f` | MiniMax: R7 red — grouped and ranged citations must resolve to individ |
| `a49e737c2c5b` | `6937090d5fb2` | `534254fad144` | MiniMax: R7 green — parse grouped and ranged citations into individual |
| `42f6f1949aa1` | `9e4ef358462c` | `24143e940f00` | MiniMax: R1+R2 red — the verdict must come from validated citations |
| `22891895ec7a` | `641b252e8df9` | `5ad09ad2a889` | MiniMax: R1+R2 green — the verdict comes from validated citations, or  |
| `1ba3b2fcf3a6` | `d768d3c7d835` | `3e7060d6e7cf` | MiniMax: R3 red — ranking must be reproducible, not a reading of the w |
| `2eb520a41b93` | `1e76ec24d365` | `0cd92b66da0e` | MiniMax: R3 green — search() takes an explicit now, and the receipt re |
| `21ed573cf4c3` | `78ecee711f0c` | `56a42e0f1014` | MiniMax: R5 red — the tokenizer must keep section numbers |
| `ba33e458dd62` | `6972fdef7cd6` | `fa5c8ad9a30a` | MiniMax: R5 green — section numbers survive the tokenizer whole |
| `8a4cbfe6386a` | `77af28c7b860` | `aaff89db8c42` | MiniMax: R4 red — extraction needs a time limit and a kill path |
| `fd963b85d6e3` | `931f1ee4f939` | `048cf44eec54` | MiniMax: R4 green — extraction runs under a time limit, with a kill pa |
| `084a16cb7a93` | `d349439504a1` | `56c17a2db36c` | MiniMax: R6 red — a tool to re-check the old receipts, without touchin |
| `a9be5cb2123c` | `d28401ee40b4` | `c983b7bd000b` | MiniMax: R6 green — scripts/rescan-receipts.mjs re-checks the old rece |
| `0e82e4513be4` | `40e86a11ea62` | `2b17fe12a219` | MiniMax: bring Pan's repro scripts into the worktree so the gate can r |
| `dcfdbfdd870b` | `4a815e3480a5` | `90139fb4fd2a` | MiniMax: the receipt-grounding report and the evidence behind it |
| `a20570dd895f` | `3af93fc42d2b` | `4cef95c6ab2f` | MiniMax: C-1 red — a citation range must never be wider than the conte |
| `532d8168ed46` | `fd64ec44bfc2` | `fa060a6bb49b` | MiniMax: C-1 green — a citation range is never expanded wider than the |
| `3fe062a29d82` | `5b77aafaf17f` | `ea69387b8352` | MiniMax: the report addendum for C-1, the unbounded citation range |

Also part of that publish, and new on 2026-11-04: the merge of the Apache-2.0 license commit (`290567e`), recorded as `429dee5`.

— Forseti Research, 2026-11-04
