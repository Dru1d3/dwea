# 0009 — demo rig: Mixamo "Soldier" via GltfHumanoid

- Status: accepted
- Date: 2026-05-06
- Owner: [Founding Engineer](/DWEA/agents/foundingengineer)
- Issue: [DWEA-26](/DWEA/issues/DWEA-26)
- Implements: drop-in slot reserved by [ADR 0008](./0008-r3f-runtime.md)

## Context

[ADR 0008](./0008-r3f-runtime.md) shipped the character runtime against a
placeholder capsule humanoid (`StubHumanoid`) and explicitly framed the
named-bone hierarchy as a public schema so a real GLB could drop in later
without touching the IK or animation layers. DWEA-26 cashes that promise:
the demo page should render with a real rigged 3D model, not stick figures.

We need a model that is free to redistribute, has a well-known humanoid
rig, ships with at least the locomotion clips (idle / walk / run), and is
small enough to load on a public deploy.

## Decision

### Model: three.js's bundled `Soldier.glb`

`Soldier.glb` is the Mixamo "Vanguard" character with `Idle`, `Walk`,
`Run`, and `TPose` animations, distributed by the three.js project. It
is 2.1 MB, ships with the standard `mixamorig:` armature, and is bundled
in three.js's example library under their MIT redistribution stance plus
Mixamo's free-use license. We mirror the file under
`public/models/Soldier.glb` and keep a credits note at
`public/models/CREDITS.md`.

If license hygiene later forces a CC0 swap (Quaternius, Kay Lousberg,
Khronos sample models, etc.), the only file that needs to change is the
bone-name table — see below.

### Architecture: `GltfHumanoid` + abstract bone-name resolver

Two minimal changes to the runtime keep the IK and clip logic rig-agnostic:

1. `HumanoidHandle.boneNames: Record<HumanoidBone, string>` — every
   humanoid implementation reports the actual `Object3D.name` strings
   that AnimationMixer's PropertyBinding will resolve. The synth
   `AnimationClip`s in `animations.ts` build their track names through
   this map, so a single clip definition retargets cleanly across rigs.

   - `STUB_BONE_NAMES`: each abstract bone maps to itself (`pelvis →
     "pelvis"`).
   - `MIXAMO_BONE_NAMES`: each abstract bone maps to the sanitised
     Mixamo node name (`pelvis → "mixamorigHips"`, `chest →
     "mixamorigSpine2"`, …). Sanitisation matches three.js's
     `PropertyBinding.sanitizeNodeName`, which drops the `:` from
     `mixamorig:Hips` at GLTFLoader time.

2. `GltfHumanoid` (`src/character/GltfHumanoid.tsx`) — loads a GLB via
   `useGLTF`, runs the scene through `SkeletonUtils.clone` (so multiple
   instances do not share a skeleton), exposes a `HumanoidHandle` with
   `MIXAMO_BONE_NAMES`, and surfaces the GLB's bundled clips on
   `handle.clips`. The component applies a fixed Y offset so the loaded
   skeleton's hip lands at the outer group's origin — `Character` then
   reuses the same hip-level wrapping it was already using for the stub.

`Character` merges synth fallbacks with the bundled clips so real Mixamo
`idle / walk / run` replace the hand-rolled keyframe loops, and the synth
set still drives `jump / fall / wave` (the GLB lacks those).

`Character` defaults to `rig="gltf"`; `rig="stub"` is kept for tests and
dev-loop scenarios where the loader is unavailable. While the GLB is
loading, an inner `<Suspense>` falls back to the stub humanoid so nothing
visibly pops in.

### Why not Mixamo direct (no Adobe login required) or runtime fetches?

We considered Ready Player Me (runtime fetch + third-party API), VRoid
(VRM, anime-style), and pulling characters from Mixamo on demand. All of
them either require an account, depend on a live external service, or
ship a non-Mixamo armature that would force a different bone-name table.
The bundled `Soldier.glb` lands the same Mixamo schema with zero
runtime dependencies, which makes it a strictly cheaper first move.

## Consequences

- The demo page now shows a recognisable, animated humanoid out of the
  box. T3 (LLM motor) and T4 (smoke demo) work against a realistic rig,
  not a capsule stack.
- The `boneNames` indirection is the seam any future rig swap will pivot
  on: drop a new GLB under `public/models`, define a `*_BONE_NAMES`
  table, and point `GltfHumanoid` at the new URL. No change to `ik.ts`,
  `animations.ts`, or `Character.tsx`.
- Synth clips for `jump / fall / wave` retarget to Mixamo bones via the
  same map. They will look slightly stylised on the soldier (designed
  for the stub's exact local axes); investing in Mixamo-baked clips for
  these slots is a follow-up.
- `useGLTF.preload` warms the loader cache on import. If we end up with
  multiple character GLBs, the preload list grows in `GltfHumanoid` (or
  is moved to a registry).

## References

- [DWEA-26](/DWEA/issues/DWEA-26) — this task
- [ADR 0008](./0008-r3f-runtime.md) — runtime that reserved this slot
- `public/models/CREDITS.md` — license note for `Soldier.glb`
- three.js examples: <https://threejs.org/examples/?q=skinning>
- Mixamo: <https://www.mixamo.com>
