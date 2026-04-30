# 0006 — Character asset pipeline (v1)

- Status: accepted
- Date: 2026-04-30
- Owner: Founding Engineer
- Issue: DWEA-16 (T1 — asset bake pipeline)
- Builds on: [0003-asset-pipeline.md](0003-asset-pipeline.md)
- Supersedes (in part): the AccuRIG + Mixamo steps in [DWEA-12 `plan` rev 1](https://github.com/Dru1d3/dwea/issues/12)

## Context

The plan for DWEA-12 specified a Meshy.ai → AccuRIG 2 → Mixamo bake pipeline:
generate the mesh, rig it in AccuRIG (a free desktop GUI), retarget ~10
Mixamo + ActorCore animation clips, then export a single GLB with embedded
`AnimationClip`s and commit it under version control. The Mixamo source
clips were also to be mirrored as a vendor-shutdown hedge.

DWEA-16 inherited that plan and was assigned to the FoundingEngineer agent,
which runs headless in a Linux container. Three of the prescribed steps are
not executable from that environment, regardless of credentials or budget:

1. **AccuRIG 2 has no headless mode.** Reallusion ships AccuRIG as a
   Windows/macOS GUI desktop application. There is no CLI, no Docker image,
   no API. The plan acknowledged this — "this is a manual asset-bake step
   in MVP, not a runtime call" — but assigned the manual step to an AI
   agent.
2. **Mixamo requires an Adobe ID logged-in browser session.** The Mixamo
   library has no public API; clip downloads gate through a Single-Page
   Application that issues short-lived signed URLs after browser login.
3. **ActorCore requires Reallusion desktop apps** (iClone / Character
   Creator). Same shape as AccuRIG.

A separate constraint surfaced during pre-flight: **Meshy's
`/openapi/v1/rigging` endpoint is humanoid-only.** The docs are explicit —
"programmatic rigging currently only works well with standard humanoid
(bipedal) assets with clearly defined limbs and body structure." That makes
the prompt choice load-bearing for any future Meshy bake; non-humanoid
prompts (a four-armed swamp imp, a horned forest sprite with a tail) will
fail or produce a broken rig and need to be re-evaluated against the rig
endpoint, not just the mesh endpoint, before the bake is attempted.

## Decision

### Three paths considered

The board approved three options on DWEA-16 (approval `26fa15bf`):

- **Path A — Meshy-only API.** Drop AccuRIG and Mixamo from MVP scope.
  Use Meshy's HTTP API end-to-end: `text-to-3d` (preview → refine) → `rig`
  → N × `animate` → merge per-animation GLBs into one with
  `@gltf-transform/cli merge` → commit. Same `$25/mo` budget envelope the
  board already approved. Fully agent-executable headless.
- **Path B — Original plan with a human operator.** Hire a human to run
  AccuRIG + Mixamo + ActorCore. Slip downstream tickets while procurement
  resolves. Rejected by the CEO and board: trades a real timeline cost for
  marginal v1 fidelity gain.
- **Path C — CC0 stub for v1, real Meshy bake as a follow-up.** Drop in a
  CC0-licensed pre-rigged GLB with embedded animations to unblock T2/T3/T4
  immediately; track the real Meshy bake on a child issue, gated on
  `MESHY_API_KEY` provisioning.

Board approved Path A primary with Path C as a 24-hour fallback if the API
key did not land in the agent's environment in time. The key did not land
in time, so this v1 ships under **Path C**.

### Path C details (what shipped)

The asset is **`public/characters/robot-expressive.glb`** — Tomás Laulhé
(Quaternius)'s "Robot Expressive" model with Don McCurdy's facial
morph-target additions and FBX2glTF conversion. Licensed **CC0 1.0
Universal** (public domain), sourced from the three.js examples repository
(`mrdoob/three.js/examples/models/gltf/RobotExpressive/`). 454 KB on disk;
14 named `AnimationClip`s embedded:

- Locomotion: `Idle`, `Walking`, `Running`
- Gestures: `Wave`, `ThumbsUp`, `Yes`, `No`, `Sitting`, `Standing`
- One-shots: `Jump`, `WalkJump`, `Punch`, `Dance`, `Death`

That covers the variety the plan called for (locomotion + gestures +
one-shots) and exceeds the "~10 named clips" target. The asset is a
"robot" rather than a "monster" per the original prompt — accepted by the
CEO under the plan's monster-IP option (b) "CC0 / public-domain creature
concept".

### Repo conventions

Mirrors the splat pipeline established in
[ADR 0003](0003-asset-pipeline.md) so the codebase has one shape for
"versioned asset under `public/` with a typed registry":

- **Storage:** `public/characters/<id>.glb`. Same justification as
  splats — zero infrastructure, atomic deploy/rollback, cheap to migrate
  later by changing one resolver.
- **Registry:** `src/characters/registry.ts`. Typed
  `CharacterAsset[]` with an `id`, `label`, `source` (mirrors
  `SplatSource`), `credit`, a `clips` array (`{ id, label, kind, loop }`,
  where `kind` is `locomotion | gesture | oneshot`), and a
  `defaultClipId`. Downstream T2 and T3 code targets clips by `id`, which
  must match the GLB's baked `AnimationClip` names.
- **Add-asset script:** `scripts/add-character.sh <id> <source-url-or-path>`.
  Companion to `add-splat.sh`. Validates the GLB magic bytes, enforces the
  10 MB acceptance bar, prints a sha256, and points the caller at
  `gltf-transform inspect` to enumerate clip names for the registry.

Per-asset transform/scene-positioning fields are deliberately omitted from
v1. The character's spawn position is per-scene navigation data already
encoded on the splat asset (`SplatNavigation.npcSpawn`); whatever scale or
orientation tuning T2 needs to fit `robot-expressive` to existing splat
scenes lives in the renderer wrapper, not the asset registry. We add
fields here when a second character with a meaningfully different
coordinate system arrives.

### The `gltf-transform merge` step (deferred to Path A)

Path C shipped a single GLB that already had all clips embedded, so no
merge step ran in this v1. When Path A runs (see [DWEA-20]
follow-up), the per-animation-call shape of Meshy's `/openapi/v1/animations`
forces a merge: each `animate` call returns its own GLB containing the
rigged character with that one clip applied, not a single GLB
accumulating clips across calls. The acceptance criterion ("single GLB …
`animations` array of named clips") then requires merging the per-clip
GLBs back into the rigged base.

`@gltf-transform/cli merge` does this in one invocation:

```sh
npx --yes @gltf-transform/cli merge \
  rig.glb anim_idle.glb anim_walk.glb anim_run.glb ... \
  -o robot-expressive.glb
```

Used as a one-off `npx` invocation; not added as a project dependency.
The full Path A pipeline shape, including the merge step and the
per-stage credit telemetry, is documented in
[DWEA-16](https://github.com/Dru1d3/dwea/issues/16) comment thread —
copy that into a follow-up ADR if and when Path A actually runs.

## Constraints to carry forward

These bind any future character-asset work, regardless of pipeline:

1. **Path A is humanoid-only.** Meshy `/v1/rigging` rejects non-humanoid
   topology. Any v2 prompt that strays from "stout bipedal X" (the
   four-armed swamp imp and horned forest sprite from the original DWEA-16
   suggestions are both rig-endpoint failures) needs to be re-evaluated
   against the rig endpoint before the mesh stage runs, or it burns
   credits on a mesh that can't be auto-rigged.
2. **Single-GLB acceptance.** The asset registry assumes one GLB per
   character with all clips embedded. Per-clip GLBs and split
   `.gltf + .bin` files are out of scope; merge them with `gltf-transform`
   before pointing the registry at them.
3. **Clip names are public API.** `src/characters/registry.ts` lists clip
   `id`s that must match the AnimationClip names baked into the GLB
   exactly. Renaming a clip is a breaking change for the LLM motor's
   `play_animation(clip_id, mode)` tool surface; treat it as such.
4. **10 MB ceiling.** The `add-character.sh` script enforces this against
   the acceptance bar from DWEA-16. A character that needs to ship larger
   than 10 MB is the trigger to revisit storage (mirrors the
   ~25 MB threshold in [ADR 0003](0003-asset-pipeline.md) for splats,
   adjusted for character-asset realities).

## When this stops being right

- We need more than one character at a time, or per-character runtime
  variations (skins, attachments, IK rigs that differ across characters).
  Today's flat array works fine; when a "character variant" concept lands
  it's likely a small structural change rather than a re-architecture.
- We add v2's runtime auto-rig of user-uploaded creatures. That changes
  the storage and identity model entirely — assets are no longer
  versioned-with-the-repo, they're per-user uploads. This ADR does not
  cover that path.
- Clip count grows past ~30 per character. The flat `clips` array gets
  awkward to reason about; we'd want a categorized index keyed by
  `kind`, or a lookup helper that filters by category, or both.
- A Path A run produces a `shroom-knight.glb` (or similar) that supersedes
  this v1 stub. At that point this ADR's "what shipped" section gets a
  follow-up paragraph and `defaultCharacterId` flips. The registry shape
  doesn't need to change.

## Consequences

- New top-level directory: `public/characters/`. Mirrors `public/splats/`.
- New module: `src/characters/registry.ts`. Single source of truth for
  which characters exist, where their bytes live, and which clips they
  expose to the LLM motor.
- New script: `scripts/add-character.sh`. Companion to `add-splat.sh`.
  Same shape; same conventions.
- Repo gains a 454 KB binary (`robot-expressive.glb`). Inside the v1
  budget on every dimension (size, animation count, license, executable
  pipeline).
- The plan's "mirror Mixamo source clips into `assets/mixamo/`"
  deliverable is dropped under both Path A and Path C — Mixamo is not in
  the v1 dependency graph either way. The vendor-shutdown hedge that
  mirroring was meant to cover is now covered by "the committed GLB is
  the artifact": for the demo to keep working, no Mixamo round-trip is
  required.
- Path A remains the intended v1 character. The CC0 robot is a stub
  expressly tracked for replacement on the follow-up child issue once
  `MESHY_API_KEY` is provisioned.

## Open items

- **`MESHY_API_KEY` provisioning.** Tracked on the follow-up child issue
  of DWEA-16. Until the key lands, Path A cannot run.
- **Asset license-of-record surface.** ADR 0003 already flagged that we
  do not yet have a structured `license` field on assets — both the splat
  and character registries store license/credit text in a single `credit`
  string. When we mix license terms (CC0, CC-BY, proprietary captures,
  third-party assets) we expand into a structured field and surface it in
  the UI. Same plan applies here.
- **T2 (DWEA-17) integration.** This ADR ships the asset and the
  registry; it does not wire the character into a scene. T2 owns
  `useGLTF` integration, `AnimationMixer` setup, ecctrl + Rapier
  locomotion, and the three-ik wrapper.
