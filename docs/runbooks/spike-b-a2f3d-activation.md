---
title: Spike B — A2F-3D activation runbook
issue: DWEA-118
last-updated: 2026-05-11
status: draft (Spike B scaffolding shipped; GPU benchmark + side-by-side clip pending operator)
---

# Spike B — A2F-3D activation runbook

One-page playbook for moving the v1 face stack from Convai-default ("good"
tier) to NVIDIA Audio2Face-3D ("world-class" tier) at v1.5. The point of
this document is that **v1.5 is not a cold start**: code, infra, and
telemetry are already in the repo; the trigger pulls them out of standby.

## Production scope (signed direction — read first)

Two pieces of signed direction from style bible v0.3 ([DWEA-54](/DWEA/issues/DWEA-54)
sign-off, 2026-05-08) constrain how this runbook applies; both came in via
[@VisualDesigner](agent://6e504c34-ad57-410c-a7a3-9213b7ff21c0) and
[@ConceptPlanner](agent://2e84a3b5-8553-4cdc-b5fd-81ebf4e0fbb1)'s ratification
of the Spike B scaffolding on [DWEA-118](/DWEA/issues/DWEA-118).

### 1. A2F-3D drives **Mara only**, not all monsters (§Q6)

Otto and Pip are speech-amplitude driven on the rig; A2F-3D is reserved
for Mara's jaw / blink / brow channels. The v1.5 flip therefore prices for
**one A2F-3D stream per scene** (and only when Mara is present), not
N-per-monster.

- The AC's "≥2, target 5 concurrent streams" bench line is a **worst-case
  headroom check**, not a per-scene baseline.
- v1.5 flip economics must be priced against 1 stream / scene. If
  per-stream L4 $ is uneconomic at 1, the flip is dead regardless of
  concurrency headroom — concurrency does not rescue an unviable
  per-stream cost.
- The bench is still worth running at N ≥ 2 to size headroom for
  multi-scene / future-Mara-twin cases, but the **decision metric** is
  per-stream cost.

### 2. A2F-3D output goes through the §5.2 named-curve shaper before the rig (§5.5 / §7.1 #5)

A2F coefficients are mocap-class data; raw frames will fight the motion
curve language and read as uncanny. The v1.5 flip is therefore not
A2F-3D → rig but **A2F-3D → named-curve shaper → rig**, and the
curve-shaper is a **hard prerequisite**, not optional polish.

- Spike B's harness sits upstream of the curve-shaper — correct
  architecture.
- Activation step #3 below (engine swap) is **gated** on the curve-shaper
  shipping. If the curve-shaper is not yet implemented when the v1.5
  flip-trigger fires, that's a flip blocker, not a runbook escape hatch.

## Tier ladder

## Tier ladder

| Tier        | Face stack                | Where we sit                             |
| ----------- | ------------------------- | ---------------------------------------- |
| good        | Convai bundled lip-sync   | v1 default (current).                    |
| world-class | A2F-3D + ARKit-52 stream  | v1.5 reserve, **only on flip-trigger**.  |

A2F-3D is a *tier upgrade*, not a panic swap. v1's "good" tier already
clears the demo bar per ConceptPlanner; the flip exists for the case where
the demo's most-uncanny moment turns out to be the mouth.

## Flip-triggers (re-stated, all from [DWEA-115](/DWEA/issues/DWEA-115))

1. Convai v1.2 lip-sync drift exceeds **80 ms p95** (ITU-R BT.1359 uncanny
   floor; AR note). Read the `viseme_audio_drift_ms_p95` metric from the
   telemetry harness — emitted under both Convai and A2F-3D engines from day
   one.
2. Convai pricing / rig-flex / vendor-stability regression.
3. VisualDesigner / ConceptPlanner judge the v1 demo's most-uncanny moment
   to be the mouth.
4. [DWEA-116](/DWEA/issues/DWEA-116) returns "Convai ARKit-61 is **not** a
   clean ARKit-52 superset" — v1.5 reversibility math changes.

## Activation steps (≈half an FE-day once triggered)

### 1. Stand up A2F-3D NIM

```bash
export NGC_API_KEY=<NGC key with NIM access>
docker compose -f infra/a2f-3d/compose.yaml up
```

Compose file: `infra/a2f-3d/compose.yaml`. L4 (24 GB) is the documented
minimum; bench numbers live in this issue's GPU benchmark comment (still
owed by operator).

**Cost-bench framing (per §Q6, see Production scope §1):** capture
per-stream $ at **N = 1** as the decision metric. Capture N = 2 and N = 5
as headroom data, not gating data. The runbook ships v1.5 if-and-only-if
per-stream L4 $ is economic at 1 stream / scene.

### 2. Wire the relay's gRPC bridge

The relay (`infra/a2f-3d/relay/index.mjs`) ships with a canned stub stream
for CI / local-dev. To go live, complete the `// operator must` checklist
at the top of the file: pull `@grpc/grpc-js`, generate stubs from the
A2F-3D-SDK proto, and forward `start` / `audio` / `stop` to NIM.

### 3. Swap engine ID on Mara (NOT all monsters)

**Prerequisite (gating, see Production scope §2): the §5.2 named-curve
shaper must already be shipped.** Raw A2F frames driving the rig directly
will fight the motion-curve language and read as uncanny. If the shaper
is not yet implemented, the v1.5 flip is blocked until it is — do not
ship A2F → rig direct.

The wiring shape is:

```text
A2F-3D NIM ──gRPC──> relay ──WS──> a2f3dClient.ts ──> §5.2 curve-shaper ──> applyFrameToMesh ──> Mara rig
```

In `src/llm/voice.ts` (or its v1.2 successor), replace the Convai voice
handle **for Mara only** with the A2F-3D client from
`src/lipsync/a2f3dClient.ts`. Otto and Pip stay on the speech-amplitude
path per §Q6. Pipe the client's `onFrame(frame, audioTimeMs)` through the
curve-shaper before calling `applyFrameToMesh`. The mesh-apply contract
does not change — both engines emit ARKit-52 into the same
morph-target dictionary.

Update the telemetry emitter's `engineId` from `convai` to `a2f3d` on the
Mara surface so dashboards split correctly. Keep `engineId: 'convai'` on
Otto and Pip.

### 4. Verify

1. `pnpm test` — telemetry + ARKit-52 + client unit tests should stay green.
2. Open `/?lipsync-test` against the live relay, set mode = "live A2F-3D
   relay", click Start. The four metrics should fill in with sane values:
   - `viseme_frame_rate` ≥ 30 fps
   - `viseme_audio_drift_ms_p95` < 80 ms
   - `jaw_open_amplitude_p95` > 0.3 on a normal utterance
   - `lipsync_engine_id` == `a2f3d`
3. Re-run the v1 demo path with one of Otto / Pip / Mara. The mouth should
   visibly drive without any rig-side changes.

### 5. Roll out

Behind the per-character `bible.face.engine` setting, **scoped to Mara
only at v1.5** per §Q6. Otto and Pip stay on the v1 speech-amplitude
path; widening A2F-3D to other monsters is a separate decision under a
later flip, not part of the v1.5 flip.

## Reversibility

Every step above is one file edit to back out. The browser-side apply path
is engine-blind; the engine ID is a string. The Spike B code lives under
`src/lipsync/` and `infra/a2f-3d/` — both are removable in one commit if we
decide to defer the tier upgrade indefinitely.

## What is *not* in this runbook

- Audio source choice (ElevenLabs / Inworld / etc.). Spike B is face-only;
  TTS is decided separately under [DWEA-41](/DWEA/issues/DWEA-41).
- LiveKit data-channel wiring. The current WS relay is spike-only; production
  transport moves to LiveKit when (and only if) v1.5 is committed.
- Side-by-side comparison clip. Tracked under the same issue but is an
  artefact, not a code path.

## Provenance

- Research recommendation: `docs/research/tts-driven-facial-animation.md`
  (AR via [DWEA-115](/DWEA/issues/DWEA-115)).
- Telemetry metrics: SystemsArchitect, [DWEA-108](/DWEA/issues/DWEA-108) §2.1.
- Tier-ladder framing: ConceptPlanner add-on on
  [DWEA-115](/DWEA/issues/DWEA-115).
- Scope-confirmation: FE on [DWEA-115](/DWEA/issues/DWEA-115#comment-809f60a9-a9dd-41de-bb64-fb5f9634a196).
