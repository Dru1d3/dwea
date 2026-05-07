# Convai Web SDK — shape spike

Source issue: [DWEA-44](/DWEA/issues/DWEA-44) (parent: [DWEA-41](/DWEA/issues/DWEA-41)).
Date: 2026-05-07. Author: FoundingEngineer. Status: **gate FAIL — escalation posted**.

The DWEA-41 plan §6 v1.2 set this spike as a hard gate before any further v1.2 build. The gate fails on SDK shape; cost-envelope is a secondary trip under the only architecturally-credible workaround. Detail below.

---

## 1. What the gate was watching for

From [DWEA-44](/DWEA/issues/DWEA-44):

> Convai's Web SDK cleanly supports *"our brain emits the v0 + `world_model` envelope, Convai renders avatar from utterance + ARKit-52 coefficients we hand it"* — i.e. **custom-LLM input + custom-rig drive on a non-humanoid monster**, not Convai's brain on Convai's avatar.

Failure conditions (any one trips the gate):

1. SDK is all-or-nothing on Convai's brain.
2. Blendshape stream cannot drive a non-humanoid monster rig.
3. Per-interaction cost > $0.10/session at our shape (~100 sessions/day, ~10–15 turns/session).
4. Vendor stability signal during spike.

---

## 2. Findings

### 2.1 SDK shape — **FAIL**

**ConvaiClient is documented as "the brain".** From [Convai Web SDK](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk.md):

> **ConvaiClient** — The brain. Manages connection, state, messages, audio/video/screen-share control, and blendshape queue.

There is no public method to push a pre-authored assistant utterance into the response pipeline. Documented entry points are user-side only:
- `sendUserTextMessage(...)` — sends a user message into Convai's brain.
- `sendTriggerMessage(...)` — fires a Convai-side trigger.
- `toggleTts(true)` — toggles Convai's TTS.

When asked directly via the docs `?ask=` endpoint:

> No. `ConvaiClient` does **not** expose a public method for pushing **assistant-authored text** into Convai's response pipeline. […] What exists instead: UI-only `SendCharacterText` (does **not** generate audio or drive the backend); standalone TTS API (your text → audio, no SDK lipsync stream).

When asked about a "TTS-only / text-to-avatar" mode:

> No — there's no documented endpoint or SDK call for a true **TTS-only** or **text-to-avatar** mode that bypasses Convai's LLM brain entirely.

**BlendshapeQueue is receive-only.** No documented API to push our own ARKit-52 coefficients into the SDK's playback queue:

> `BlendshapeQueue` is documented as **receive-side only**. […] I do **not** see any documented API for pushing your own coefficients into the queue.

Net: the v1.2 architecture envisioned by DWEA-41 §6 — **brain emits envelope → we ship utterance + ARKit-52 coefs → Convai renders** — is not supported on the Web SDK's documented surface on any tier. The SDK is shaped as **Convai's brain → Convai's TTS → Convai's blendshape stream → your renderer/rig**.

### 2.2 Custom rig — **PASS (not the failure mode)**

Custom non-humanoid rigs with ARKit-52-named morph targets are supported via Convai's blendshape mapping system:

> Support for ARKit (61) and MetaHuman (251) formats […] Declarative name-based mapping system […] Optional custom mapping for any character rig.

A monster glTF with ARKit-52-named morph targets would render Convai's blendshape stream cleanly. This is not where the bet breaks.

### 2.3 Cost envelope — **TRIPS under the only viable workaround**

Indie tier (the published $22/mo entry point cited in [DWEA-39](/DWEA/issues/DWEA-39)) is capped at **3,000 interactions/month**. Our usage shape is ~100 sessions/day × 10–15 turns/session = ~30,000–45,000 turns/month — 10–15× over Indie's quota.

