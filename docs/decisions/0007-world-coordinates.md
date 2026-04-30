# 0007 — World coordinates and open-world framing

- Status: accepted
- Date: 2026-04-29
- Owner: Founding Engineer (acting CTO)
- Issue: [DWEA-11](/DWEA/issues/DWEA-11)
- Supersedes the orientation note in [0003-asset-pipeline.md](0003-asset-pipeline.md) and the
  Marble coordinate-system note in [0006-marble-prototype.md](0006-marble-prototype.md).

## Context

The default scene rendered upside down: the captured ground sat at the top of
the frame and the sky underneath. Camera reach was tight (max 14 m), the
background was near-black with fog kicking in at 18–36 m, and the synthetic
grid was anchored at `Y = -1.6`. None of that screamed "open world", and the
units were arbitrary — different from one scene file to the next.

Root cause of the upside-down render: the splat group wrapped every asset in
`rotation: [Math.PI, 0, 0]` ("flip Y-down to Y-up"). The cakewalk
antimatter15-format splats we render are already stored Y-up — drei's
`<Splat>` consumes them as-is — so that wrapper rotation actually flipped the
world _into_ Y-down. Removing it puts the captured ground back where Three.js
expects ground to be.

## Decision

### World convention (single source of truth)

- Right-handed coordinate system, **+Y is up**.
- **1 world unit = 1 metre.** Camera, NPC, splat, grid all share the same
  scale.
- Ground plane sits at **Y = 0**. NPCs float `NPC_FLOAT_OFFSET` metres above
  it. Camera initial position is `[6, 2.4, 10]` — chest-height-ish, set back
  enough to read as "standing in the world".
- Camera frustum: 60° vertical FOV, near `0.1` m, far `1000` m. Far is
  generous so distant horizon / sky stays visible.
- Camera bounds (orbit): `[1.5, 80]` m radius, polar angle clamped a few
  degrees shy of horizontal so the user can never roll the camera under the
  ground.

### Per-format rotation, not per-asset guesswork

- **cakewalk antimatter15-format `.splat`** (today: `garden`, `treehill`,
  `nike`, `plush`): identity rotation. drei `<Splat>` already renders these
  Y-up.
- **World Labs Marble exports** (when they land): OpenCV convention (Y-down).
  Each Marble asset opts back into the X-flip locally with
  `rotation: [Math.PI, 0, 0]`. No project-wide default rotation — flips live
  on the asset that needs them.

### Open-world framing

- Background color is pale sky (`#cfe2f3`) and drei's analytic `<Sky>` is
  drawn out at 450 km. Looking up from any angle, the user sees sky.
- Fog stays subtle (`60–280` m). Distant detail fades into the sky colour
  rather than into a black void; the world feels boundless even though the
  splat itself is finite.
- Synthetic ground grid extends 200 m × 200 m with infinite-grid extension,
  cell = 1 m, section = 10 m. Doubles as a metric reference and as a backup
  ground when a scene's photogrammetric ground is sparse.
- NPC click radius widens from 6 m → 12 m (default) so the user can direct
  Mara to walk meaningful distances.

### Per-scene navigation tuning

`groundY` defaults to `0`. Per-asset Y nudges (`transform.position[1]`) are
**not** the right knob — every splat capture has its own arbitrary origin
relative to the captured floor, and eyeballed offsets drifted noticeably
between scenes.

### In-page scene tuner

Some captures (e.g. Mip-NeRF 360 garden) are not gravity-aligned in their
own frame — auto-fit can put the cloud at the right Y but the floor is
still tilted relative to the metric grid. The agent has no browser, so
blind iteration on rotation values wastes review cycles.

`?tune=1` enables `<SceneTuner>`, a compact HUD with sliders for
position (XYZ), rotation (XYZ), and scale. While the tuner is
"override"-active for a scene, the registry transform AND auto-fit are
both bypassed; the user owns absolute values. Values persist per asset
in `localStorage` (`dwea.tuning.v1.<assetId>`). A "copy" button emits a
`transform: { ... }` literal that can be pasted back into the registry
to bake the values in.

Reset button restores registry + auto-fit defaults.

### Ground auto-fit

Every cakewalk asset opts into `groundFit: { percentile }`. On load,
`<SplatScene>` fetches the `.splat` file in parallel (browser HTTP cache
de-dups against drei's own load), reads the Y component of each row,
inverts to drei's rendered local Y (`-file_y`), sorts, and shifts the
group so the lower-percentile rendered Y lands at `groundY`. Outdoor
captures use `percentile: 2` to skip stragglers; tight object captures
(`nike`, `plush`) use `0.5`. The Y component of `transform.position`
stays at `0` and is owned by the fit. X/Z and scale/rotation still come
from `transform`.

This means new cakewalk assets need zero Y tuning — just declare the
asset and `groundFit` and the floor lines up with the metric grid.
Marble and other formats keep their own per-format rotation but can
opt into the same fit.

## Consequences

- The orientation note in ADR 0003 (asset-pipeline) is wrong from this date
  forward. Future asset additions should refer to ADR 0007 for world
  conventions and to ADR 0006 for the Marble-specific rotation override.
- Everything that hard-coded `-1.6` or `0.6` as a ground offset (movement
  constants, NPC default, click-plane default, grid default) now derives from
  the metric convention. Scene files override `groundY` only when the splat
  itself sits visibly off the floor.
- Tests that asserted Mara's bob height around `-1.0` now derive the
  expectation from `NPC_BASE_HEIGHT`, so future tweaks to the float offset
  don't require parallel test updates.

## Open items

- **Eye-height locomotion.** Today's camera is still orbit-only. A first-
  person walk mode (with collision against the splat ground) is a separate
  follow-up — call it "DWEA-12 candidate".
- **Marble verification.** ADR 0006's rotation prediction (likely
  `[Math.PI, 0, 0]`) is recorded on this ADR's "per-format rotation" rule.
  When Marble assets actually land, confirm against the captured world and
  amend if wrong.
- **Auto-fit tuning.** The lower-percentile heuristic is correct for
  garden/treehill/nike/plush. If a future asset has unusual splat
  density (e.g. dense ceiling, sparse floor) we may need a per-asset
  fixed-Y override or a different statistic (median minus N std-devs).
