# DWEA CI image

Shared GitHub Actions container for DWEA's CI workflows.

- **Image:** `ghcr.io/dru1d3/dwea-ci:latest`
- **Base:** `mcr.microsoft.com/playwright:v1.49.1-jammy`
- **Built by:** [`.github/workflows/build-ci-image.yml`](../../.github/workflows/build-ci-image.yml) on push to `main` that touches `infra/ci/**`, plus manual `workflow_dispatch`.

## What's baked in

- Node 20 + npm (from the Playwright base)
- pnpm pinned to the `packageManager` version in `package.json` via corepack
- Chromium / Firefox / WebKit + their system libs (libglib, libnss, libX11, …) — closes the headless-browser gap that blocks the visual-gate harness on stock Ubuntu runners and inside agent containers.
- `ffmpeg` for §1 frame extraction, plus `jq`, `git`, `curl`, `build-essential`, `python3`, `optipng`, `pngquant`, `imagemagick` for visual-gate diff steps.

## What is *not* baked in

- **Brush 0.3 splat trainer** and **gsbox** (SPZ 4 conversion) install at workflow time once their release URLs are pinned in [DWEA-87](https://github.com/Dru1d3/dwea/issues) — they pull GPU-only dependencies that would inflate the image without buying anything for the day-to-day lint/typecheck/test/build path.

## Using it

In a workflow job:

```yaml
jobs:
  build:
    runs-on: ubuntu-latest
    container:
      image: ghcr.io/dru1d3/dwea-ci:latest
    steps:
      - uses: actions/checkout@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm check
```

`actions/setup-node` and `pnpm/action-setup` are unnecessary — the image
already provides Node 20 and pnpm at the version pinned in `package.json`.

## Updating the image

1. Edit `infra/ci/Dockerfile`.
2. Push to `main`. The build workflow tags `latest` plus the commit SHA and pushes to GHCR.
3. (Optional) bump the `PLAYWRIGHT_TAG` build-arg to follow upstream Playwright versions.
