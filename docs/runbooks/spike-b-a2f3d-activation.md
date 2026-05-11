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

### 2. Wire the relay's gRPC bridge

The relay (`infra/a2f-3d/relay/index.mjs`) ships with a canned stub stream
for CI / local-dev. To go live, complete the `// operator must` checklist
at the top of the file: pull `@grpc/grpc-js`, generate stubs from the
A2F-3D-SDK proto, and forward `start` / `audio` / `stop` to NIM.

### 3. Swap engine ID on the character

In `src/llm/voice.ts` (or its successor under v1.2), replace the Convai
voice handle with the A2F-3D client from `src/lipsync/a2f3dClient.ts`. The
mesh apply path (`applyFrameToMesh` in `src/lipsync/arkit52.ts`) does not
change — both engines emit ARKit-52 into the same morph-target dictionary.

Update the telemetry emitter's `engineId` from `convai` to `a2f3d` so
dashboards split correctly.

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

Behind a single per-character setting (e.g. `bible.face.engine = 'a2f3d'`),
not a global swap. v1.5 lets monsters live on different tiers — Mara might
go world-class while Pip stays "good" if the budget tightens.

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
