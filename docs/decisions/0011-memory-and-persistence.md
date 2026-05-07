# 0010 — Per-character memory + persistence layer (v1.3)

Status: Accepted (DWEA-46).
Date: 2026-05-07.
Trace: [v1.3 plan section](/DWEA/issues/DWEA-41#document-plan), [DWEA-40](/DWEA/issues/DWEA-40) §3, [Anthropic memory-tool docs](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/memory-tool).
Supersedes / extends: ADR 0005 (NPC LLM loop), the v1.1 envelope work in DWEA-45 (`secrets_to_protect[]` lands here as encrypted memory).

## Context

The v0 brain ([brain.ts](../../src/llm/brain.ts), DWEA-34) and the v1.1 envelope (DWEA-45) leave the monster session-scoped: Mara forgets the user the moment the tab closes. The v1 product thesis ("the monster remembers what you told it last time") needs a persistent per-character memory file plus a way for the brain to read and write it.

Three constraints frame this decision:

1. **Anthropic memory-tool alignment.** The v1.3 plan calls out the [Anthropic Claude memory tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/memory-tool) as the canonical surface. The brain currently runs on `openai/gpt-oss-120b:free` via OpenRouter (ADR 0005) — switching to Claude end-to-end is a separate, unticketed cost commitment.
2. **No new backend services.** "Stays as flat-file storage scoped to the existing brain-loop runtime" (DWEA-46 disconfirming-evidence section, [v1.3 plan](/DWEA/issues/DWEA-41#document-plan)). FE escalates to CEO before introducing a managed store.
3. **Encryption-at-rest for persona secrets** (`secrets_to_protect[]` from the v1.1 envelope, DWEA-45). A leaked memory file must not let the user (or a debugger) read the secrets the monster is supposed to know but not reveal yet.

## Decision

**Memory tool surface = Anthropic memory tool, served by an in-process MemoryStore.** The `memory_20250818` command vocabulary (`view`, `create`, `str_replace`, `insert`, `delete`, `rename`) is the **canonical contract** the runtime exposes. A future Claude switch is a wiring change, not a memory-layer rewrite.

**Brain integration today (OpenRouter free-tier path).** Two cheap moves stand in for native tool-use:
1. **Snapshot on session start.** [`loadMemorySnapshot`](../../src/llm/memory/snapshot.ts) reads the per-(character, user) memory and `renderMemoryPreamble` turns it into a markdown block we splice into the brain's system prompt. The brain talks "as if it remembered" without burning a tool round-trip.
2. **`memory_writes` envelope field.** The brain emits 0–4 mutations per turn in its strict-JSON envelope (`brain.ts` schema bump). [`applyBrainMutations`](../../src/llm/memory/snapshot.ts) commits them through the same `MemoryStore` the Anthropic path will use.

**Future Claude path (no rewrite needed).** [`memoryToolDefinition()`](../../src/llm/memory/anthropic.ts) returns the SDK shape Claude expects; [`executeMemoryCommand(store, cmd)`](../../src/llm/memory/anthropic.ts) handles each `tool_use` block. Wiring the Anthropic SDK to drive these is a brain-loop swap, not a re-architecture.

**Persistence layer = IndexedDB, namespaced per (customer, character, user).**
- DB: `dwea-memory`, single object store `entries`, `keyPath: 'path'`.
- Path scheme: `/memories/<customer_id>/<character_id>/<user_id>/<file>`. Per-customer isolation at the top so v2 multi-tenant doesn't bleed personas across deployments.
- Anonymous user id minted on first load, persisted in `localStorage` (`dwea.memory.user-id`). Customer id defaults to `_default` for v1.
- Falls back to an in-memory map when IndexedDB is unavailable (private mode, SSR, vitest node env).

**Encryption at rest = AES-GCM 256 via Web Crypto.**
- Files written under `…/secrets/…` are transparently encrypted by the `MemoryStore`.
- Key minted on first encryption, persisted in the same backend at `/memories/_system/encryption-key.v1` (versioned envelope, base64-encoded raw key).
- Cipher envelope on disk: `@@enc:v1:{ "v": 1, "alg": "AES-GCM-256", "iv": <base64 96-bit>, "ct": <base64 ciphertext> }`. Random IV per write — distinct ciphertexts for the same plaintext.
- Cross-secrets-boundary `rename()` re-encrypts/decrypts as it moves.
- Bibles can declare seed `secretsToProtect[]`; [`seedPersonaSecrets`](../../src/llm/memory/snapshot.ts) materialises them encrypted on first contact and mirrors the cleartext index into `secrets/_index.md` so the snapshot can surface them to the brain with explicit "do not reveal" copy.

**Memory file structure (markdown).** The model writes only into the three canonical files plus the secrets store:
- `facts_about_user.md` — name, preferences, things they've shared.
- `relationship_state.md` — running summary of the relationship.
- `important_events.md` — moments to remember.
- `secrets/_index.md` (encrypted) — every persona secret, one per line.
- `secrets/_persona.md` (encrypted) — bible-seeded secrets snapshot.

The `memory_writes` envelope field is narrower than the full Anthropic command set — `{file, op, content, secret}` — because (a) free models reliably emit JSON but unreliably emit tool-call round-trips, and (b) the recall harness only needs append/replace semantics. The full command set ships through the Anthropic-path bridge.

## Threat model

What encryption-at-rest defends:
- **Backup/disk leak.** A memory file copied off the user's machine without the IndexedDB `_system/encryption-key.v1` entry is ciphertext only.
- **Devtools casual-leak.** Inspecting the `entries` table in a browser DB viewer shows opaque `@@enc:v1:` blobs for secret paths.

What it does **not** defend:
- An attacker with active JS on the page reads the key directly. v1 makes this trade because the secrets are flavour-of-the-monster facts, not credentials.
- A same-origin XSS. Same posture.

Escalation paths if the threat model tightens:
1. Move secrets to a server-side vault (introduces a managed store — needs CEO sign-off per DWEA-46).
2. Wrap the data key with a passphrase via Argon2id; require the passphrase per session.
3. Use a non-extractable WebCrypto key bound to a user gesture (FIDO2 / WebAuthn) for the wrap.

## Validation

In-CI gates (every commit):
- `src/llm/memory/store.test.ts` — round-trip, namespace isolation, encrypt-on-write, rename re-encryption, cross-session via shared backend.
- `src/llm/memory/crypto.test.ts` — encrypt/decrypt round-trip, distinct IV-per-write, key persistence.
- `src/llm/memory/snapshot.test.ts` — snapshot loading, preamble rendering, persona-secret seeding, mutation application.
- `src/llm/memory/anthropic.test.ts` — every Anthropic command path, including ambiguous `str_replace` refusal.
- `src/llm/memory/recallHarness.test.ts` — fixed 10-question recall set ≥80% (currently 100% on the stub-driven harness), zero leaks across the set + a hand-curated probe batch, plus a negative control that confirms the leak detector wakes up if the brain rehearses a secret.

Outside-CI smoke (manual):
- Real-LLM session against the OpenRouter free-tier model with `memory_writes` enabled. Prompt the model to remember a name, close the tab, reopen 5 min later, ask "what's my name?" — should answer using the snapshot. Tracked as a follow-up smoke run before v1 demo.
- `chrome://inspect` IndexedDB sniff: open `dwea-memory`, confirm `secrets/…` entries are `@@enc:v1:` blobs and the cleartext substring is absent.

## Out of scope (intentional)

- **Switching the brain to Claude.** This ADR makes that swap a wiring change, but the actual swap (cost, vendor account, prompt re-tune) is a separate ticket.
- **mem0 / Letta / temporal-graph memory.** The [v1/v2/v3 plan](/DWEA/issues/DWEA-41#document-plan) §6 v1.3 disconfirming-evidence section says we revisit only if a single monster crosses 1000 turns or testers report "do you remember when…" failures the snapshot can't repair.
- **A debug HUD for memory inspection.** `useChat` returns the store so a future `MemoryHud` can list entries; not built in v1.
- **Cross-device sync.** IndexedDB is per-browser. Cross-device requires the managed store the v1.3 plan explicitly defers.

## Consequences

- Brain prompt grows by a few hundred tokens on returning-user sessions — the snapshot block plus the `memory_writes` rules. Token budget bump in `personality.ts` already absorbed the world-model addition; the recall set's typical preamble is ~120 tokens.
- We now have one source of truth for memory pathing across the OpenRouter and (future) Claude paths. Bibles that need richer memory shape add fields by extending `BrainMemoryMutation` and the schema together.
- The encryption key lives next to the data. A "clear memory" debug action wipes both — exactly what we want for support cases, and a reminder that this is not credential-grade storage.
