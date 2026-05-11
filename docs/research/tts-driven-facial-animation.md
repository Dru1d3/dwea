---
title: TTS-driven facial animation / lip-sync state of the art for personality-driven monsters
author: AnimationResearcher
issue: DWEA-115
issue-link: /DWEA/issues/DWEA-115
last-verified: 2026-05-11
status: first pass, access-reality + one recommendation
---

# TTS-driven facial animation for DWEA monsters

## 1. TL;DR

**Recommendation: keep Convai's built-in lip-sync as the v1 default, and prototype NVIDIA Audio2Face-3D (A2F-3D) as a server-side upgrade path for the Spike B reserve and any monster that needs stronger emotion/face nuance than Convai's 60 fps blendshape stream provides.** Open-source research models (EmoTalk, FaceDiffuser, DiffSpeaker, AniTalker, SAiD) are *not* production-ready for our pipeline — most do not emit ARKit-52 directly, none ship a browser-grade real-time runtime, and the format-translation work alone would dominate any quality win. VASA-1 and MetaHuman Animator are off the table on pipeline grounds (closed API / Unreal-only). Confidence: medium-high on the v1 default; medium on the A2F-3D prototype call until a small spike confirms server-side latency under our envelope. Revisit when (a) a research model lands with native ARKit-52 output and an under-100 ms browser runtime, or (b) Convai's NeuroSync quality is judged insufficient against monster-by-monster acceptance bars.

## 2. Context

DWEA's v1 frame ([DWEA-41](/DWEA/issues/DWEA-41)) is **Convai Web SDK first, Spike B (A2F-3D + ElevenLabs + Letta + LiveKit) as triggered v1.5 fallback**. Three character tickets — Otto ([DWEA-68](/DWEA/issues/DWEA-68)), Pip ([DWEA-69](/DWEA/issues/DWEA-69)), Mara ([DWEA-66](/DWEA/issues/DWEA-66)) — need a TTS→face answer that isn't "frozen rubber face". SystemsArchitect's observability pass ([DWEA-108](/DWEA/issues/DWEA-108) §2.1) names *viseme drift* as a missing metric, which implies the system must own a viseme pipeline that can be measured. The CEO re-ping ([DWEA-115](/DWEA/issues/DWEA-115)) asked for a current-state read on the TTS→face landscape and a yes/no/wait/prototype recommendation in the Researcher-output shape ([DWEA-110](/DWEA/issues/DWEA-110) template). NVIDIA's Audio2Face-3D MIT-OSS release in September 2025 materially shifted access-reality vs. our last pass and is the main reason to re-look.

The DWEA pipeline shape ([memory project_dwea_pipeline]): browser Three.js + gaussian splats, ARKit-52 as the interchange, **reject Unreal Pixel Streaming, Omniverse, and cloud-rendered video**. Any TTS→face stack that requires Unreal at runtime or a streamed-video output is automatically out.

## 3. Access reality

All access claims here are dated `last verified: 2026-05-11` unless otherwise specified.

### 3.1 Convai Web SDK (current v1 default)

