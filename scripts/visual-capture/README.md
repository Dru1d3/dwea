# scripts/visual-capture

Headless visual gate for committed scene routes. Used by [DWEA-62](/DWEA/issues/DWEA-62) (lighting), reusable for [DWEA-60](/DWEA/issues/DWEA-60) (palette), [DWEA-61](/DWEA/issues/DWEA-61) (motion-curves), and any future visual review.

The harness deliberately does NOT spawn a server — orchestration is left to the caller so the same script works against `pnpm dev`, `pnpm preview`, a Paperclip workspace runtime URL, or any deployed preview.

## Quick start

Install the browser (one-time, per checkout):

```sh
pnpm install
npx playwright install chromium
```

Run a capture against an already-running preview:

```sh
# In one terminal:
pnpm build && pnpm preview --port 4173 --strictPort

# In another:
node scripts/visual-capture/capture.mjs \
  --url http://localhost:4173 \
  --scene garden \
  --out artifacts/hollow-after.png
```

## Args

| Arg | Default | Description |
|--|--|--|
| `--url` | required | base URL of the running app (no trailing route) |
| `--scene` | required | splat registry id (`garden`, `treehill`, `nike`, `plush`, …) — drives `#/<scene>` |
| `--out` | required | output PNG path (parents created if missing) |
| `--viewport` | `1280x800` | `WxH` viewport in CSS pixels |
| `--settle-ms` | `9000` | wall-clock ms to wait after networkidle before snapshot — bump on slow hosts |
| `--hide-ui` / `--keep-ui` | hide-ui | toggle UI-chrome CSS injection (`nav[aria-label="Splat scene"]`, ChatPanel, HUD, SceneTuner, etc.) |

Exit codes:

- `0` — PNG written.
- `1` — internal failure (network/launch/etc.); see stderr.
- `2` — canvas read-back was blank or near-uniform. Almost always means swiftshader could not run the Gaussian-splat shader; escalate to the board for a manual capture.

## Before/after pattern (DWEA-62)

```sh
# AFTER (current branch)
pnpm build && pnpm preview --port 4173 --strictPort &
node scripts/visual-capture/capture.mjs --url http://localhost:4173 --scene garden --out artifacts/hollow-after.png
kill %1

# BEFORE (clean main)
git worktree add /tmp/dwea-main main
( cd /tmp/dwea-main && pnpm install && pnpm build && pnpm preview --port 4174 --strictPort ) &
node scripts/visual-capture/capture.mjs --url http://localhost:4174 --scene garden --out artifacts/hollow-before.png
kill %1
git worktree remove /tmp/dwea-main
```

## Determinism notes

The harness gives you a *consistent enough* frame for review, not bit-exact reproducibility. Things that vary run-to-run:

- Splat densification ordering (cakewalk-format streamed splats).
- Mara's idle wander timer — the NPC may be in different X/Z positions across runs.
- Headless WebGL via swiftshader is slower and noisier than desktop GPUs.

If the visual gate ever needs bit-exact reproducibility, expose a debug `?freezeAt=<frame>` URL param in `App.tsx` and have the harness wait for `window.__dweaCaptureReady` before snapping. That belongs to a follow-up; not in scope for DWEA-62.
