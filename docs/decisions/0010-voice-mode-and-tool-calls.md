# ADR 0010 — Voice mode (Whisper) + OpenRouter tool-calling motor

Date: 2026-05-07
Status: Accepted (DWEA-30)
Supersedes / extends: [ADR 0007 — STT via Web Speech API](0007-stt-web-speech-api.md), [ADR 0005 — NPC LLM loop](0005-npc-llm-loop.md)

## Context

DWEA-30 stacks two enhancements on top of DWEA-23 (push-to-talk Web Speech)
and DWEA-18 (5-tool LLM motor):

1. **Speech-to-text upgrade.** Web Speech API has gaps in Firefox and is
   weak on non-English accents. The founder writes German-mixed prompts; we
   want a Whisper-class transcript so the chat doesn't garble names and
   non-English clauses.
2. **Chat-LLM swap that preserves the 5-tool motor.** DWEA-3 already moved
   the conversational layer to OpenRouter free, but on the demo-rig branch
   the LLM only streams text — the motor (tool calls) lived on the
   unmerged `dwea-18-llm-motor` branch wired to Anthropic-direct. We need
   a single branch where the free-tier OpenRouter model both replies AND
   moves the character.

Out of scope here: TTS upgrade (DWEA-19), photoreal avatar (DWEA-27),
server-side voice gateway, always-on / wake-word voice.

## Decision

### STT — Groq Whisper-large-v3-turbo, behind a feature flag

- Chosen vendor: **Groq Cloud**, model `whisper-large-v3-turbo`.
  - Free tier; ~real-time on short utterances.
  - Strong multilingual coverage incl. German and code-switched input.
  - Browser → API direct (multipart `POST /openai/v1/audio/transcriptions`),
    matches the existing "key in `.env`" envelope from DWEA-30.
- Rejected alternatives:
  - **OpenAI Whisper API.** Paid; slower than Groq; worth keeping as a paid
    fallback if we ever lose Groq access.
  - **transformers.js / whisper-web (in-browser).** Adds ~70+ MB to the
    bundle and produces worse latency and quality than Groq on consumer
    hardware. Reconsider if we lose all hosted free tiers.
  - **OpenRouter.** Does not serve Whisper; text models only.
- Feature flag: `VITE_STT_PROVIDER` (`groq` | `web-speech`) plus
  `VITE_GROQ_API_KEY` and an optional `VITE_STT_LANGUAGE` hint. Auto-resolves
  to Groq when the key is present, Web Speech otherwise. The Web Speech path
  is preserved verbatim so we can fall back at deploy time without a code
  change. See `src/ui/sttProvider.ts`.

### LLM motor — OpenRouter free with OpenAI-style tool calls

- Default model stays `openai/gpt-oss-120b:free` (already in
  `personality.NPC_MODEL` from DWEA-3). Override at build time with
  `VITE_OPENROUTER_MODEL`.
- Free-tier tool-calling sanity. The OpenAI tool-calls protocol is supported
  on OpenRouter free models that emit OpenAI-compatible deltas
  (`delta.tool_calls[].function.{name,arguments}`). `gpt-oss-120b:free`
  passes our 5-tool schema in spot tests; if it ever flakes, candidate
  drop-ins are documented in `.env.example`:
  - `meta-llama/llama-3.3-70b-instruct:free`
  - `deepseek/deepseek-chat-v3:free`
  - `qwen/qwen-2.5-72b-instruct:free`
- Implementation: `src/llm/motor.ts` streams the SSE response and dispatches
  parsed tool calls into `CharacterIntentSurface` (the live, R3F-bound intent
  surface from `src/character/intent.ts`). The 5-tool schema lives in
  `src/llm/tools.ts` as an OpenAI-style array — tool names + arg shapes
  match the original DWEA-18 schema so future swaps are one-file edits.
- Action queue (FIFO + interrupt + per-resource locks from DWEA-18) is
  **not** ported in this slice. v1 dispatches calls in emit order and lets
  the renderer decide what to do; the queue is a clean follow-up. The
  founder demo only requires "the model can move Mara", not strict ordering
  semantics.

### Architecture deltas

- New: `src/llm/motor.ts`, `src/llm/tools.ts`,
  `src/ui/sttGroq.ts`, `src/ui/sttProvider.ts`.
- Removed: `src/llm/openrouter.ts` (text-only client; superseded by `motor.ts`).
- Updated: `src/ui/useChat.ts`, `src/ui/useMicCapture.ts`, `src/App.tsx`.

## Consequences

### Costs (per chat turn)

- **OpenRouter `:free` chat.** $0.00 per turn under current quotas. Free
  models are rate-limited but not metered. If we hit the free cap or
  reliability tanks, the documented paid fall-back is
  `meta-llama/llama-3.3-70b-instruct` ≈ $0.20–0.30 per million tokens
  (≈ $0.0001 per typical Mara turn at ~500 tokens). Budget impact:
  negligible for the founder demo; revisit for public traffic.
- **Groq Whisper.** $0.00 per request on the free tier. Daily request limits
  apply; our push-to-talk usage will not exceed them in dev.

Net per-turn cost on the free path: **$0.00**.

### What gets better

- Founder can hold to talk (incl. German) and see a Whisper-grade transcript.
- The LLM can move Mara mid-stream — `move_to`, `look_at`, `point_at`,
  `play_animation`, `speak` — instead of only producing chat text.
- Existing Web Speech path is preserved as a one-flag fallback.

### What we accept (revisit if it bites)

- Browser-direct keys for both Groq and OpenRouter. The DWEA-30 brief
  explicitly accepts this. A server-side voice/chat gateway is the
  follow-up when we shipwide.
- No FIFO action queue / abort semantics in v1 — multiple tool calls are
  dispatched in order but not strictly serialised behind running ones.
- Web Speech fallback intentionally lives in code so we don't double the
  build's bundle on a quick stage rollback.

### Verification on this branch

- `pnpm test` covers the new STT controller, the provider resolver, and the
  motor's SSE / tool-call parser (`src/ui/sttGroq.test.ts`,
  `src/ui/sttProvider.test.ts`, `src/llm/motor.test.ts`).
- `pnpm typecheck`, `pnpm lint`, `pnpm build` green.
- End-to-end browser verification (mic permission → Whisper transcript →
  Mara replies + moves) requires a real Groq + OpenRouter key and is
  recorded in the DWEA-30 issue thread when the founder runs the preview.