- **Access:** Public npm package `@convai/web-sdk` (TypeScript-first), official docs at `docs.convai.com`. Standard Convai account / API key required. ([npm](https://www.npmjs.com/package/@convai/web-sdk), [docs](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk))
- **Capability:** Browser-side lip-sync streamed at 60 fps. Supports **ARKit (61 elements)** and **MetaHuman (251 elements)** blendshape mappings, plus custom mappings. Outputs morph-target values per frame, apply directly to a Three.js mesh. ([docs](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk))
- **Caveat:** Convai's documentation lists "ARKit (61 elements)" — ARKit's standard is 52. The extra 9 channels are Convai's superset; mappings must be confirmed against our ARKit-52 interchange before treating them as drop-in. Flag this to FE.
- **Model behind it:** Convai's marketing materials refer to "NeuroSync"; specific model docs/latency numbers are not published. ([Convai blog](https://convai.com/blog/lip-syncing-virtual-ai-characters-techniques-integration-and-future-trends), [Agora write-up](https://www.agora.io/en/blog/build-real-time-ai-avatars-with-lip-sync-using-agora-convoai-rpm/))
- **Pricing:** Not exposed on the docs page surveyed; pulled via Convai account tiers. Already on our cost path under [DWEA-41](/DWEA/issues/DWEA-41).

### 3.2 NVIDIA Audio2Face-3D (Spike B candidate)

- **License:** MIT for the SDK; Apache for the training framework. Model weights covered by the NVIDIA Open Model License. Open-sourced September 2025. ([NVIDIA Developer Blog](https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/), [GitHub](https://github.com/NVIDIA/Audio2Face-3D))
- **Access:** Public repos — `NVIDIA/Audio2Face-3D`, `NVIDIA/Audio2Face-3D-SDK` (C++/CUDA), `NVIDIA/Audio2Face-3D-Training-Framework`, `NVIDIA/Audio2Face-3D-Samples`. Pre-trained Audio2Face-3D-v3.0 weights on Hugging Face. Audio2Face-3D-Authoring and NIM microservice variants available for service deployment.
- **Capability:** Audio → facial animation as **direct mesh deformations, joint transformations, or blend-shape weights** (ARKit-52 is reachable as one supported output mapping). Real-time at 30 fps on NIM/optimal hardware; SDK supports >60 fps frame generation. Emotion model is bundled (Audio2Emotion). ([SDK docs](https://github.com/NVIDIA/Audio2Face-3D-SDK), [Performance docs](https://docs.nvidia.com/ace/audio2face-3d-microservice/2.0/text/interacting/performance.html), [arXiv 2508.16401](https://arxiv.org/html/2508.16401v1))
- **Runtime:** Server-side. C++/CUDA library or gRPC microservice (NIM). **No native browser plugin** — web integration is via NIM-over-gRPC, i.e. a hosted service the browser talks to.
- **Hardware cost:** NVIDIA GPU on the server side (CPU fallback exists but is not real-time). Per-stream cost depends on how many we co-tenant on one GPU; this needs a spike to size honestly under our concurrency assumptions.

### 3.3 Microsoft VASA-1 (reference / paper only)

- **Access:** None. Microsoft has stated they will not release VASA-1 as an API, SDK, weights, or product, citing misuse concerns. Limited deployment inside Microsoft Copilot's "Portraits" feature, gated to ≥18 users with on-screen AI indicators. ([Microsoft Research](https://www.microsoft.com/en-us/research/project/vasa-1/), [VentureBeat](https://venturebeat.com/ai/microsoft-shows-off-vasa-1-an-ai-framework-that-makes-human-headshots-talk-sing))
- **Capability vs. fit:** 2D talking-head video synthesis, not 3D blendshape animation. Even if released, it's the wrong output shape for our gaussian-splat-monster pipeline — would force us to cloud-render video, which our pipeline rejects.
- **Verdict:** Reference quality bar, not an option. Revisit only if Microsoft publishes a 3D-blendshape variant *and* opens API access.

### 3.4 MetaHuman Animator audio-to-face (Epic)

- **Access:** Free with Unreal Engine; MetaHuman 5.6 (June 2025) pulled the Creator out of the browser and into the engine; pipeline is **Unreal-Editor-only**. ([Metahuman 5.6 release](https://www.metahuman.com/news/metahuman-leaves-early-access-with-a-feature-packed-new-release), [Audio-driven roadmap card](https://portal.productboard.com/epicgames/1-unreal-engine-public-roadmap/c/1629-audio-driven-animation-for-metahuman-animator))
- **Capability:** Realistic audio-to-face on the MetaHuman rig, multi-language, real-time-capable inside Unreal.
- **Fit:** Out. Our pipeline rejects Unreal Pixel Streaming and Unreal at runtime; baking MetaHuman animation offline and replaying in-browser is a parallel pipeline we explicitly do not want.

### 3.5 Inworld AI

- **Access:** Public Inworld portal + Realtime TTS API. Engine SDKs for Unity / Unreal include lip-sync templates. ([Inworld TTS](https://inworld.ai/tts), [Inworld portal](https://platform.inworld.ai/))
- **Capability:** Realtime TTS with timestamp alignment at word / character / phoneme / **viseme** level — viseme timestamps are the relevant primitive for a face stack. ARKit-52 blendshape support is not directly documented for the Realtime TTS surface; the browser/three.js path is undocumented.
- **Fit:** Useful as a viseme stream source if we ever decouple TTS from face. As a complete TTS→face stack, the browser story is weaker than Convai's.

### 3.6 Open-source research models (EmoTalk, FaceDiffuser, DiffSpeaker, AniTalker, SAiD, SadTalker, MuseTalk, GeneFace++)

- **Access:** Public code/weights on GitHub for most ([EmoTalk](https://github.com/ZiqiaoPeng/EmoTalk), [FaceDiffuser](https://uuembodiedsocialai.github.io/FaceDiffuser/), [DiffSpeaker](https://arxiv.org/html/2402.05712v1), [SAiD](https://arxiv.org/html/2401.08655v2), [SadTalker](https://github.com/OpenTalker/SadTalker)). Mostly research code, PyTorch, GPU-required.
- **Capability:** Each one targets a slightly different output shape:
  - **Mesh-vertex deltas / FLAME parameters:** FaceDiffuser, DiffSpeaker, EmoTalk (output via specific 3D head topologies, not native ARKit-52).
  - **Blendshape:** SAiD trains directly on blendshape; closer to ARKit-52 but still requires mapping confirmation.
  - **2D talking-head video:** SadTalker, MuseTalk, GeneFace++ — wrong output shape for us. ([Lipsync.com roundup](https://lipsync.com/blog/open-source-lip-sync), [Pixazo 2026 roundup](https://www.pixazo.ai/blog/best-open-source-lip-sync-models))
- **Real-time fit:** None of these have a published browser runtime. Most are research-quality scripts. MuseTalk claims 30+ fps on GPU, but for video, not 3D.
- **Fit:** Not production. Possible long-tail research path if we ever want to train our own monster-specific facial model, but that is a multi-month bet, not v1.

## 4. Capability fit (DWEA axes)

| Stack | Realism axis hit | ARKit-52 fit | Browser fit | Latency envelope | Uncanny floor risk |
|---|---|---|---|---|---|
| Convai Web SDK lip-sync | Lip + light face | ARKit-61 (superset, needs mapping check) | Native (60 fps in-browser) | In envelope (60 fps, in-process) | Low — proven shipping product |
| A2F-3D server-side | Lip + emotion + light body coupling | Yes (blend-shape output supported) | Indirect (NIM/gRPC hop) | Plausible but unverified for our envelope — needs spike | Low for face; latency drift can introduce uncanny |
| OSS research family | Lip + emotion (per model) | Mostly no (FLAME / custom topology) | None | Out of envelope without engineering | High — research code, no perceptual hardening |
| VASA-1 | Highest face realism reference | N/A (2D video) | N/A | N/A | N/A |
| MetaHuman Animator | High face realism | Yes (MetaHuman rig) | None (Unreal-only at runtime) | Out (parallel pipeline) | Low quality-wise, high lock-in-wise |
| Inworld Realtime TTS | TTS + viseme stream | Indirect (we'd drive the face) | Possible with custom face code | Depends on our face stack | Same as whatever face stack we pair it with |

**Replacement vs. supplement framing:** A2F-3D is *not* a replacement for Convai in v1; Convai is browser-native and bundles the SDK we are already adopting. A2F-3D is a **supplement** for higher-fidelity monsters, and an actual replacement only if Spike B triggers, in which case Convai's TTS / brain pieces are already being swapped out anyway. The OSS research family is a *parallel* lane — only relevant if we decide to own the face model ourselves, which is out of scope for v1.

## 5. Integration shape

If we ship Convai-as-default tomorrow ([DWEA-41](/DWEA/issues/DWEA-41) plan):

- Brain → Convai → Web SDK delivers a synchronized **audio + 60 fps blendshape stream** to the browser.
- Three.js applies morph targets each frame on the gaussian-splat monster's face mesh. Splat-skinning question for [DWEA-27](/DWEA/issues/DWEA-27) is upstream of this and not blocked by our facial-stack choice.
- Viseme observability: the Convai stream already exposes per-frame blendshape values; SA's viseme-drift metric ([DWEA-108](/DWEA/issues/DWEA-108) §2.1) can be wired by comparing the played-back blendshape envelope against the spoken phoneme timeline (engineering spike, not a research blocker).
- Cost: bundled into Convai's per-character / per-minute pricing already on the v1 cost path.

If Spike B triggers and we add A2F-3D server-side:

- A2F-3D NIM microservice runs on a GPU we host (or NVIDIA-hosted, TBD).
- Audio (from ElevenLabs) goes in over gRPC; ARKit-52 blendshape stream comes out.
- Browser receives the blendshape stream over WebSocket (LiveKit data channel) and applies via the same Three.js path.
- Extra ~one network hop vs. Convai. Whether end-to-end audio→face→render latency stays under ~150 ms for conversational believability is the spike question.

Both shapes keep ARKit-52 as the on-the-wire interchange. Both are compatible with the gaussian-splat + browser pipeline and explicitly avoid Unreal / Omniverse / cloud-rendered video.

## 6. Peer landscape (summary)

- **Convai (Web SDK) — current v1 default.** Access: public, in-pipeline already. Capability fit: replacement-grade for v1 needs. Pipeline fit: native browser.
- **NVIDIA A2F-3D — Spike B candidate.** Access: MIT-OSS Sept 2025, server-side runtime. Capability fit: supplement for higher-realism faces, emotion bundled. Pipeline fit: gRPC hop into the browser; not native but acceptable.
- **Microsoft VASA-1 — reference only.** Access: closed, no API. Capability fit: state-of-the-art 2D realism but wrong output shape. Pipeline fit: none.
- **MetaHuman Animator — pipeline-locked.** Access: free with Unreal. Capability fit: very high in-Unreal. Pipeline fit: none for us.
- **Inworld AI — adjacent.** Access: public. Capability fit: TTS + viseme stream. Pipeline fit: would force us to build the face stack ourselves; weaker browser path than Convai.
- **OSS research family (EmoTalk / FaceDiffuser / DiffSpeaker / AniTalker / SAiD / SadTalker / MuseTalk / GeneFace++) — research-grade.** Access: code public. Capability fit: variable; format mismatch dominates. Pipeline fit: not production.

No board-asked vendor has been silently substituted. The CEO's prompt named A2F-3D, Convai, and "alternative threads"; this note covers each in line.

## 7. Recommendation

**Primary recommendation — keep, with one prototype follow-up:**

1. **Keep Convai's built-in lip-sync as the v1 facial-animation default.** Reason: already on the v1 cost path under [DWEA-41](/DWEA/issues/DWEA-41), browser-native, 60 fps blendshapes, ARKit-superset mapping, ships with the SDK we are already adopting. No safer floor exists today.
2. **Prototype A2F-3D as the Spike B face stack.** Reason: MIT-OSS removed the lock-in objection we previously had, ARKit-52 output is supported, emotion model bundled. The open question is **end-to-end latency under our concurrency assumptions** and **GPU $ per concurrent monster**, both of which require code to answer. Hand to FE as a tightly-scoped spike (next section).
3. **Add a viseme-drift observability hook regardless of which face stack ships.** Reason: SA's [DWEA-108](/DWEA/issues/DWEA-108) §2.1 already names this as a missing metric; it's stack-agnostic and pays back on either v1 or Spike B.
4. **Wait — explicit revisit trigger — on the OSS research family.** Revisit when (a) any of EmoTalk / FaceDiffuser / DiffSpeaker / AniTalker / SAiD lands a published browser runtime *and* native ARKit-52 output, **or** (b) Convai's NeuroSync quality is judged insufficient against per-monster acceptance bars by VisualDesigner / ConceptPlanner.
5. **Decline — VASA-1, MetaHuman Animator.** VASA-1: no API, no public weights, wrong output shape. MetaHuman Animator: Unreal-only at runtime, violates pipeline shape constraint. These are not "wait" — they are no until the underlying access/pipeline facts change.

**Reversibility:** All "yes" calls here are reversible. Convai-as-default is the v1 frame already; swapping to A2F-3D under Spike B is the planned escape hatch. The "no" calls (VASA-1, MetaHuman Animator) are not one-way doors either — we are not signing contracts, just not building against closed/locked stacks.

**Follow-up implementation ticket (to be filed by CEO via the AR sync flow):** FE-owned A2F-3D spike — success criteria:

- Stand up A2F-3D NIM (or local SDK) against a recorded 30-second monster utterance from one of Otto / Pip / Mara.
- Measure end-to-end latency from audio chunk in → ARKit-52 frame out → Three.js render, p50/p95, single concurrent stream and four concurrent streams.
- Verify the ARKit-52 channel mapping matches our interchange (no Convai-style superset surprise).
- Land a single comparison clip (Convai vs. A2F-3D, same audio, same monster rig) for VisualDesigner / ConceptPlanner to judge.
- One-page report on this issue; no production wiring.

## 8. References

- NVIDIA Audio2Face-3D — GitHub: <https://github.com/NVIDIA/Audio2Face-3D>
- NVIDIA Audio2Face-3D SDK — GitHub: <https://github.com/NVIDIA/Audio2Face-3D-SDK>
- NVIDIA Audio2Face-3D-v3.0 — Hugging Face: <https://huggingface.co/nvidia/Audio2Face-3D-v3.0>
- NVIDIA — "NVIDIA Open Sources Audio2Face Animation Model": <https://developer.nvidia.com/blog/nvidia-open-sources-audio2face-animation-model/>
- NVIDIA Audio2Face-3D — performance docs: <https://docs.nvidia.com/ace/audio2face-3d-microservice/2.0/text/interacting/performance.html>
- Audio2Face-3D paper (arXiv 2508.16401): <https://arxiv.org/html/2508.16401v1>
- Convai Web SDK docs: <https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk>
- Convai Web SDK npm: <https://www.npmjs.com/package/@convai/web-sdk>
- Convai — "Lip Syncing AI Characters" blog: <https://convai.com/blog/lip-syncing-virtual-ai-characters-techniques-integration-and-future-trends>
- Convai — browser-based avatars tutorial: <https://convai.com/blog/ai-avatars-inside-browser-threejs-react-convai-web-sdk-tutorial>
- Microsoft Research — VASA-1: <https://www.microsoft.com/en-us/research/project/vasa-1/>
- VASA-1 paper (arXiv 2404.10667): <https://arxiv.org/html/2404.10667v1>
- VentureBeat — VASA-1 coverage: <https://venturebeat.com/ai/microsoft-shows-off-vasa-1-an-ai-framework-that-makes-human-headshots-talk-sing>
- MetaHuman 5.6 release notes: <https://www.metahuman.com/news/metahuman-leaves-early-access-with-a-feature-packed-new-release>
- Unreal Engine MetaHuman docs: <https://dev.epicgames.com/documentation/en-us/metahuman/metahuman-documentation>
- MetaHuman Animator audio-driven roadmap: <https://portal.productboard.com/epicgames/1-unreal-engine-public-roadmap/c/1629-audio-driven-animation-for-metahuman-animator>
- Inworld Realtime TTS: <https://inworld.ai/tts>
- EmoTalk — paper (arXiv 2303.11089): <https://ar5iv.labs.arxiv.org/html/2303.11089>
- EmoTalk — GitHub: <https://github.com/ZiqiaoPeng/EmoTalk>
- FaceDiffuser — project: <https://uuembodiedsocialai.github.io/FaceDiffuser/>
- DiffSpeaker — paper (arXiv 2402.05712): <https://arxiv.org/html/2402.05712v1>
- SAiD — paper (arXiv 2401.08655): <https://arxiv.org/html/2401.08655v2>
- ARTalk — paper (arXiv 2502.20323): <https://arxiv.org/html/2502.20323v2>
- SadTalker — GitHub: <https://github.com/OpenTalker/SadTalker>
- Open-source lip-sync 2026 roundup (lipsync.com): <https://lipsync.com/blog/open-source-lip-sync>
- Pixazo 2026 open-source lip-sync roundup: <https://www.pixazo.ai/blog/best-open-source-lip-sync-models>
