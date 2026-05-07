# LLM character API — research note

> Origin: [DWEA-33](/DWEA/issues/DWEA-33). Implementation: [DWEA-34](/DWEA/issues/DWEA-34).

## TL;DR

- **Build it ourselves first.** A frontier-class LLM (Claude or GPT, mini/Haiku
  tier) with strict JSON-schema tool calling is the right primitive for a
  "character with emotions and body parts" today. It maps cleanly onto our web
  (Three.js / WebGPU + gaussian-splatting) stack.
- **Don't roll our own voice.** Use a TTS vendor (ElevenLabs or Inworld free
  tier) for low-latency emotional speech once the CEO confirms the vendor
  pick + spend approval.
- **Skip character-engine vendors (Inworld / Convai) for v0.** Their SDKs are
  Unity/Unreal-first; on a web stack they are second-class. Re-evaluate if we
  ever ship a Unity/Unreal client.

## Why the roll-your-own pattern wins on web

The decisive variables — action vocabulary, world-state representation, tick
cadence — are ours to define no matter which vendor we pick. A small spike
answers them faster than more research can. Vendor SDKs hide the LLM and
constrain the schema; on web that costs more than it buys.

## v0 action vocabulary (this repo)

`look_at`, `walk_to`, `play_animation(clip)`, `set_face(expression, intensity)`
— emitted as elements of an `actions[]` array inside the response envelope:

```json
{
  "schemaVersion": "1",
  "utterance": "...",
  "emotion": "...",
  "intention": "...",
  "actions": [{ "kind": "...", "x": 0, "z": 0, "clip": "", "expression": "", "intensity": 0 }]
}
```

Strict mode does not accept `oneOf`, so every action object carries every
field; the dispatcher reads `kind` and uses only the relevant ones.

Implementation lives in [src/llm/brain.ts](../../src/llm/brain.ts). Action
mapping for the husky NPC is in [src/npc/intent.ts](../../src/npc/intent.ts).

## Voice

Web Speech API is the v0 TTS — zero spend, no signup, ~50 ms first-audio on
modern browsers, comfortably under the issue's ~1 s target. It lives behind
a vendor-shaped wrapper ([src/llm/voice.ts](../../src/llm/voice.ts)) so the
swap to ElevenLabs / Inworld / Cartesia is a one-file change once the CEO
picks a vendor.

## Revisit triggers

- We commit to a Unity/Unreal client → reconsider Inworld/Convai (their SDKs
  become first-class).
- We need >10 concurrent monsters per scene at <200 ms full-loop latency →
  push toward on-device small models.

## One open ask for the CEO

TTS vendor choice + any spend approval needed before engineering signs up
beyond a free tier. Posted on [DWEA-34](/DWEA/issues/DWEA-34).
