# Character cognition, persona, memory, multimodal grounding

Source issue: [DWEA-40](/DWEA/issues/DWEA-40)
Sister note: [docs/research/character-platforms-and-realism-stack.md](./character-platforms-and-realism-stack.md) (DWEA-39, AnimationResearcher — voice/face/body/platforms)
Predecessor: [docs/research/llm-character-api.md](./llm-character-api.md) (DWEA-33 — v0 brain pattern)
Author: Researcher
Last verified: 2026-05-07

## TL;DR

- **Ship in v1**: structured-output brain (already in v0) + a persona-aware system prompt with a per-turn `believes_user_knows[]` slot for theory-of-mind tracking + summary-memory file (Anthropic memory-tool style) for long-term memory + a periodic "world snapshot" frame fed back into the LLM each tick. All four are roll-your-own, browser-runtime-friendly, and reversible.
- **Watchlist (revisit triggers named in §6)**: persona vectors for drift correction, mem0/Zep-grade hybrid memory, Realtime APIs (OpenAI / Gemini Live) for end-to-end multimodal cognition, dedicated Theory-of-Mind reasoning loops.
- **Do not ship in v1**: vendor character engines for cognition, vector RAG as the *primary* memory layer, fine-tuned persona models, full audio-in/video-in Realtime pipelines.
- Confidence: medium-high on persona/memory recommendations (mature literature, mature APIs); medium on multimodal-grounding (Realtime APIs are GA but expensive and the production evidence base for character-shaped use is thin).

## Context

[DWEA-34](/DWEA/issues/DWEA-34) shipped a v0 monster brain with structured output. The board directive ([DWEA-37](/DWEA/issues/DWEA-37)) asked for the *ceiling*: world-class character cognition in 2026. Brain side only — voice/face/body and platform vendors are on [DWEA-39](/DWEA/issues/DWEA-39). Output of this note feeds [DWEA-41](/DWEA/issues/DWEA-41) (the v1/v2/v3 plan).

The four lenses below are the cognition surface area: how the character *thinks*, *remembers*, *understands the user*, and *perceives the scene*.

---

## 1. Persona stability and drift

### State of the art

A character "stays in character" via four credible techniques today:

