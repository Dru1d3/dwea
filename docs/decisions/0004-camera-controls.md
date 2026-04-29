# 0004 — Camera, controls, and the "navigable" environment

- Status: accepted
- Date: 2026-04-29
- Owner: Founding Engineer (acting CTO)
- Issue: DWEA-4
- Builds on: [0002-splat-renderer.md](0002-splat-renderer.md)

## Context

DWEA-4 asks the user to be able to move around the splat scene from DWEA-3.
The issue lets us pick first-person or orbit, requires that pointer-lock or
touch input both work in some form, and asks us to keep the frame budget
unchanged from the DWEA-2/3 baseline (60fps target, fallback ladder in
`0002-splat-renderer.md`).

At this stage the "scene" is a single splat capture floating in space. There
is no traversable environment, no NPCs, no collision geometry. The
interaction we are unlocking is **"look at this thing from any angle and get
close"**, not **"walk through a place."**

## Decision

We use **`<OrbitControls>` from `@react-three/drei`**, mounted as the default
controls (`makeDefault`), targeted at the world origin where the splat is
centered. We add basic three-light fill (ambient + hemisphere + directional)
and an infinite faded grid as a ground plane to anchor the splat in space,
plus a small CSS HUD with the input legend.

We deliberately **do not** use `<PointerLockControls>` or `<FirstPersonControls>`
yet. Pointer-lock makes sense once there is somewhere to walk to and someone
to walk toward (DWEA-5+).

### Component layout

| File | Responsibility |
| --- | --- |
| `App.tsx` | Mounts `<Canvas>`, sets fog/background/camera, composes children, mounts the HUD outside the canvas. |
| `Environment.tsx` | Lights and the ground grid. Anything that gives the scene "a sense of place." |
| `SplatScene.tsx` | Just the `<Splat>` and the orientation flip. No more idle rotation — the user moves now. |
| `CameraRig.tsx` | Owns `<OrbitControls>`, target, damping, distance limits. |
| `Hud.tsx` | DOM-side overlay; pointer events disabled so it never intercepts orbit input. |

This split exists so the next PR (NPCs, swap to first-person walking, asset
streaming) does not have to surgically edit a 100-line `App.tsx`.

## Why orbit (and not pointer-lock / first-person yet)

- **Orbit fits the current scene.** "Look at the captured object from
  multiple angles" is the entire UX today. Orbit is the canonical control
  scheme for that interaction across the splat-rendering ecosystem
  (gsplat.js demos, Luma viewer, PlayCanvas SuperSplat viewer). Users
  already know it.
- **Single code path covers mouse, trackpad, and touch.** Drei's
  OrbitControls speaks pointer events and supports one-finger rotate /
  two-finger pan / pinch zoom natively. We do not have to ship a separate
  touch joystick to satisfy the "pointer-lock or touch controls work"
  acceptance criterion.
- **Pointer-lock has UX friction at this stage.** Pointer-lock requires an
  explicit gesture (click) to engage, hides the mouse, and is desktop-only;
  on mobile it falls back to nothing. With one splat in a void, paying that
  UX cost buys nothing. We will revisit when there is an actual environment
  to traverse and when the cursor needs to be reserved for look while
  on-screen UI handles HUD interaction.
- **Rebindable later, by design.** Controls live in their own component
  (`CameraRig.tsx`). Swapping in `<PointerLockControls>` plus a WASD hook,
  or `<FlyControls>`, is a localized change. We are not building an input
  abstraction layer ahead of needing one.

### Alternatives considered

- **`<PointerLockControls>` (drei).** First-person mouse-look. Right
  primitive for FPS-style traversal. Rejected today because there is
  nothing to traverse and no touch story.
- **`<FirstPersonControls>` (three / drei).** Always-active mouse-look
  without pointer lock. Tends to feel jittery and is rarely the production
  choice; mostly useful as a quick prototype.
- **`<FlyControls>` (drei).** Free-flight WASD + mouse. Useful for
  inspecting captures during asset work; over-powered for an end-user
  facing splat viewer.
- **`<MapControls>` (drei).** Top-down panning. Wrong shape for "inspect
  a 3D capture from any angle."
- **`<CameraControls>` (drei).** Yamato Nakajima's library; richer feature
  set than OrbitControls (smooth dollying, fitTo, animated transitions).
  Strong long-term candidate when we add cinematic NPC focus / "go look at
  this" camera moves. Rejected for now to avoid over-fitting before we
  have those affordances.
- **Hand-rolled controls on top of three.** Premature. We do not yet have
  any input contract that the off-the-shelf controls cannot satisfy.

## Sense-of-place additions

The splat alone reads as "model floating in a void." We add the cheapest
possible scene context:

- **Lights:** ambient (`0.6`), hemisphere (cool sky / warm-dark ground at
  `0.5`), and one directional key (`0.9`). This is fill for the (future)
  meshes — the splat itself bakes its own lighting and ignores scene
  lights.
- **Ground:** drei `<Grid>` at `y = -1.6` with `cellSize = 0.5`,
  `sectionSize = 2.5`, infinite + fade. The fade prevents the moiré
  horizon and gives the user a depth cue while orbiting.
- **Background and fog:** near-black background (`#05060a`) with linear
  fog 18→36 to soften the grid horizon and to give the scene a defined
  "edge" without walls.

The grid is non-interactive scenery, not a collider — there is nothing to
collide with yet. When we add traversal we will revisit (likely a
ground-truth mesh from a separate capture, with rapier).

## Frame budget

DWEA-2/3 baseline: 60fps on a recent laptop with the canonical `nike.splat`
asset, DPR capped at 2, antialias off, `powerPreference: 'high-performance'`.

Additions in this issue and their cost:

- 3 lights: lights have no per-fragment cost in our render path because the
  splat is a custom shader pass and the grid uses a screen-space shader.
  Effectively free.
- `<Grid>`: one screen-space shader pass. Sub-millisecond on the target
  laptops; trivial cost for the depth cue it provides.
- `<OrbitControls>`: per-frame damping update on a single matrix; not
  measurable.
- HUD: one absolutely-positioned div, no React re-renders during orbit
  (the canvas owns the loop, the HUD is static markup).

We expect zero meaningful change vs. the DWEA-3 baseline. If a target
device drops below 60fps after this change specifically, the first knob is
to disable `<Grid>` (it is already faded out at distance) before touching
any of the splat-side fallbacks documented in `0002-splat-renderer.md`.

## Consequences

- The idle splat rotation that existed in DWEA-3 is gone — the user moves,
  not the model.
- Default camera moved from `[0, 0, 4]` to `[2.4, 1.2, 4]` so the user
  lands on a slightly raised, off-axis view that immediately reads as
  "this is 3D, not a billboard."
- `Environment.tsx`, `CameraRig.tsx`, and `Hud.tsx` are new component
  seams. Future first-person mode is "swap `CameraRig.tsx`" + add input
  hook; future NPCs land inside the canvas alongside `<SplatScene />`.

## Open items (carried forward)

- First-person walking with pointer lock + touch joystick — DWEA-5 or
  follow-up once there is an actual environment.
- Mobile control affordances beyond pinch/pan (e.g., a dedicated reset
  button if users get lost) — defer until we have user reports.
- A "reset camera" affordance in the HUD — defer; one knob at a time.