Tier gating relevant to this bet (from [Custom LLM API docs](https://docs.convai.com/api-docs/api-reference/core-api-reference/character-crafting-apis/custom-llm-api.md) and Core AI Settings):
- **Custom LLM API**: **Enterprise plan only** (custom contract pricing, not published).
- **Live APIs** (the realtime streaming surface that would match our p50 < 1.5s latency target): **Enterprise only**.
- **Interaction API**: **Professional plan and above**.

Per DWEA-41 §9, any non-trivial vendor spend (Convai paid tier > $22/mo, ElevenLabs Pro, etc.) must escalate to CEO before being committed. The architecturally-required path (see §2.4 below) is Enterprise-only — i.e. the only path forward already requires CEO escalation on cost grounds, regardless of the SDK-shape finding.

### 2.4 The "thread-the-needle" Custom LLM path — viable only on Enterprise, with caveats

Convai's **Custom LLM API** (Enterprise only) lets you register an OpenAI-compatible LLM endpoint that Convai's backend calls when it needs the assistant's reply. This gets us close to "brain emits the response, Convai handles voice + face" — but with three structural caveats:

1. **Inverted flow.** DWEA-41 §6 v1.2 envisions our brain *emitting* the envelope to Convai. The Custom LLM API runs the other direction: Convai *pulls* from our endpoint via OpenAI chat-completions semantics. We become a *callable LLM*, not a *driver of Convai*. This is workable but is not the integration shape the plan was scoped against.
2. **Envelope round-tripping is undocumented.** Convai's message model (per Custom UI / Events docs) is `bot-llm-text`, `action`, and `behavior-tree`. There is no documented path for arbitrary JSON `{utterance, world_model, actions[]}` to round-trip from our endpoint through Convai's backend to the Web SDK client. Our `world_model` and `actions[]` fields likely require either being shoehorned into Convai's `action`/`behavior-tree` schema, or carried out-of-band on a parallel channel — neither is confirmed in docs.
3. **Streaming-utterance commitment is unconfirmed.** DWEA-41 §6 v1.2 names "streaming utterance from brain into Convai TTS" as the load-bearing commitment for the p50 < 1.5s target. The docs do **not** confirm that Convai streams our endpoint's tokens into TTS as they arrive vs. waiting for full completion:
   > The docs do not confirm that behavior. […] they do not document token-by-token handoff into TTS, nor end-to-end preservation of `tools`/`response_format` payloads.

Without that streaming behavior, the realistic p50 lands at ~2.0–2.5s (per the plan's own warning), and the latency success criterion does not hold.

### 2.5 Vendor stability — no negative signal during spike

Docs are well-maintained, the Web SDK is shipping a current `@convai/web-sdk` package on the new backend, and there were no acquisition or support-degradation signals visible during this spike. This was not the failure mode.

---

## 3. Verdict

**Strict reading of DWEA-44 gate criteria: FAIL.**

- ✗ SDK is all-or-nothing on Convai's brain on Indie/Pro tiers (§2.1).
- ✗ Cost envelope blown by ~10–15× on Indie at our usage shape (§2.3).
- ✓ Custom rig is fine (§2.2) — not the failure.
- ✓ No vendor stability signal (§2.5) — not the failure.

The only architecturally-credible workaround (Custom LLM API, §2.4) sits behind:
- Enterprise tier with custom contract pricing (CEO-escalation per [DWEA-41 §9](/DWEA/issues/DWEA-41#document-plan)).
- An inverted dataflow vs. the planned "brain → Convai renders" shape.
- Two undocumented unknowns (envelope round-trip, streaming-token-into-TTS) that need a paid Enterprise spike to verify.

Per [DWEA-44](/DWEA/issues/DWEA-44) and [DWEA-41 §6 v1.2](/DWEA/issues/DWEA-41#document-plan):

> If the spike fails (any of) [SDK all-or-nothing, monster rig wall, cost > $0.10/session, vendor stability signal] → **STOP further v1.2 work. Comment on this ticket tagging [@CEO] and [@ConceptPlanner] with the SDK-shape evidence.** The CEO will re-decide the dual-spike posture with that evidence in hand.

Action: stopping further v1.2 build. Escalation comment posted on [DWEA-44](/DWEA/issues/DWEA-44). Issue moved to `in_review`, reassigned to CEO for re-decision of the dual-spike posture (Option B from [DWEA-41 §5](/DWEA/issues/DWEA-41#document-plan)).

---

## 4. What the CEO is being asked to decide

Three credible postures, in plain language:

**Option 1 — Roll-your-own primary (DWEA-41 Option A, previously held in reserve).**
Drop Convai. Build the embodiment stack from ARKit-52-rigged monster glTF + ElevenLabs Agents (TTS + streaming) + Audio2Face-3D NIM (lipsync, MIT-OSS) + LiveKit (transport). FoundingEngineer authors the envelope→renderer pipe end-to-end. Trade: ~2× engineering time on v1, but no vendor lock and full envelope fidelity.

**Option 2 — Convai Enterprise via Custom LLM API.**
Pay for Enterprise tier (CEO-spend escalation), wrap brain as OpenAI-compatible chat-completions endpoint, and accept the inverted dataflow + the two unverified unknowns. Spike B remains a follow-up to confirm streaming-token-into-TTS behavior under Custom LLM. Trade: stays single-vendor on the embodiment renderer, but dataflow is not what was scoped, latency commitment is at risk, and `world_model`/`actions[]` round-trip path is unsolved.

**Option 3 — Dual-spike posture (DWEA-41 Option B, AnimationResearcher's original recommendation).**
Run a small Convai Enterprise spike *and* the roll-your-own pipeline in parallel. Compare on a per-month bake-off, pick the winner for v1.2 production. Trade: doubles engineering load on a 1-engineer team — explicitly rejected in plan revision 1 — but is the option this gate-fail puts back on the table.

---

## 5. Sources

- [Convai Web SDK overview](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk.md)
- [Custom LLM API](https://docs.convai.com/api-docs/api-reference/core-api-reference/character-crafting-apis/custom-llm-api.md)
- [Real-time Lipsync (BlendshapeQueue)](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/real-time-lipsync.md)
- [ConvaiClient Core API](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/convaiclient-core-api.md)
- [Best Practices & Type Definitions](https://docs.convai.com/api-docs/plugins-and-integrations/web-plugins/convai-web-sdk/vanilla-typescript/best-practices-and-type-definitions.md)
- [Core AI Settings (interaction quotas / flagship caps)](https://docs.convai.com/api-docs/convai-playground/character-customization/core-ai-settings.md)
- [Live APIs (Beta)](https://docs.convai.com/api-docs/api-reference/core-api-reference/live-apis-beta.md)
- [Interaction API (Beta)](https://docs.convai.com/api-docs/api-reference/core-api-reference/interaction-apis/interaction-api-beta.md)
