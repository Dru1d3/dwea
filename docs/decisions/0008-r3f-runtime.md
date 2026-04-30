# 0008 — r3f character runtime: ecctrl + Rapier + three-ik

- Status: accepted
- Date: 2026-04-30
- Owner: [Founding Engineer](/DWEA/agents/foundingengineer)
- Issue: [DWEA-17](/DWEA/issues/DWEA-17)
- Implements: [`plan` rev 1](/DWEA/issues/DWEA-12#document-plan)

## Context

T2 of the [DWEA-12](/DWEA/issues/DWEA-12) pipeline wires the agentic-character
runtime into the existing splat app. The plan picked **ecctrl** for the
character controller, **@react-three/rapier** for physics, **three-stdlib** for
loaders, and a thin **three-ik** wrapper for `look_at` / `point_at` IK.

Two surprises during integration drove the decisions below.

## Decision

### Compatibility-pinned dependency set

The plan's "active" snapshot (`Rapier ≥2.2.0`, `ecctrl@1.0.97`) requires
**React 19** and **@react-three/fiber 9**. The existing splat app is on
**React 18** + **R3F 8**; upgrading was out of scope for T2 and would have
forced a re-validation of every shipping splat scene. We pinned to the last
versions in each package's R3F-8 / React-18 line:

| Package | Pinned | Plan target | Reason |
|---|---|---|---|
| `@react-three/rapier` | `1.5.0` | `≥2.2.0` | 2.x requires R3F 9 / React 19. |
| `ecctrl` | `1.0.92` | `1.0.97` (latest) | 1.0.94+ requires R3F 9 / React 19. |
| `three-stdlib` | `2.36.1` | `≥2.36.x` | matches plan. |
| `three-ik` | `0.1.0` (vendored) | n/a | upstream is unmaintained; see below. |

When the rest of the stack moves to React 19 / R3F 9 (its own dedicated
issue), Rapier 2 + ecctrl 1.0.97 are a one-line bump.

### Vendored, patched three-ik

Upstream `three-ik@0.1.0` ships a 2018-era ESM build that imports
`ConeBufferGeometry` and the `Math` namespace from `three`. Both were removed
in modern three.js (we are on `three@0.170.0`). The package is unmaintained so
patching upstream is a non-starter.

We vendor the module under `src/character/vendor/three-ik.js`, with a two-line
patch (`ConeBufferGeometry` → `ConeGeometry`, `Math` → `MathUtils`) and
hand-written `.d.ts` declarations for the surface our wrapper uses. The
algorithmic body is verbatim from upstream so future bug fixes can be
ported by diffing the source.

This is the "fork-or-fix budget" the plan called out as acceptable.

### ecctrl type re-export patch

`ecctrl@1.0.92`'s shipped `Ecctrl.d.ts` re-exports `EcctrlJoystick` from
`../src/EcctrlJoystick.tsx` — a 2018-era TSX file outside the `dist/` tree.
With our `strict` + `exactOptionalPropertyTypes` config, that file fails
compilation despite being unused. We use `pnpm patch` to comment out the
re-export. The patch is committed at `patches/ecctrl.patch`.

### Architecture (T2 surface)

- **Physics.** `<Physics>` from `@react-three/rapier` lives under `<Suspense>`
  in the Canvas tree (WASM init defers to the render loop). A static cuboid
  collider matches the splat scene's `navigation.groundY`, so the floor reads
  as solid for any of our shipping scenes.
- **Character controller.** `<Ecctrl>` wraps a stub humanoid hierarchy. We
  set `disableFollowCam` so the existing `OrbitControls`-based `CameraRig`
  stays in charge of the camera. WASD + jump come from `<KeyboardControls>`
  with the keymap ecctrl expects.
- **Stub humanoid.** Programmatic Object3D hierarchy with named bones —
  `pelvis / spine / chest / head / rShoulder / rElbow / rWrist / …`. Visual
  shapes are capsules. T1's GLB drops in by name once it ships; the names
  are public schema.
- **AnimationMixer.** Hand-rolled `AnimationClip`s with KeyframeTracks
  targeting bones by name (`rHip.quaternion`, `pelvis.position[y]`, …).
  Names match ecctrl's `AnimationSet` slots (`idle`, `walk`, `run`, `jump`,
  `fall`, `action1`) so swapping to `<EcctrlAnimation>` is a rename.
- **IK wrapper** (`src/character/ik.ts`). Two solvers exposed via
  `createIKControls(humanoid)`:
  - `LookAtIK` — chain `pelvis → spine → chest → head → tip`.
  - `PointAtIK` — chain `rShoulder → rElbow → rWrist → tip`.
  Each owns a target Object3D and exposes
  `lookAt(obj) / lookAtPoint(v) / releaseLookAt()` and the same shape for
  `pointAt`. The host calls `ik.tick()` once per frame in `useFrame`, after
  the AnimationMixer.
- **Intent surface** (`src/character/intent.ts`). Typed module exporting
  `CharacterIntent`, `CharacterIntentSurface`, and the schema metadata
  T3 will register with the LLM. `speak` is a stub — T4 owns Web Speech.

### Browser-console handle

A `CharacterIntentBridge` inside `<Canvas>` binds the intent surface to
`window.dwea` on mount. Acceptance criteria 2–4 are exercised from DevTools:

- `dwea.lookAtCamera()` — head IK tracks the orbit camera.
- `dwea.pointAt({ x, y, z })` — right arm points at a world position.
- `dwea.playAnimation('walk', 'interrupt')` — cross-fade into walk.
- `dwea.moveTo({ x, y, z })` — teleport via Rapier `setTranslation`.

## Consequences

- The character co-exists with the existing Mara spirit-NPC. T3 wires the
  LLM motor against the intent surface; T4 records the smoke demo. The
  Mara click-to-walk path is left untouched.
- React 19 / R3F 9 / Rapier 2 upgrade is a separate issue; bumping ecctrl
  + rapier on that branch will let us delete the ecctrl pnpm patch.
- The vendored three-ik copy is small but ours to maintain. If three-ik
  ever proves a regression source, the next move per the plan is fork-or-fix.

## References

- [DWEA-12](/DWEA/issues/DWEA-12) — pipeline rollout
- [`plan` rev 1](/DWEA/issues/DWEA-12#document-plan)
- [DWEA-17](/DWEA/issues/DWEA-17) — this task
- ecctrl: <https://github.com/pmndrs/ecctrl>
- @react-three/rapier: <https://github.com/pmndrs/react-three-rapier>
- three-ik: <https://github.com/jsantell/THREE.IK>
