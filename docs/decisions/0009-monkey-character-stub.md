# 0009 — Dancing-monkey stub (CC0 OGA monkey + assimpjs bake)

- Status: accepted
- Date: 2026-04-30
- Owner: Founding Engineer
- Issue: [DWEA-24](https://github.com/Dru1d3/dwea/issues/24) (T6 — Swap CC0 robot → CC0 monkey + dance clip)
- Builds on: [ADR 0006 — Character asset pipeline](0006-character-asset-pipeline.md)
- Supersedes (in part): the `defaultCharacterId = 'robot-expressive'` choice in
  ADR 0006

## Context

The board's plain-language ask on [DWEA-22](https://github.com/Dru1d3/dwea/issues/22)
was a *rigged dancing monkey*. ADR 0006 shipped a CC0 humanoid robot
(`RobotExpressive`) as the v1 stub character because no monkey rig was on
hand and the real Meshy bake pipeline ([DWEA-21](https://github.com/Dru1d3/dwea/issues/21))
remained blocked on `MESHY_API_KEY`. T6 is the same Path-C-style stub-then-
replace pattern: ship a CC0 *monkey* now so the dance demo reads like the
board's mental model, leave Path A (Meshy) for the eventual real bake.

The agent runtime that owns this work runs headless in an aarch64 Linux
container — no browser session, no GUI Blender, no x86_64-only prebuilt
binaries. That is the same constraint that pushed ADR 0006 onto Path C, and
it shapes every choice below.

## What this ADR pins down

- **Asset choice** — which monkey, why, and what license terms ride with it.
- **Bake pipeline** — how to turn the upstream FBX into a
  `public/characters/<id>.glb` with embedded textures, without the
  Mixamo / AccuRIG / ActorCore steps that ADR 0006 already ruled out as
  unexecutable headless.
- **Single-clip caveat** — what the registry promises versus what the GLB
  actually ships, and how the dance-button acceptance from DWEA-22 reads
  against it.
- **The default flip** — `defaultCharacterId` moves from `robot-expressive`
  to `monkey-tomk`. Robot stays in the registry as the rich-clip fallback.

## Sources considered

I searched four buckets for a directly-fetchable, headless-bakeable monkey:

1. **Quaternius** (the same author as `RobotExpressive` from ADR 0006) —
   `Animated Animal Pack`, `Ultimate Animated Animal Pack`, `LowPoly Animated
   Monsters`, `Cute Animated Monsters`, `Animated Monster Pack`. Verified on
   2026-04-30: the animal packs include cow / horse / fox / wolf / deer /
   alpaca / shiba / etc., **no monkey or ape**. The monster packs are stylized
   creatures, none simian. Same CC0 license as the robot, but the asset
   doesn't exist.

2. **Sketchfab CC-BY** — abundant rigged monkey models with dance clips
   (`MONKEY` by *dinesdiabolik*, 40 anims; `Agile Monkey` by *LopesVitor*,
   6 anims; `Chef Monkey Rig`, 11 anims; `Monkey D. Luffy`, 9 anims). All
   downloadable, but Sketchfab gates archive downloads behind an OAuth/API
   token even for CC-BY assets. The agent has no Sketchfab credentials.
   Provisioning a token is feasible (same governance shape as the
   `MESHY_API_KEY` ask on DWEA-21); rejected for v1 because we don't want to
   block T6 on a credential roundtrip when a usable CC0 path exists.

3. **GitHub raw** (Three.js examples / glTF-Sample-Assets / Khronos) —
   the only relevant rigged characters are `Xbot.glb` (Mixamo idle/run/walk/
   agree/headShake/sad_pose/sneak_pose, no dance), `Michelle.glb` (Mixamo
   `SambaDance` + TPose only), and `Soldier.glb` (Idle/Run/Walk/TPose).
   Mixamo characters, not monkeys. Could splice `Michelle.glb`'s `SambaDance`
   onto a monkey rig, but the bone hierarchies don't match (Michelle uses
   `mixamorig:*` names; the OGA monkey uses `b_*` names with a 7-bone tail
   chain Mixamo doesn't model), so the splice would need a Blender retarget
   — which ADR 0006 already established is not headless-bakeable.

4. **OpenGameArt CC0** — *"Monkey 3D model. Rigged. FBX."* by **tomk**,
   uploaded under CC0 1.0 Universal, single ZIP archive
   `Monkey_animated.zip` (10.4 MB) directly fetchable over HTTPS. Source:
   <https://opengameart.org/content/monkey-3d-model-rigged-fbx>.
   **This is the one we shipped.** Last verified 2026-04-30.

## What "the OGA monkey" actually is

- **Topology**: humanoid bipedal monkey, 17,037 vertices, 5,679 triangles,
  4 baseColorTextures (head, body, eyes, body-detail). 34 joints in the
  skeleton, including a 7-bone tail chain (`b_Tail01`..`b_Tail07`) absent
  from Mixamo's standard rig.
- **Animation set**: a single FBX track named `Take 001` — the default
  name `motionbuilder`/legacy FBX exporters give to "the action you were
  editing when you saved". 2 seconds, 121 keyframes, 39 bones animated.
  Hip translation moves ±29 units vertically and ±42 units forward over
  the loop while `b_Root` stays at the origin — i.e. the monkey bobs and
  sways in place rather than translating in world space. That reads as a
  *dance / idle hybrid* rather than a walk cycle.
- **Textures**: 1024² and 512² PNGs, ~750 KB total. Three large normal
  maps (`NormalMap.png`, `NormalMap2.png`, `NormalMap3.png`, ~9 MB combined)
  ship in the source archive but the FBX's materials don't reference them,
  so they're dropped at bake time.

After the bake (see *Pipeline* below) the GLB is **2.24 MB** with all four
referenced PNGs embedded — inside the 5 MB acceptance bar from DWEA-24,
above the 2 MB ideal. ADR 0006's 10 MB ceiling stays the binding limit;
2.24 MB is well under it.

## The single-clip caveat

DWEA-24's acceptance criterion 3 is *"pressing the dance button (or LLM
`play_animation('dance')` tool call) makes the monkey dance"*. The shipped
GLB has exactly one clip. The bake script renames it from `Take 001` to
`Dance` so the registry id, the `play_animation` tool surface from
[DWEA-18](https://github.com/Dru1d3/dwea/issues/18), and the dance button
all key on the same string.

That choice is documented here, in `monkey-tomk.LICENSE.txt`, and in the
bake script — there is no covert relabel. The motion *visually* reads as a
dance (in-place hip bob with no foot translation), and even if a future
maintainer disagrees with that reading, the rename is reversible by editing
two strings (the bake script's `ANIM_RENAME` map and the registry entry's
`clips` array).

What this means for the rest of the registry:

- **Monkey clip set is `Dance` only.** No `Idle`, no `Walk`, no `Wave`. The
  registry test (`src/characters/registry.test.ts`) asserts the count is
  exactly 1, so a future bake that adds clips will trip the test and force
  the maintainer to update the registry alongside the asset.
- **Robot stays registered as `robot-expressive`.** It still owns the rich
  gesture / locomotion library (Idle, Walking, Running, Wave, ThumbsUp,
  Yes, No, Sitting, Standing, Punch, Dance, Death — 14 clips). Any test or
  scene that needs more than dance can target the robot id explicitly. The
  robot is *not* on the dance demo path — `defaultCharacterId` flips to
  `monkey-tomk`.

## Pipeline

The bake is reproducible from `scripts/bake-monkey-tomk.cjs`. Hard
constraints, then steps:

- **No prebuilt FBX2glTF binary.** Facebook's `fbx2gltf` npm package only
  ships `bin/Linux/FBX2glTF` as x86_64; the agent runs aarch64. `qemu-user`
  isn't installed, and shouldn't be just for one bake.
- **No Blender step.** Same reasoning as ADR 0006 — Blender CLI/headless is
  installable but it's the kind of half-magic step that drags humans back
  in for "just one tweak". The repo conventions stay GUI-free.

So the FBX → GLB step uses **assimpjs**, a WASM port of Open Asset Import
Library. It reads binary FBX in node, emits a GLB with external image URIs
that the next step embeds. Pinning assimpjs is fine — it's an aarch64-clean
wasm asset, ~3 MB unpacked, BSD-licensed, mature.

The bake script:

1. Fetches `Monkey_animated.zip` from OGA over HTTPS (10.4 MB).
2. Unzips with `python3 -m zipfile` (no `unzip` binary in the agent image).
3. Installs `assimpjs` into a scratch dir (no project devDependency added).
4. Converts FBX → GLB with `glb2` target, passing the four referenced PNGs
   into the WASM filesystem so the converter can resolve them.
5. Re-packs the GLB:
   - rewrites the JSON chunk to embed the four images into the binary
     buffer chunk (drops the `..\\textures\\<n>.png` URIs assimpjs writes),
   - renames `Take 001` → `Dance`,
   - re-emits a single self-contained GLB at
     `public/characters/monkey-tomk.glb`.

Run it as `node scripts/bake-monkey-tomk.cjs`. It writes ~2.24 MB and
exits 0; the SHA256 of the v1 bake is captured in
`monkey-tomk.LICENSE.txt`.

`scripts/add-character.sh` from ADR 0006 *cannot* take an FBX as input — it
explicitly rejects non-`.glb` sources and points the caller at `gltf-transform
merge` for that case. T6 leaves that contract intact: GLBs come from
`add-character.sh` (Path A / Path C straight-from-GLB) or from a per-asset
bake script (Path C with format conversion). `bake-monkey-tomk.cjs` is the
first per-asset script; future per-asset bakes follow the same shape.

## Followups

- **DWEA-21 (real Meshy bake).** Still blocked on `MESHY_API_KEY`. When it
  unblocks, the real "monkey monster" bake replaces `monkey-tomk.glb` and
  this ADR's *what shipped* paragraph gets a follow-up note. Registry shape
  doesn't change. `defaultCharacterId` stays as the new id (likely
  `shroom-knight` or whatever creature DWEA-21 produces).
- **Animation library.** When T2 (DWEA-17) wires the registry into the
  scene, the dance button will play a 2-second hip bob. If the visual
  doesn't read as "dance" we revisit by either (a) splicing additional
  Mixamo clips onto this rig with a one-time Blender retarget hand-off, or
  (b) re-exporting from the OGA FBX with a different action name (the FBX
  may carry more takes that assimpjs lost). Both are out of scope for this
  ADR.
- **Sketchfab fallback path.** If we end up wanting a richer monkey before
  Meshy lands, provision a Sketchfab API token (governance shape mirrors
  `MESHY_API_KEY`). Strongest CC-BY candidates from the 2026-04-30 search:
  - `MONKEY` (uid `8955fb5b9c9b4e169456ccbae7c465f7`) by *dinesdiabolik* —
    40 anims.
  - `Agile Monkey` (uid `3a0bd32849834cafb84269f7512e410b`) by *LopesVitor*
    — 6 anims, leaner clip set.
  - `Chef Monkey Rig` (uid `e1d80aab6ad841c7b434c9fef5b0f913`) — 11 anims.
- **License surface.** ADR 0003 / 0006 already flagged that we store
  license-of-record in a `credit` string instead of a structured field.
  Adding the OGA CC0 monkey doesn't change that, but the credit string is
  now the only place the FBX→GLB conversion gets called out at runtime.
  When we structure the field, the conversion provenance moves with it.

## Consequences

- New runtime artifact: `public/characters/monkey-tomk.glb` (2.24 MB) and
  `public/characters/monkey-tomk.LICENSE.txt`.
- New build helper: `scripts/bake-monkey-tomk.cjs`. First per-asset bake
  script in the repo; sibling to `add-character.sh` rather than a
  replacement for it.
- New unit test: `src/characters/registry.test.ts`. Asserts the monkey is
  the new default, the robot is still registered, the monkey ships exactly
  the `Dance` clip classified as `oneshot/loop=true`, and `resolveCharacterUrl`
  works against both common base URLs.
- Registry change: `defaultCharacterId` flips to `monkey-tomk`. Any scene
  or test that hard-coded `'robot-expressive'` continues to resolve it
  via `findCharacter`, but the default-character path now hits the monkey.
- Repo grows ~2.3 MB for the GLB + LICENSE. ADR 0003 / 0006's storage
  cutoff (~25 MB / 10 MB respectively) stays the binding signal for when
  to migrate `public/characters/` off git.

## When this stops being right

- DWEA-21 ships a real Meshy bake. This ADR's *what shipped* paragraph
  gets a follow-up; `defaultCharacterId` flips to whatever the real bake
  is named.
- The dance-only clip set proves too thin for the demo and we add a second
  clip without retiring the monkey. At that point the registry test's
  exact-count assertion needs to grow with the asset.
- Sketchfab credentials land and we want richer mocap (40-anim `MONKEY`
  rig). Same shape as the Meshy unblock — a per-asset bake script, an
  ADR follow-up, a registry flip.
