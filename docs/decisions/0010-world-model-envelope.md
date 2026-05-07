# ADR 0010 — world_model block on the brain envelope (v1.1)

Date: 2026-05-07
Status: Accepted
Supersedes: extends [ADR 0005](./0005-npc-llm-loop.md) (NPC LLM loop)
Source issue: [DWEA-45](/DWEA/issues/DWEA-45)
Plan reference: [DWEA-41 plan](/DWEA/issues/DWEA-41#document-plan) §6 v1.1

## Context

The v0 brain envelope ([DWEA-34](/DWEA/issues/DWEA-34)) is

```jsonc
{ schemaVersion, utterance, emotion, intention, actions[] }
```

That envelope drives the renderer fine, but persona depth, theory-of-mind
("what does the user already know?"), and goal state are still implicit —
they exist only in chat history and the system prompt. The v1.5 QA harness
([DWEA-41 plan](/DWEA/issues/DWEA-41#document-plan) §6) is supposed to
detect persona drift and goal incoherence; it cannot do that against a
black-box envelope.

The cognition research note ([DWEA-40](/DWEA/issues/DWEA-40) §2) recommended
making theory-of-mind into a structured, inspectable output every turn.

## Decision

Extend the v0 envelope with a `world_model` object. The envelope becomes:

```jsonc
{
  "schemaVersion": "1.1",          // bumped from "1"
  "utterance":   "...",
  "emotion":     "curious",
  "intention":   "...",
  "actions":     [ ... ],
  "world_model": {
    "believes_user_knows": [ "..." ], // 0-5 short strings (cap: 8)
    "last_user_intent":    "...",     // 1-line summary
    "secrets_to_protect":  [ "..." ], // 0-5 short strings (cap: 8)
    "goal":                "...",     // 1 line
    "mood_drift":          0.05       // [-1.0, 1.0]
  }
}
```

- The `world_model` block is **required** in the JSON schema sent to the
  provider via OpenAI Structured Outputs / OpenRouter `response_format:
  json_schema`. Missing-block replies are rejected at the provider.
- The defensive parser uses a **safe default** when the block is missing
  or mangled, instead of throwing. That keeps the renderer/voice path
  running on free-tier providers that can't honour strict schema mode; the
  QA harness sees the gap from structured logs.
- The renderer does NOT consume the block. Only the structured logger
  (`src/llm/worldModelLog.ts`) does, and it surfaces a `[brain:drift]`
  warning the first time `|mood_drift|` strictly exceeds `0.5` per session.
- A standalone JSON-schema is exported via `getBrainEnvelopeSchema()` for
  the v1.2 Convai work ([DWEA-44](/DWEA/issues/DWEA-44)) and the future
  QA harness, so they validate the envelope shape without instantiating a
  bible.

### Why bump `schemaVersion` to "1.1"

The change is additive (no v0 fields move), but the version bump lets
downstream tooling branch on shape via `===` instead of sniffing for the
`world_model` key. v1.2 Convai integrates against this version from day one.

### Why a strict required block plus a forgiving parser

OpenRouter routes free-tier requests across providers; some accept
`json_schema` strict mode, some only `json_object`. The strict path
guarantees the block on capable providers; the forgiving parser absorbs
the mangle on the rest. That matches the established posture from
[ADR 0005](./0005-npc-llm-loop.md).

### Why `mood_drift` is signed

A signed [-1, 1] value lets us distinguish "warmer than baseline" (positive)
from "colder / more guarded" (negative). The QA harness only acts on the
magnitude today (>0.5), but the sign is cheap to keep and useful for the
v2 multi-monster work where one monster nudging another out of character
matters.

## Consequences

- `MAX_OUTPUT_TOKENS` raised from 512 to 768 in `personality.ts` to keep
  the world_model block from triggering `finish_reason: length` truncation.
  Per-turn cost rises ~10–15%.
- The envelope is now too large to streamline as a single OpenAI strict
  parameter on free-tier models that ignore the schema. The repair-and-
  retry sanitiser already handles the common breakage modes; we extended
  it implicitly via the `safe default` path on the new block.
- The v1.5 QA harness ([DWEA-41](/DWEA/issues/DWEA-41) §6) attaches to the
  `[brain:world_model]` console-info channel and the optional
  `WorldModelLogSink`. It can land independently — no further envelope
  changes required.
- v1.2 Convai ([DWEA-44](/DWEA/issues/DWEA-44)) renders the envelope as
  voice + face + body. The `world_model` block stays renderer-invisible
  there too.

## Disconfirming evidence

- If frontier models reliably refuse the new block (low risk — they
  already populate the existing envelope), drop the fields we cannot keep
  clean and re-bump the schema version. The parser already handles each
  field independently, so dropping one is a 1-file change.
- If the new block adds materially to per-turn output tokens (>20% bump)
  without observable behaviour improvement, re-scope to the 2-3 most
  useful fields (`last_user_intent`, `goal`, and one of `mood_drift` or
  `secrets_to_protect`). Cost data lands in the v1.2 SDK-shape spike.