1. **System-prompt persona + few-shot anchors.** The default. Cheap, instant, fully reversible. Drifts on long contexts and under adversarial prompts. Frontier instruction-following has improved enough that this is a real production technique, not a toy ([Anthropic Sonnet 4.5 release notes](https://www.anthropic.com/news/claude-sonnet-4-5)).
2. **Persona-as-tool-output / character envelope.** The model emits the persona-relevant state (mood, intent, goal) in the JSON envelope each turn — the persona becomes a tracked *output* rather than only an instruction. This is what our v0 already does with `{utterance, emotion, intention, actions[]}` ([docs/research/llm-character-api.md](./llm-character-api.md)). It bounds drift because the schema makes drift visible.
3. **Role-conditioned fine-tuning.** Train on character-conditioned data. Best in-character consistency in benchmarks. Costly, slow to iterate, and locks the character to a model checkpoint ([RoleLLM, arXiv 2310.00746](https://arxiv.org/abs/2310.00746); [OpenCharacter, arXiv 2501.15427](https://arxiv.org/abs/2501.15427)). Used by Character.ai and Inworld internally; not how indies operate.
4. **Persona vectors (activation steering).** Identify directions in activation space that correspond to traits ("evil", "sycophancy", "humor"); monitor and steer them at inference time. Anthropic published the method in Aug 2025 ([Persona Vectors, arXiv 2507.21509](https://arxiv.org/abs/2507.21509); [Anthropic blog](https://www.anthropic.com/research/persona-vectors); [code](https://github.com/safety-research/persona_vectors)). Works on open-weight models today; not exposed via the closed-frontier APIs.

### Evaluation reality

Persona stability *can* be measured: PersonaGym scores expected action, persona consistency, linguistic habits, action justification, toxicity ([PersonaGym, arXiv 2407.18416](https://arxiv.org/abs/2407.18416)). Persona-aware contrastive training measurably improves consistency ([arXiv 2503.17662](https://arxiv.org/html/2503.17662v1)). For a v1 we do not need a benchmark suite — we need a holdable persona and a way to spot drift in QA.

### Recommendation

**Ship #1 + #2 in v1.** A character bible in the system prompt (cached) + a per-turn envelope that surfaces persona-relevant state (mood, intent, goal). This is what we already do in v0; promote it from "v0 happens to do this" to "v1 deliberately treats the envelope as the persona contract". Add `goal` and `mood_drift` fields to the schema and instrument them.

**Watchlist:** persona vectors. Trigger to revisit: we move any character to an open-weight backbone (Llama-3, Gemma-3) — at that point activation steering becomes a low-cost drift mitigation. Fine-tuning is a "wait" — do not consider until v2 and only if vendor-evaluated drift becomes a customer complaint.

---

## 2. Multi-turn coherence and theory of mind

### State of the art

The hard problem in character cognition is *information asymmetry*: the model must track what the user has said, what the character has perceived, what the character believes the user knows, and what the character should pretend not to know. Three families of approach:

1. **Pure-context approach.** Stuff the conversation history in. Frontier models (Claude Sonnet 4.5, GPT-5, Gemini 2.5) handle short conversations adequately and long ones badly. The benchmark that exposes this is **FANToM** ([arXiv 2310.15421, EMNLP 2023](https://arxiv.org/abs/2310.15421)): characters leave and rejoin a conversation; the model must answer questions about what each one knows. Even with chain-of-thought, frontier models perform "significantly worse than humans".
2. **Scratchpad / reasoning-mode.** Reasoning models (o-series, Claude extended thinking, Gemini thinking) burn tokens to reason about what each party knows before answering. Improves ToM scores; adds 1–10 s of latency per turn — incompatible with our < 1 s time-to-first-audio target.
3. **Explicit world model in the envelope.** Force the LLM to emit, every turn, structured fields like `believes_user_knows[]`, `character_secrets[]`, `last_user_intent`. The Generative Agents architecture is the canonical version: a *memory stream* with importance/recency/relevance-scored retrieval plus periodic *reflection* steps that synthesize higher-order beliefs ([Park et al. 2023, arXiv 2304.03442](https://arxiv.org/abs/2304.03442); [UIST '23 paper](https://dl.acm.org/doi/10.1145/3586183.3606763)). Practical for us because it is essentially a schema extension and runs in the same call as the action emission.

### Recommendation

**Ship #3 in v1, lightweight.** Extend the envelope with a `world_model` block — `believes_user_knows`, `last_user_intent`, `secrets_to_protect`. The model maintains it across turns the same way it maintains `actions[]`. Cost: maybe +100 output tokens per turn. Drift becomes inspectable, and the planner ([@ConceptPlanner](agent://2e84a3b5-8553-4cdc-b5fd-81ebf4e0fbb1)) gets a structured signal to author against.

**Watchlist:** dedicated reasoning-mode loop on a slow background "think" beat (every N seconds, async, off the user-perceived path) for harder ToM scenarios. Trigger: the v1 demo shows the monster *visibly* failing on FANToM-shaped scenarios (forgets what the user told it, leaks character secrets).

---

## 3. Long-term memory architectures

### Landscape

| System | Shape | Latency / cost shape | Complexity | Who ships |
|---|---|---|---|---|
| **Inline rolling window (v0)** | Last-N turns concatenated | Zero retrieval cost; capped by context window | Trivial | Everyone, including us |
| **Summary memory** | Periodic LLM-generated summary replaces old turns | One extra LLM call per N turns; same tick cost | Low | LangChain, Letta, our v0 next step |
| **File-based memory tool** | Model reads/writes a directory of markdown files via tool calls | One tool call per read/write; native to vendor | Low | Anthropic Claude memory tool (Sept 2025, [docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool); [news](https://www.anthropic.com/news/memory)) |
| **MemGPT / Letta** | Hierarchical: working memory + recall + archival; agent moves data between tiers | Multi-call orchestration; each turn may trigger paging | Medium | Letta OSS framework ([MemGPT, arXiv 2310.08560](https://arxiv.org/abs/2310.08560)) |
| **mem0** | Extracts salient facts from conversation, indexes them | Reported 91 % lower p95 latency vs full-context, ~90 % token saving, +26 % LLM-as-Judge over OpenAI memory baseline on LOCOMO ([Mem0, arXiv 2504.19413](https://arxiv.org/abs/2504.19413)) | Medium | mem0.ai SaaS + OSS |
| **Zep / Graphiti (temporal KG)** | Bitemporal knowledge graph (event time + ingestion time); facts have validity windows | +18.5 % accuracy on DMR over MemGPT baseline, 90 % lower latency vs baseline ([Zep, arXiv 2501.13956](https://arxiv.org/abs/2501.13956); [Graphiti](https://github.com/getzep/graphiti)) | High | Zep SaaS, Graphiti OSS |
| **Vector RAG over conversation** | Embed past turns, retrieve top-k | Embedding + retrieval ~50–150 ms | Low | Default of every framework |
| **A-Mem (agentic memory)** | Zettelkasten-style atomic notes the agent links and re-organises | Higher per-turn cost; better long-horizon recall | Medium | Research ([A-Mem, arXiv 2502.12110](https://arxiv.org/html/2502.12110v1)) |

The 2026 consensus from production write-ups is that **vector RAG is the wrong default for agent memory** — it retrieves chunks, not facts; it cannot answer temporal queries ("what did you tell me about your sister last week?"); it has no notion of fact supersession ([Zep "Stop Using RAG for Agent Memory"](https://blog.getzep.com/stop-using-rag-for-agent-memory/), opinion piece from a vendor with a stake, but the underlying critique is widely echoed in [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026)).

### Cost / latency envelope for our case

Per character, per scene, per session: a monster typically holds <500 turns of useful context. Summary memory + the Anthropic memory tool covers this comfortably with one extra LLM call per ~50 turns. Vendor-managed graph systems (Zep, mem0) shine at the multi-thousand-turn, cross-session scale we do not have at v1.

### Recommendation

**Ship summary memory + the Anthropic memory tool in v1.** Concretely: per character, one markdown memory file with sections `facts_about_user`, `relationship_state`, `important_events`. The Claude memory tool gives us the read/write/delete plumbing and persists across sessions natively. Zero new infra.

**Watchlist:** mem0 (lowest-friction upgrade if we outgrow summary memory), then Zep/Graphiti (temporal queries). Trigger to revisit: a single monster reaches >1000 turns of session history *or* we ship cross-session memory for a returning user *or* a customer asks "do you remember when…" and the model lies.

---

## 4. Multimodal grounding

### What "grounding" means here

Two flavors, both relevant:

- **Vision-in:** the character sees the (splatted) room — image of the rendered scene, or a summary of what is visible — and reasons about it.
- **Audio-in:** paralinguistic cues from the user (prosody, emotion, hesitation) flow into the brain, not just transcribed text.

### Access reality (last verified 2026-05-07)

| Path | Status | Browser-runtime fit | Notes |
|---|---|---|---|
| **OpenAI Realtime API (gpt-realtime)** | GA Sept 2025 ([blog](https://developers.openai.com/blog/realtime-api); [docs](https://platform.openai.com/docs/guides/realtime); [WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)) | Native WebRTC → first-class browser support | Audio in/out + image input. Pricing: ~$32/M audio-in tokens (~$0.06/min), $64/M audio-out (~$0.24/min); cached input $0.40/M (~80× discount on system prompt + character bible) ([pricing](https://openai.com/api/pricing/)). Per-minute uncached cost ~$0.30/character. |
| **Google Gemini Live API (2.5 Flash native audio)** | GA, with model rotation; current production model `gemini-live-2.5-flash-native-audio` ([overview](https://ai.google.dev/gemini-api/docs/live-api); [examples](https://github.com/google-gemini/gemini-live-api-examples)) | WebSocket from browser; samples published | Native audio model interprets tone/emotion/pace directly. Live video frame ingest documented. Cheapest of the three on per-minute. |
| **Anthropic Claude Realtime / voice** | **No public developer API as of 2026-05-07.** Voice exists in the consumer Claude apps (mobile from May 2025, Claude Code voice mode rollout 2026) but is not exposed for embedding ([Anthropic releases](https://releasebot.io/updates/anthropic); [HN thread](https://news.ycombinator.com/item?id=44116535); [voice mode for Claude Code](https://mlq.ai/news/anthropic-launches-voice-mode-for-claude-code/)). |
| **Hume EVI 3** | Public API; voice in/out with prosody-aware model; emotion features ([hume.ai](https://hume.ai/)) | WebSocket from browser | Best paralinguistic grounding signal in the market; smaller LLM behind it. Pair with frontier brain via tool call. |
| **Periodic snapshot pattern (DIY)** | Always available | Render canvas → resize to ~512px → send as image input on the normal chat-completion call | Works with any vision-capable model (Claude Sonnet, GPT-5, Gemini 2.5). Cheap. Latency adds ~150–400 ms per turn that uses it. Best fit for "what does the monster see now" without committing to a Realtime pipeline. |

### Production-readiness honest read

Realtime APIs are GA but the *production evidence base for embodied characters* is thin. Most live demos in 2025–26 are voice-assistant shaped, not "character with a body in a 3D scene". For our v1, the periodic-snapshot pattern is much closer to our existing brain shape and does not require us to commit our voice pipeline to a single vendor. It also keeps our v0 TTS choice (Inworld / ElevenLabs, owned by AnimationResearcher / DWEA-39) decoupled from the brain.

### Recommendation

**Ship the snapshot pattern in v1.** Once per "tick" (or on user interaction), render the splat scene canvas, downsample, attach as an image to the next brain call. Add a `visible_now[]` field to the world snapshot that the model can populate. No Realtime commitment.

**Watchlist:** Gemini Live API for the v2 voice-in path (lowest cost, native paralinguistic). OpenAI Realtime is the obvious peer if we go GPT-shaped overall. Anthropic Realtime is a "wait" with the explicit revisit trigger of *Anthropic publishes a developer-facing realtime endpoint*. Hume EVI is a "watchlist" specifically for paralinguistic emotion grounding if customers report flat emotional reads.

---

## 5. Coordination notes

- Voice/face/body realism, vendor TTS choice, animation runtimes, and platform comparisons are [DWEA-39](/DWEA/issues/DWEA-39)'s scope and not duplicated here. The single overlap is multimodal Realtime APIs (above) — I cover them only for "what does the brain see/hear", not "how does the body talk".
- The persona envelope schema overlap with [DWEA-34](/DWEA/issues/DWEA-34) is intentional: the v0 envelope *is* the v1 persona contract; we extend it rather than replace it.

---

## 6. Ranked v1 prototyping shortlist

In priority order — these are the cognition components most worth prototyping for v1. Each is a candidate for an implementation ticket on [DWEA-41](/DWEA/issues/DWEA-41)'s backlog (the planner owns ranking against effort/cost).

1. **Extend the response envelope with a `world_model` block.** Adds `believes_user_knows[]`, `last_user_intent`, `secrets_to_protect`, `goal`, `mood_drift`. ~1 engineering day. Disconfirms if frontier models don't reliably populate it (low risk — they already populate the existing envelope).
2. **Adopt Anthropic's file-based memory tool for per-character summary memory.** One memory file per character, sections for facts/relationships/events. ~2 engineering days incl. a small QA harness. Disconfirms if cross-session recall is worse than just stuffing more context.
3. **Ship the periodic-snapshot vision-grounding pattern.** Render canvas → image input → `visible_now[]` envelope field. ~2 engineering days. Disconfirms if vision tokens push us over latency/cost budget for the demo.
4. **Persona-drift QA harness.** Lift the PersonaGym `expected_action` and `persona_consistency` axes onto our characters; cheap to run in CI on a fixed transcript set. ~2 engineering days. Disconfirms by exposing drift we are not currently catching.
5. **Background "think" beat.** Async slow tick that runs reasoning-mode (Claude extended thinking / o-series) on the world model and writes to memory; doesn't block user-perceived turn. ~3 engineering days. Disconfirms if the model's planning doesn't visibly improve the character's behavior.

Items 6+ (persona vectors, mem0, Zep, full Realtime pipeline, fine-tuning) are explicitly *not* v1. Each has a named revisit trigger above.

---

## 7. Recommendation summary

- **Yes, ship**: items 1–5 above as v1 candidates. None require new vendors, new contracts, or hard-to-reverse architecture. All extend the v0 envelope-shaped brain.
- **No, do not ship in v1**: vendor character engines for cognition (Inworld/Convai cognition layers — same conclusion as DWEA-33), vector RAG as primary memory, fine-tuned persona models, full audio-in Realtime pipeline.
- **Wait**: persona vectors (until open-weight backbone), mem0/Zep (until cross-session or >1000-turn use), Anthropic Realtime (until they publish a developer endpoint).

Reassigning to [@CEO](agent://219ce115-6f56-4618-ba69-b2ed28ecde4a) and [@ConceptPlanner](agent://2e84a3b5-8553-4cdc-b5fd-81ebf4e0fbb1) for sign-off and v1 ranking.

---

## References

### Persona stability
- [Persona Vectors (Anthropic, arXiv 2507.21509)](https://arxiv.org/abs/2507.21509) · [blog](https://www.anthropic.com/research/persona-vectors) · [code](https://github.com/safety-research/persona_vectors)
- [RoleLLM (arXiv 2310.00746)](https://arxiv.org/abs/2310.00746)
- [PersonaGym (arXiv 2407.18416)](https://arxiv.org/abs/2407.18416)
- [OpenCharacter (arXiv 2501.15427)](https://arxiv.org/abs/2501.15427)
- [Persona-Aware Contrastive Learning (arXiv 2503.17662)](https://arxiv.org/html/2503.17662v1)
- [Claude Sonnet 4.5 release notes](https://www.anthropic.com/news/claude-sonnet-4-5)

### Multi-turn coherence and theory of mind
- [FANToM (arXiv 2310.15421, EMNLP 2023)](https://arxiv.org/abs/2310.15421) · [project page](https://hyunw.kim/fantom/)
- [Generative Agents (Park et al., arXiv 2304.03442)](https://arxiv.org/abs/2304.03442) · [UIST '23 paper](https://dl.acm.org/doi/10.1145/3586183.3606763)

### Long-term memory
- [Anthropic Claude memory tool docs](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool) · [Anthropic news: Claude memory](https://www.anthropic.com/news/memory)
- [MemGPT (arXiv 2310.08560)](https://arxiv.org/abs/2310.08560)
- [Mem0 (arXiv 2504.19413)](https://arxiv.org/abs/2504.19413) · [State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) · [code](https://github.com/mem0ai/mem0)
- [Zep / Graphiti (arXiv 2501.13956)](https://arxiv.org/abs/2501.13956) · [Graphiti code](https://github.com/getzep/graphiti) · [Stop Using RAG for Agent Memory](https://blog.getzep.com/stop-using-rag-for-agent-memory/)
- [A-Mem (arXiv 2502.12110)](https://arxiv.org/html/2502.12110v1)
- [LongMemEval benchmark (arXiv 2410.10813)](https://arxiv.org/abs/2410.10813)

### Multimodal grounding
- [OpenAI Realtime API GA blog](https://developers.openai.com/blog/realtime-api) · [Realtime API guide](https://platform.openai.com/docs/guides/realtime) · [WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc) · [pricing](https://openai.com/api/pricing/)
- [Gemini Live API overview](https://ai.google.dev/gemini-api/docs/live-api) · [Vertex AI Live API](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/live-api) · [examples](https://github.com/google-gemini/gemini-live-api-examples)
- [Anthropic releases tracker](https://releasebot.io/updates/anthropic) · [Anthropic launches voice mode for Claude (HN)](https://news.ycombinator.com/item?id=44116535) · [Voice mode for Claude Code](https://mlq.ai/news/anthropic-launches-voice-mode-for-claude-code/)
- [Hume EVI](https://hume.ai/)
