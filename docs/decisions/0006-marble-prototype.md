# 0006 — World Labs Marble prototype (asset-pipeline amendment)

- Status: in_progress (prototype pending API key)
- Date: 2026-04-29
- Owner: Founding Engineer (acting CTO)
- Issue: [DWEA-10](/DWEA/issues/DWEA-10)
- Amends: [0003-asset-pipeline.md](0003-asset-pipeline.md)
- Pivots from: [docs/research/genie-integration.md](../research/genie-integration.md)

## Context

[DWEA-9](/DWEA/issues/DWEA-9) recommended pivoting from Genie 3 (no public
API, no SDK, no weights) to **World Labs Marble** for text/image → 3D world
generation. Marble exports gaussian splats and our drei `<Splat>` renderer
already consumes splats, so the integration path is "asset pipeline only" —
no backend, no edge function, no renderer change.

The board approved up to $20 of R&D spend for this prototype on
[DWEA-10](/DWEA/issues/DWEA-10) (`$5` minimum buy + ~10 generations at
`$1.20`/world via `marble-1.1`).

This ADR documents the prototype outcome and amends [ADR
0003](0003-asset-pipeline.md) with the converter step the v1 ADR predicted
("when asset processing becomes non-trivial — e.g. PLY → SPLAT — the bash
script becomes a proper CLI").

## Decision

### Generation: API-driven, build-time, no backend

A two-script chain runs on the developer's machine, never in production:

```sh
# 1. Generate one Marble world (text or panorama prompt).
MARBLE_API_KEY=... scripts/marble-generate.sh text  marble-text   "<prompt>"
MARBLE_API_KEY=... scripts/marble-generate.sh pano  marble-pano   "<https://…/pano.jpg>"

# 2. Pipe the .ply URL emitted in step 1 into the asset pipeline.
scripts/add-splat.sh marble-text  "<ply_full_res_url>"
scripts/add-splat.sh marble-pano  "<ply_full_res_url>"
```

`marble-generate.sh` POSTs `/marble/v1/worlds:generate`, polls
`/marble/v1/operations/{id}` every 15 s until `done=true`, then prints the
PLY and SPZ URLs. `add-splat.sh` (extended in this ADR) downloads the PLY
and converts it to `.splat` via `scripts/ply-to-splat.mjs`.

### Format: PLY → .splat at build time

Marble exports SPZ (native, ~2 M splats compressed) and PLY (~2 M splats
uncompressed). drei `<Splat>` consumes only the antimatter15-format
`.splat` binary (32 bytes/splat). We chose:

- **PLY** as the import format — broadest tool compatibility, well-known
  3DGS field set (`x/y/z`, `f_dc_*`, `opacity`, `scale_*`, `rot_*`).
- Convert to `.splat` once at build time via `scripts/ply-to-splat.mjs`
  (pure-Node ESM, zero deps). Conversion is lossy on the SH coefficients
  beyond degree 0 — we keep only diffuse colour, which is what drei
  `<Splat>` renders today anyway.
- Store the `.splat` in `public/splats/<id>.splat` like every other asset.
  The PLY is not committed; only the converter output ships.

We did **not** adopt SPZ directly because:

- drei `<Splat>` does not consume SPZ. Adopting SPZ requires either a
  client-side SPZ→splat decoder or a renderer migration to Spark, which is
  out of scope for this prototype (separate ADR).
- The `.splat` format is the established asset pipeline. Keeping Marble
  outputs on the same path keeps the registry homogeneous.

### Coordinate system

Marble worlds use the OpenCV convention (+x left, +y down, +z forward).
Our existing `<SplatScene>` already applies a `[Math.PI, 0, 0]` rotation
group (Y-flip) for the cakewalk/splat-data convention. For Marble assets
the **registry transform overrides this** with the rotation that lands
the world right-side-up on the orbit camera. Recorded values per scene
below.

## Outcome

> _PROTOTYPE NOT YET RUN — API key pending from founder. The numbers below
> are placeholders; this section is filled in during the heartbeat after
> the key arrives. See ["When the key arrives"](#when-the-key-arrives)._

### Cost

| Scene         | Prompt type | Model        | Credits | USD     |
| ------------- | ----------- | ------------ | ------- | ------- |
| `marble-text` | text        | marble-1.1   | TBD     | TBD     |
| `marble-pano` | panorama    | marble-1.1   | TBD     | TBD     |
| **Total**     |             |              | **TBD** | **TBD** |

### Wall-clock

| Scene         | Submit → done | PLY download | PLY → .splat | Total |
| ------------- | ------------- | ------------ | ------------ | ----- |
| `marble-text` | TBD           | TBD          | TBD          | TBD   |
| `marble-pano` | TBD           | TBD          | TBD          | TBD   |

### File sizes

| Scene         | PLY (full-res) | .splat output | Splat count |
| ------------- | -------------- | ------------- | ----------- |
| `marble-text` | TBD            | TBD           | TBD         |
| `marble-pano` | TBD            | TBD           | TBD         |

### Quality / artefact notes

- `marble-text`: TBD
- `marble-pano`: TBD

### Frame budget on `pnpm dev`

Target: 60 fps (per [ADR 0002](0002-splat-renderer.md)). Comparison scenes:
`nike`, `plush`, `garden`, `treehill`. TBD numbers.

### Verdict

> **YES / NO / CONDITIONAL — TBD.**
>
> One-line guidance for "Marble vs. capture" — TBD.

## When the key arrives

The next heartbeat after the founder drops `MARBLE_API_KEY` in
[DWEA-10](/DWEA/issues/DWEA-10) follows this exact sequence:

1. `export MARBLE_API_KEY=…` (read from the comment, never committed).
2. Generate the text scene:
   `scripts/marble-generate.sh text marble-text "$TEXT_PROMPT"` — note
   credits used + wall-clock; capture the JSON summary it prints.
3. Generate the pano scene:
   `scripts/marble-generate.sh pano marble-pano "$PANO_URL"` — same
   capture.
4. For each scene, run `scripts/add-splat.sh <id> <ply_full_res_url>`.
   Note PLY size, .splat size, splat count, conversion time.
5. Update `src/splats/registry.ts` with both entries — orientation/scale
   transforms tuned to land the world on the default orbit (likely a
   `[0, Math.PI, 0]` or `[Math.PI / 2, 0, 0]` rotation given Marble's
   OpenCV convention; tuned in dev).
6. Run `pnpm dev`, eyeball each scene side-by-side with `garden` and
   `treehill`, capture FPS in DevTools Performance panel and any visible
   artefacts.
7. Fill in every "TBD" above. Pick the verdict. Commit. Update
   [DWEA-10](/DWEA/issues/DWEA-10) → `done` with the verdict in the close
   comment.

## Open items

- **Backend integration is out of scope.** This ADR explicitly does not
  open Marble as a runtime API — that needs the Vercel access ADR + a
  paid-key-handling story first. Today's Marble is a build-time content
  pipeline only.
- **SPZ adoption.** If we move to Spark or land a client-side SPZ
  decoder, we revisit and probably drop the PLY → .splat conversion.
  Tracked separately if/when that work is queued.
- **Prompt iteration cost.** Marble at $1.20/world means iterating on a
  bad prompt is cheap individually but adds up — a $20 budget is ~16
  generations. We plan ahead, not iterate blindly.
