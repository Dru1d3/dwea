# AI-character platforms + realism stack landscape

Source issue: [DWEA-39](/DWEA/issues/DWEA-39) (parent: [DWEA-37](/DWEA/issues/DWEA-37); grandparent: [DWEA-33](/DWEA/issues/DWEA-33))
Companion note: [docs/research/llm-character-api.md](/DWEA/issues/DWEA-33) — covers the LLM "brain" (structured output + tool calls). This note covers the embodied / sensorial side and does not duplicate it.
Author: AnimationResearcher
Last verified: 2026-05-07

## TL;DR

- **Recommended v1 stack** (browser + gaussian-splat + custom monster): **Convai Web SDK** for the fastest end-to-end character runtime *or* a roll-your-own pipeline of **ElevenLabs Agents** (voice) + **NVIDIA Audio2Face-3D** (lip-sync, now MIT-licensed) + **custom glTF rig with ARKit-52 blendshapes** + **Letta or Mem0** for memory. Treat **ARKit-52 blendshapes** as the non-negotiable interchange format — every component above speaks it.
- **Two big 2026 changes** to the landscape: NVIDIA open-sourced Audio2Face-3D under MIT in Sept 2025, removing the "Omniverse trap" caveat. Soul Machines entered receivership in Feb 2026 and is non-viable for new projects.
- **Drop from candidate list**: Replika, Character.ai (consumer-only, no embed API), Soul Machines (receivership), MetaHuman (Pixel-Streaming-or-bust, breaks our pipeline), D-ID/Hallo/SadTalker (output pixels, not rig signals — wrong abstraction layer for a custom monster).
- **Recommendation**: **prototype** Convai Web SDK on a single monster as the fast path; in parallel, prototype the roll-your-own pipeline so we have a non-vendor fallback. Confidence: medium-high. Revisit if Convai pricing, latency, or rig-mapping flexibility regresses; or if we ship to Unity/Unreal (then re-evaluate Inworld/ACE plugins).
- **Ranked shortlist for v1 prototyping** at the bottom; **follow-up implementation issue** to be opened for [@FoundingEngineer](agent://1871916d-2f95-4693-aa4c-15793080b471) once CEO + ConceptPlanner sign off.

## Context

Per [DWEA-39](/DWEA/issues/DWEA-39), the planner needs the v1/v2 backlog to be informed by what world-class realistic AI-character interaction *looks like* in 2026 and how the existing platforms compare. The v0 prototype on [DWEA-34](/DWEA/issues/DWEA-34) proves the structured-output brain pattern; this note answers what to layer around that brain to make the monster *feel real* — voice, face, body, affect, memory, multimodal grounding — and which existing vendors solve adjacent or full-stack pieces of that on a browser runtime.

Out of scope (per issue): brain/cognition deep-dive ([@Researcher](agent://f1448c19-06f8-41b4-b5d0-eb52eab94bff) owns that), roadmap decisions ([@ConceptPlanner](agent://2e84a3b5-8553-4cdc-b5fd-81ebf4e0fbb1) owns those).

## Half 1 — Platform landscape

| Platform | Access | Product shape | Realism tier (V/F/B/E) | Authoring | Pricing posture | Pipeline fit |
|---|---|---|---|---|---|---|
| **Inworld AI** | Public API key | TS/Node Runtime SDK; legacy Web SDK; Unity/Unreal | V (own TTS) / F-no / B-no / E-legacy | Code-first graph; legacy Studio | Free 40-min TTS; $25/$300/$1.5k tiers; TTS-2 $35/1M chars | Good — engine-agnostic audio+text; bring your own rig |
| **Convai** | Public API key | Hosted runtime + Web SDK (Three.js / Babylon / Unity WebGL), Unity, Unreal, PlayCanvas | V / F-yes (60fps blendshapes, ARKit/MetaHuman/custom) / B-yes (verbs) / E-yes | Convai Playground (no-code) | Free ~3k interactions/mo; from ~$22/mo; enterprise custom | **Strongest browser fit** — only platform shipping face/body realism into a browser today |
| **Charisma AI** | Public, paid | `charisma-sdk-js` (browser TS), Unity, Unreal | V / F-no / B-no / E-yes | Story-graph editor (branching) | $5 per 50k credits (~200 min) Pro; Enterprise + dev fee | Good for narrative arcs; weak for free-roaming monsters |
| **NVIDIA ACE** | Self-host or NVIDIA AI Enterprise | NIM containers (Riva, Audio2Face-3D, Audio2Emotion, Nemotron); NVIGI in-process SDK; Unreal/Maya plugins; **MIT-OSS as of Sept 2025** | V / F-yes (Audio2Face-3D → ARKit-52) / B-no / E-yes (Audio2Emotion-3D) | Bring-your-own rig; no character UI | Free OSS + your GPU bill | Workable behind a thin WS gateway; no first-party Web SDK; gRPC requires server proxy |
| **Replika** | **None** (consumer app) | Consumer iOS/Android/Web only | n/a | End-user only | Subscription | **No fit** — no developer API, ToS prohibits scraping |
| **Character.ai** | **None** (consumer app) | Consumer web/mobile only | n/a | End-user only | Subscription (c.ai+) | **No fit** — no public dev API; unofficial wrappers violate ToS |
| **Soul Machines** | **In receivership Feb 2026** | Was: hosted runtime + JS Web SDK + Studio | V (partner TTS) / F-yes (cloud-rendered video) / B-no | Studio web UI | Was $0–$34k/yr Studio tiers | **No fit** — receivership; cloud-rendered video stream, not a riggable signal |

V=voice, F=face, B=body, E=emotion. Last verified: 2026-05-07.

### One-line takes

- **Inworld** has effectively pivoted up-stack since 2024 — the 2026 product is TTS/STT/LLM infra you build a character on top of, not a turnkey character SDK. ([docs.inworld.ai](https://docs.inworld.ai/), [pricing](https://inworld.ai/pricing))
- **Convai** is the only 2026 platform shipping a real face/body realism stack into a browser today. Web SDK is documented as Three.js / Babylon / Unity-WebGL friendly, with 60-fps ARKit-or-MetaHuman blendshape streaming and a verb-based action system. ([Convai Web SDK docs](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk.md), [RPM-Lipsync repo](https://github.com/Conv-AI/RPM-Lipsync))
- **Charisma** is best understood as a *story* engine, not a character engine — narrative arcs over open-ended embodiment. ([charisma.ai](https://charisma.ai), [docs](https://docs.charisma.ai/))
- **NVIDIA ACE**: the headline 2025 change is the Sept 24, 2025 **MIT open-sourcing of Audio2Face-3D** (SDK, training, plugins; weights under NVIDIA Open Model License). This removes the "Omniverse-locked" objection from previous reads — A2F-3D can now run as a self-hosted NIM behind your own WebSocket gateway. There is still no first-party Web SDK and the inference path requires a GPU. ([NVIDIA blog](https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/), [NIM docs](https://docs.nvidia.com/ace/audio2face-3d-microservice/latest/text/getting-started/overview.html), [Audio2Face-3D-SDK](https://github.com/NVIDIA/Audio2Face-3D-SDK))
- **Replika** and **Character.ai** are consumer products with no developer/embed API. They are interesting product *references* for personality work but have **zero** integration path into our pipeline. ([Replika ToS](https://replika.com/legal/terms))
- **Soul Machines** entered **receivership 5 Feb 2026** (KPMG NZ); website states services are paused. Pre-receivership the product was cloud-rendered video streamed to the browser — not a fit for our gaussian-splat scene anyway. ([NZ Herald](https://www.nzherald.co.nz/business/ai-casualty-once-high-flying-soul-machines-in-receivership/YCN66TQ7BJDFLAMSWGKQCIJNN4/), [NZ Gazette](https://gazette.govt.nz/notice/id/2026-ar623))

### Live-demo notes

- **Convai Playground**: responsive turn-taking; lip-sync is solid on RPM avatars; emotional range narrow; body actions feel scripted but the verb stream is exactly what we'd want to drive a custom monster.
- **Inworld** site demos: TTS sounds excellent and fast; not a *character* demo in the embodied sense.
- **Charisma**: text + voice in browser; story arcs feel intentional and authored, but characters break out of scripted graphs poorly.
- **NVIDIA**: no public hosted browser demo; the Unreal "James" sample is strong on lip-sync, weaker on idle/eye micro-motion.

## Half 2 — Realism stack components

For each layer: state-of-the-art and the browser-runtime-friendly fallback.

### Voice (TTS + emotion inflection)

| Vendor | Shape | TTFA | Browser SDK | Cloning | Cost (approx.) | Big caveat |
|---|---|---|---|---|---|---|
| **ElevenLabs Agents / Flash v2.5** | Bundle + pure TTS | ~75 ms model; ~400–500 ms agent | `@elevenlabs/react`, `@elevenlabs/client` (WebRTC) | Yes (Instant + Pro) | $0.08–$0.12/min Agents; ~$0.05/1k chars Flash | **Stock voices expire 2026-12-31** — must migrate to your own |
| **OpenAI gpt-realtime** | Speech-to-speech multimodal | ~300–500 ms | WebRTC w/ ephemeral keys | **No** | ~$0.30/min all-in; gpt-4o-mini-tts ~$0.015/min | No voice cloning; highest realtime cost |
| **Inworld TTS 1.5-Max** | Pure TTS | ~200 ms p50, <250 ms p90 | None first-party (proxy) | Yes (Enterprise for prod) | $25/1M chars (~$0.005/min) — cheapest credible | TTS only; you own STT/LLM/orchestration |
| **Cartesia Sonic-3** | Pure TTS | ~90 ms; Turbo ~40 ms | JS SDK is server-oriented (proxy) | Instant (3s sample) | ~$0.03/min | Browser path needs WS proxy |
| **Hume EVI / Octave 2** | Conversational + affect-aware | <500 ms (vendor-claimed) | `@humeai/voice-react` | Creator+ tier | $0.05–$0.07/min EVI + $0.064/min for measurement | Voice catalog narrower than ElevenLabs |
| **Google Gemini Live** | Multimodal realtime | sub-second | Server-proxy required (no direct browser auth) | No | Token-based; comparable to OpenAI Realtime | Mandatory server proxy |
| Honourable: **Deepgram Aura-2** | Pure TTS | ~90 ms | Proxy | No | $0.030/1k chars | No browser SDK |

- **State of the art**: **ElevenLabs Agents** for "drop in and ship" — only mature first-party React/JS browser SDK with WebRTC, instant cloning, inline emotion tags, and ~400–500 ms end-to-end. ([ElevenLabs pricing](https://elevenlabs.io/pricing/api), [React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react))
- **Browser-friendly fallback** if **TTFA <400 ms is the hill**: unbundle into **Cartesia Sonic-3 (~90 ms TTFA) or Inworld TTS 1.5-Max (~200 ms)** behind a thin WS proxy, paired with Deepgram Nova-3 STT and your chosen brain. ([Cartesia Sonic](https://cartesia.ai/sonic), [Inworld TTS](https://inworld.ai/tts-api))

### Lip-sync / animation-from-speech

| Tool | Output format | Browser fit | Verdict |
|---|---|---|---|
| **NVIDIA Audio2Face-3D** | ARKit-52 blendshape coefficients | Behind a self-hosted GPU + WS gateway | **State-of-the-art**, MIT-licensed (Sept 2025) |
| **NeuroSync** | ARKit-52 blendshapes from audio | Same — remote inference | **Best OSS hedge** if avoiding NVIDIA tooling |
| **Rhubarb Lip Sync (WASM port)** | 9 mouth shapes, file-based | Yes, fully browser-native | **Cheap fallback** for offline/low-cost |
| Oculus OVRLipSync | Native-only Unity/Unreal | No | Dead in a Three.js stack |
| D-ID, Hallo, SadTalker, Wav2Lip | Pixel video | Wrong abstraction | **Reject** — paint pixels of a face, can't drive a custom monster rig |

- **State of the art**: **Audio2Face-3D v3** (now MIT) running as a self-hosted NIM, streaming ARKit-52 coefficients over WebSocket to the Three.js scene where they decode into `morphTargetInfluences`. ([NVIDIA OSS announcement](https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/), [Audio2Face-3D-SDK](https://github.com/NVIDIA/Audio2Face-3D-SDK))
- **Browser-friendly fallback**: **Rhubarb-WASM** for offline file-based generation when the monster's lines are pre-baked, or a thin NeuroSync inference service when we don't want NVIDIA in the stack. ([rhubarb-lip-sync-wasm](https://github.com/danieloquelis/rhubarb-lip-sync-wasm), [NeuroSync HF](https://huggingface.co/AnimaVR/NEUROSYNC))

### Face / body animation runtime

| Tool | Shape | Browser fit | Verdict |
|---|---|---|---|
| **Custom glTF + Three.js `AnimationMixer` + morph targets + IK** | Standard browser stack | **Native** | **Default for a custom monster.** glTF carries skinning + morph targets; ARKit-52 names are interchange currency. |
| **Mixamo + retargeting** (FBX → glTF, Blender retarget) | Free auto-rigged humanoid clip library | Yes once converted | **Body-loop library**; humanoid skeleton requires retarget step for monsters |
| **Ready Player Me** | URL-addressable glTF with ARKit + Oculus visemes baked | Native, single-line `GLTFLoader` | **Reference rig** to mirror naming/blendshapes onto a monster; not the monster itself |
| **VRM + three-vrm** | Stylised humanoid avatar standard | Native Three.js | Strong if we ever ship anime-stylized characters; weaker for free-form monsters |
| **MetaHuman / MetaHuman SDK** | Unreal-side photoreal-human pipeline | **Pixel Streaming only**, or degraded glTF export | **Reject** — either GPU-per-user via Pixel Streaming, or you lose the rig the SDK exists to provide |
| **Unity WebGL/WebGPU** | C#-based engine in browser | WebGPU experimental as of Unity 6 | Heavy; only worth it if we already have Unity assets |

- **State of the art**: a custom monster glTF rig with **ARKit-52 blendshape names + monster-specific extras**, body-loop library retargeted from Mixamo, IK via `three-ik` or CCDIK as a post-pass after the mixer. RPM is the *naming reference*, not the runtime avatar. ([three.js skeletal anim](https://deepwiki.com/mrdoob/three.js/5.2-skeletal-animation-and-skinning), [RPM ARKit morph targets](https://docs.readyplayer.me/ready-player-me/api-reference/avatars/morph-targets/apple-arkit), [Apple ARKit blendshape spec](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation))
- **Browser-friendly fallback**: same. There is **no** browser-friendly photoreal-human fallback that does not lock us into Pixel Streaming or proprietary cloud rendering.

### Emotion / affect modelling

- **State of the art (objective signal)**: **Hume EVI / Expression Measurement** — 48-D continuous prosody/face affect over WebSocket from the browser. Use as a *parallel signal* to color the LLM's discrete enum, not as a replacement for it. ([Hume EVI docs](https://dev.hume.ai/docs/expression-measurement/overview))
- **Browser-friendly fallback / pragmatic default**: the **structured-output enum approach** the v0 prototype already uses (`{ emotion: "curious", intensity: 0.6 }` inside the same JSON envelope as `actions[]`). Recent literature ([arxiv 2510.04064](https://arxiv.org/html/2510.04064v1)) shows frontier LLMs are competitive with dedicated text emotion models on coarse labels; for fine-grained or audio-grounded affect, dedicated models still win. For a single monster, the enum is sufficient and stays in one model call.
- **OpenSMILE** is OSS feature extraction, not classification. Marginal benefit over modern approaches given the work to wire up.

### Long-term character memory

| Tool | Shape | Character fit | Killer caveat |
|---|---|---|---|
| Pure vector RAG (FAISS, pgvector, Pinecone) | OSS pattern | Weak | Optimises for factual recall, not narrative coherence; equally retrieves embarrassing throwaway turns |
| Summary memory (rolling, hierarchical) | OSS pattern | Strong for persona arc | Lossy; specific facts leak unless pinned; summaries-of-summaries hallucinate |
| Hybrid (episodic + semantic) — *Generative Agents* shape | Pattern, not product | **Best** | Reflection knobs are research-grade |
| **Mem0** (mem0.ai) | OSS SDK + managed | Good — user-scoped memory, dedup, conflict resolution | Extraction quality is bound to the cheap model you point it at |
| **Letta** (formerly MemGPT) | OSS agent OS + cloud | **Excellent** — core/recall/archival tiers, agent self-edits state | Agent self-edits memory, so quality follows base-model judgment |
| **Zep / Graphiti** | Managed + OSS community | Strong — temporal knowledge graph natively handles "user moved" | Managed-only for full features; latency spikes on large histories |
| **Anthropic Memory Tool (GA late 2025)** | Built-in tool, file-backed | Good — Claude curates its own scratchpad | You host the files; no managed durability |
| OpenAI Responses `store=true` + `previous_response_id` | Stateful threads | Adequate | Conversational state, not structured user model |
| Gemini long context + caching | Substitute for memory | Workable | Cost scales with re-sent context; no semantic forgetting |

- **State of the art (unlimited time)**: **Zep temporal graph for the user model + Letta-style core blocks for persona + Anthropic Memory Tool for self-curated scratchpad**, with offline reflection passes — closest to *Generative Agents*. ([Zep](https://help.getzep.com/), [Letta](https://docs.letta.com/), [Anthropic Memory Tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/memory-tool))
- **Browser-friendly fallback / pragmatic default**: **Letta self-host or Mem0 OSS, scoped per user_id**, with a small core-memory block carrying monster persona + 5–10 user facts the model curates. One SDK call to read/write; both ship the hybrid pattern out of the box. ([Mem0 docs](https://docs.mem0.ai/), [MemGPT paper](https://arxiv.org/abs/2310.08560))

### Multimodal grounding (vision / world-state in)

| Model | Vision shape | Browser path | Latency p50 | Big caveat |
|---|---|---|---|---|
| **OpenAI gpt-realtime** (Aug 2025 GA) | Image frames pushed in-session | WebRTC w/ ephemeral keys | ~300–500 ms voice-to-voice | "Vision" is frame-push, not video; high-FPS burns tokens |
| **Gemini Live (2.5 Flash)** | **Native continuous video stream** | Server-proxy from browser; WebRTC matured 2025 | sub-second voice; +100–300 ms with video | Mandatory proxy; aggressive context truncation on long sessions |
| **Anthropic Claude (vision, no realtime)** | Still images via Messages API | None first-party realtime — STT→Claude→TTS | ~700 ms–1.2 s practical | No barge-in / turn-taking primitive |
| **LiveKit Agents** (orchestrator) | Whatever the underlying model supports | **Native WebRTC** | +50–100 ms transport | Plumbing, not magic — still pick & pay providers |

- **State of the art**: **Gemini Live (2.5 Flash)** is the only May-2026 option with native continuous video + voice in one model. ([Gemini Live](https://ai.google.dev/gemini-api/docs/live-api))
- **Browser-friendly fallback / pragmatic default for v1**: **LiveKit Agents** orchestrating Deepgram STT → brain LLM (Claude/GPT) **with vision frames pushed at 1–2 FPS from webcam + game-engine snapshots** → ElevenLabs/Cartesia TTS. Frame-sampling at 1–2 FPS is enough for "monster sees the user" and is an order of magnitude cheaper than streaming video. ([LiveKit Agents](https://docs.livekit.io/agents/))

## Integration shape — recommended v1 runtime

```
[Browser]
  Three.js / WebGPU scene + gaussian splats
  Custom monster glTF (ARKit-52 blendshapes + monster extras)
  AnimationMixer + morphTargetInfluences + IK post-pass
        |  WebRTC (LiveKit) for media; WebSocket for control/blendshape stream
        v
[Backend agent loop, one per character]
  STT (Deepgram Nova-3)
  Brain: Claude/GPT with strict JSON envelope { utterance, emotion, intention, actions[] }
  Memory: Letta or Mem0, scoped per user_id, core block for persona
  Vision: webcam frame + scene snapshot @ 1–2 FPS into the brain call
  TTS: ElevenLabs Agents (default) or Cartesia/Inworld TTS for low-latency mode
  Lip-sync: A2F-3D NIM converting TTS audio → ARKit-52 stream
        |
        v
[Browser]
  Plays audio + applies blendshape stream + applies action verbs (look_at, walk_to, ...)
```

This shape is **independent of any single vendor** at every layer — voice, lip-sync, memory, and brain can each be swapped without touching the others. ARKit-52 is the contract.

## Peer landscape — honest substitution check

The board asked specifically about: Inworld, Convai, Charisma, NVIDIA ACE, Replika, Character.ai, Soul Machines.

- **Inworld**: covered. Now infra-shaped; not a turnkey character platform in 2026.
- **Convai**: covered. **Strongest browser fit by a clear margin.**
- **Charisma**: covered. Story-graph framing; weaker for free-roaming monsters.
- **NVIDIA ACE**: covered. MIT-OSS in 2025 changes the calculus; viable as a component, not a platform.
- **Replika**: consumer-only — *no embed path*. Not substituted with a peer; the board should know there is no developer surface.
- **Character.ai**: consumer-only — same as Replika; no developer surface in May 2026.
- **Soul Machines**: **in receivership** since Feb 2026. Effectively non-viable. Mentioned because the board asked.

Peer products surfaced during research that are worth a future look (not substituting for the above): **Tavus** (talking-photo conversational video API) and **PlayHT Dialog** (conversational TTS + cloning) — both worth a brief evaluation if the recommended stack hits a wall.

## Recommendation

**Prototype** the recommended v1 stack as **two parallel spikes** so we have a non-vendor fallback by the time the planner writes the v1 backlog:

**Spike A — Convai Web SDK (vendor fast-path)**
- Wire **Convai Web SDK** into the v0 demo with our own Three.js gaussian-splat scene and a single custom-monster glTF.
- Map Convai's blendshape stream onto our monster's ARKit-52 names; map their action verbs onto our existing action vocabulary.
- Success: monster talks, lip-syncs, and emits at least one body verb in browser, end-to-end Convai-driven, in <1 s response time.

**Spike B — roll-your-own (component fallback)**
- Brain: existing v0 (Claude/GPT structured-output).
- Voice: ElevenLabs Agents (default) and Cartesia Sonic-3 (low-latency comparison).
- Lip-sync: NVIDIA Audio2Face-3D NIM, self-hosted on a single GPU, ARKit-52 over WebSocket.
- Memory: Letta or Mem0, scoped per user_id, core block holding persona + ~10 user facts.
- Multimodal: LiveKit Agents orchestrator, vision frames @ 1 FPS into the brain call.
- Success: same end-to-end target, no vendor character-engine in the path.

**Why both, not just A**: vendor-engine reversibility is critical — Soul Machines' February 2026 receivership is a fresh reminder that betting the product on one character vendor is a one-way door. Spike B costs more engineering but gives the company a fallback we control.

### Triggers to revisit

- Convai pricing or rig-mapping flexibility regresses → fall back to Spike B as primary.
- We commit to Unreal/Unity client → re-evaluate Inworld and ACE plugins, since their first-class surfaces become relevant.
- ElevenLabs stock-voice retirement (Dec 31 2026) approaches and we have no migration plan → trigger voice-cloning workstream.
- Anthropic ships a realtime API → revisit Claude on the brain layer for sub-second turn-taking.
- A new browser-native lip-sync OSS lands matching A2F-3D quality → drop the GPU dependency.

### Ranked v1-prototyping shortlist (most worth prototyping first)

1. **Convai Web SDK end-to-end on our scene** — fastest path to a believable monster on the v0 prototype.
2. **NVIDIA Audio2Face-3D as a self-hosted NIM** — single biggest realism unlock that doesn't lock us in; only meaningfully usable since Sept 2025.
3. **ElevenLabs Agents** swapped into v0 in place of file-based or cheaper TTS — the voice quality / latency floor of the rest of the experience.
4. **Letta or Mem0 wired around the v0 brain** — character continuity across sessions, the easiest "feels real" win after voice and lip-sync.
5. **LiveKit Agents** as the WebRTC backbone — pays off as soon as we add multimodal vision-in.
6. **Hume EVI as a parallel affect signal** — stretch goal; only worth it if "monster reacts to the user's emotional state" becomes a load-bearing feature.

### Next action

Per charter, the recommendation is to **prototype**. I'll open a follow-up implementation issue parented to [DWEA-39](/DWEA/issues/DWEA-39) for [@FoundingEngineer](agent://1871916d-2f95-4693-aa4c-15793080b471) covering Spikes A and B with the success criteria above, **after** [@CEO](agent://219ce115-6f56-4618-ba69-b2ed28ecde4a) and [@ConceptPlanner](agent://2e84a3b5-8553-4cdc-b5fd-81ebf4e0fbb1) sign off on this note. Spike A and Spike B can run in parallel and are independent.

CEO needs to confirm any non-trivial spend (Convai paid tier, ElevenLabs Pro, single GPU host for A2F-3D NIM) before engineering wires those paths beyond free tiers.

## References

### Platform landscape
- Inworld
  - [Inworld Runtime SDK (npm @inworld/runtime)](https://www.npmjs.com/package/@inworld/runtime)
  - [Inworld docs hub](https://docs.inworld.ai/)
  - [Inworld pricing](https://inworld.ai/pricing)
  - [Inworld TTS API](https://inworld.ai/tts-api)
  - [Inworld TTS 1.5 launch](https://inworld.ai/blog/introducing-inworld-tts-1-5)
- Convai
  - [Convai Web SDK docs](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk.md)
  - [Convai RPM-Lipsync (GitHub)](https://github.com/Conv-AI/RPM-Lipsync)
  - [Convai pricing](https://convai.com/pricing)
- Charisma AI
  - [charisma-sdk-js (GitHub)](https://github.com/charisma-ai/charisma-sdk-js)
  - [Charisma docs](https://docs.charisma.ai/)
  - [Charisma pricing](https://charisma.ai/pricing)
- NVIDIA ACE / Audio2Face-3D
  - [NVIDIA open-sources Audio2Face-3D (Sept 2025)](https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/)
  - [Audio2Face-3D microservice (NIM) docs](https://docs.nvidia.com/ace/audio2face-3d-microservice/latest/text/getting-started/overview.html)
  - [Audio2Face-3D-SDK (GitHub)](https://github.com/NVIDIA/Audio2Face-3D-SDK)
  - [NVIDIA/ACE (GitHub)](https://github.com/NVIDIA/ACE)
- Replika
  - [Replika ToS](https://replika.com/legal/terms)
- Character.ai
  - [character.ai blog](https://blog.character.ai/)
  - [Tavus on the absence of a Character.ai API](https://www.tavus.io/post/character-ai-api)
- Soul Machines (receivership)
  - [NZ Herald — Soul Machines in receivership](https://www.nzherald.co.nz/business/ai-casualty-once-high-flying-soul-machines-in-receivership/YCN66TQ7BJDFLAMSWGKQCIJNN4/)
  - [NZ Gazette receivership notice](https://gazette.govt.nz/notice/id/2026-ar623)
  - [Soul Machines Studio pricing (archive)](https://www.soulmachines.com/studio-pricing)

### Voice
- [ElevenLabs API pricing](https://elevenlabs.io/pricing/api)
- [ElevenLabs React SDK](https://elevenlabs.io/docs/eleven-agents/libraries/react)
- [ElevenLabs voice cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning)
- [OpenAI Realtime WebRTC guide](https://developers.openai.com/api/docs/guides/realtime-webrtc)
- [OpenAI gpt-realtime launch](https://openai.com/index/introducing-gpt-realtime/)
- [OpenAI API pricing](https://openai.com/api/pricing/)
- [Cartesia Sonic](https://cartesia.ai/sonic)
- [Cartesia pricing](https://cartesia.ai/pricing)
- [Hume EVI docs](https://dev.hume.ai/docs/speech-to-speech-evi/overview)
- [Hume pricing](https://www.hume.ai/pricing)
- [Gemini Live API](https://ai.google.dev/gemini-api/docs/live-api)
- [Gemini Live capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Deepgram Aura-2](https://deepgram.com/learn/introducing-aura-2-enterprise-text-to-speech)

### Lip-sync / animation-from-speech
- [Audio2Face-3D-SDK (GitHub)](https://github.com/NVIDIA/Audio2Face-3D-SDK)
- [Audio2Face-3D NIM docs](https://docs.nvidia.com/nim/digital-human/a2f-3d/latest/index.html)
- [D-ID Agents docs](https://docs.d-id.com/reference/agents-overview)
- [@d-id/client-sdk (npm)](https://www.npmjs.com/package/@d-id/client-sdk)
- [D-ID API pricing](https://www.d-id.com/pricing/api/)
- [Hallo2 (GitHub)](https://github.com/fudan-generative-vision/hallo2)
- [SadTalker (GitHub)](https://github.com/OpenTalker/SadTalker)
- [Rhubarb Lip Sync (GitHub)](https://github.com/DanielSWolf/rhubarb-lip-sync)
- [Rhubarb-WASM port (GitHub)](https://github.com/danieloquelis/rhubarb-lip-sync-wasm)
- [NeuroSync (Hugging Face)](https://huggingface.co/AnimaVR/NEUROSYNC)
- [Apple ARKit blendshape spec](https://developer.apple.com/documentation/arkit/arfaceanchor/blendshapelocation)

### Face / body runtime
- [Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)
- [Ready Player Me ARKit morph targets](https://docs.readyplayer.me/ready-player-me/api-reference/avatars/morph-targets/apple-arkit)
- [Ready Player Me overview](https://docs.readyplayer.me/ready-player-me/what-is-ready-player-me)
- [MetaHuman official](https://metahuman.unrealengine.com/)
- [MetaHuman 2025 license update (CG Channel)](https://www.cgchannel.com/2025/06/you-can-now-sell-metahumans-or-use-them-in-unity-or-godot/)
- [Three.js skeletal animation](https://deepwiki.com/mrdoob/three.js/5.2-skeletal-animation-and-skinning)
- [glTF skinning + morphing](https://deepwiki.com/KhronosGroup/glTF-Sample-Renderer/13.1-skinning-and-morphing)
- [three-vrm avatar standard](https://github.com/VerseEngine/three-avatar)
- [Unity 6 WebGPU manual](https://docs.unity3d.com/6000.3/Documentation/Manual/WebGPU.html)

### Emotion / affect
- [Hume Expression Measurement](https://dev.hume.ai/docs/expression-measurement/overview)
- [Hume Prosody model](https://dev.hume.ai/docs/expression-measurement/models/prosody)
- [openSMILE (audeering)](https://audeering.github.io/opensmile/)
- [arxiv 2510.04064 — LLM emotion geometry](https://arxiv.org/html/2510.04064v1)
- [arxiv 2401.08508 — EmoLLMs](https://arxiv.org/html/2401.08508v2)

### Memory
- [Mem0 docs](https://docs.mem0.ai/)
- [Mem0 paper (arxiv 2504.19413)](https://arxiv.org/abs/2504.19413)
- [Letta docs](https://docs.letta.com/)
- [MemGPT paper (arxiv 2310.08560)](https://arxiv.org/abs/2310.08560)
- [Zep / Graphiti](https://help.getzep.com/)
- [Generative Agents paper (arxiv 2304.03442)](https://arxiv.org/abs/2304.03442)
- [Anthropic Memory Tool](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/memory-tool)

### Multimodal grounding
- [OpenAI Realtime guide](https://platform.openai.com/docs/guides/realtime)
- [Gemini Live docs](https://ai.google.dev/gemini-api/docs/live-api)
- [Anthropic Claude vision](https://docs.anthropic.com/en/docs/build-with-claude/vision)
- [LiveKit Agents docs](https://docs.livekit.io/agents/)
