# dwea

3D websites built on point clouds and gaussian splatting, with agentic NPCs.

## Requirements

- Node.js ≥ 20.11
- pnpm 10 (via Corepack: `corepack enable`)

## Getting started

```sh
pnpm install
cp .env.example .env.local   # then paste your OpenRouter / Groq keys
pnpm dev          # local app at http://localhost:5173
pnpm build        # produces dist/
pnpm preview      # serves the built dist/ on http://localhost:4173
pnpm check        # typecheck + lint + test + build (the CI gate)
```

## Environment

`.env.example` documents every supported variable. The two that matter for
the chat / voice loop today:

| Var                   | What                                                                                       | Default             |
|-----------------------|--------------------------------------------------------------------------------------------|---------------------|
| `VITE_GROQ_API_KEY`   | Groq Whisper STT key. When set, push-to-talk uses Groq Whisper-large-v3-turbo (free tier). | unset → Web Speech  |
| `VITE_STT_PROVIDER`   | `groq` or `web-speech`. Forces a provider regardless of the key.                           | auto                |
| `VITE_STT_LANGUAGE`   | BCP-47 hint passed to Whisper, e.g. `de`. Omit for auto-detect.                            | auto-detect         |
| `VITE_OPENROUTER_MODEL` | Override the chat model. Default is the free OSS model documented in `personality.ts`.   | `openai/gpt-oss-120b:free` |

The OpenRouter API key for Mara's chat is entered through the in-app settings
dialog (it's stored in `localStorage`, never bundled). See
[`docs/decisions/0010-voice-mode-and-tool-calls.md`](docs/decisions/0010-voice-mode-and-tool-calls.md)
for the cost note and provider rationale.

The dev page renders a gaussian splat scene on a full-bleed canvas, with
orbit camera controls so the viewer can drag, zoom, and pan around it. The
active scene comes from a typed registry; the URL hash picks which one. See
[`docs/decisions/0002-splat-renderer.md`](docs/decisions/0002-splat-renderer.md),
[`docs/decisions/0003-asset-pipeline.md`](docs/decisions/0003-asset-pipeline.md),
and [`docs/decisions/0004-camera-controls.md`](docs/decisions/0004-camera-controls.md).

### Scenes

- `#/nike` — the original drei sample (`nike.splat`, fetched from Hugging Face).
- `#/plush` — first asset added through the local pipeline (`public/splats/plush.splat`).

The top-left switcher in the deployed app toggles between them.

### Controls

- **Drag** (mouse / one-finger touch) — orbit around the splat.
- **Scroll / pinch** — zoom in and out.
- **Right-drag / two-finger drag** — pan.

## Adding a new splat

```sh
scripts/add-splat.sh <id> <source-url-or-path>
# e.g. scripts/add-splat.sh livingroom https://example.com/livingroom.splat
# or   scripts/add-splat.sh livingroom ./captures/livingroom.splat
```

The script copies the asset into `public/splats/<id>.<ext>`, sanity-checks
the size, prints a sha256 + a registry stub. Paste the stub into
`src/splats/registry.ts`, commit `public/splats/<id>.<ext>` plus the
registry change, and the new scene is reachable at `<base>/#/<id>`.

Storage rationale (when `public/` is the right home, when to migrate to a
CDN/bucket) lives in
[`docs/decisions/0003-asset-pipeline.md`](docs/decisions/0003-asset-pipeline.md).

## Layout

- `src/` — app source. Entry: `src/main.tsx` → `src/App.tsx`. The canvas
  composes `SplatScene` (the splat), `Environment` (lights + ground grid),
  and `CameraRig` (orbit controls). `Hud` is a DOM overlay with the input
  legend.
- `index.html` — Vite entry.
- `docs/decisions/` — architecture decision records. Start with
  [`0001-stack.md`](docs/decisions/0001-stack.md).
- `.github/workflows/ci.yml` — CI gate.
- `.github/workflows/deploy-pages.yml` — GitHub Pages deploy (current host).
- `vercel.json` — static SPA config for Vercel deploys (when wired).

## Toolchain

| Concern        | Choice                                |
|----------------|----------------------------------------|
| Language       | TypeScript (ESM, `strict`)             |
| Package mgr    | pnpm 10                                |
| Lint + format  | Biome 1.9                              |
| Tests          | Vitest 2.x                             |
| App shell      | Vite 5 + React 18                      |
| 3D             | Three.js + React Three Fiber + drei    |
| Splatting      | drei `<Splat>`                         |
| Deploy         | Vercel (static SPA from `dist/`)       |

See [`docs/decisions/0001-stack.md`](docs/decisions/0001-stack.md) and
[`docs/decisions/0002-splat-renderer.md`](docs/decisions/0002-splat-renderer.md)
for the reasoning.

## Deploying

The build is a static SPA — `dist/` is the entire site. The repo ships a
`vercel.json` that auto-detects Vite and serves `dist/`.

To wire a Vercel project for the first time:

1. Push the repo to GitHub.
2. From the Vercel dashboard, "Add New… → Project → Import Git Repository".
3. Accept the auto-detected settings (Vite, `pnpm build`, `dist/`).
4. Deploy. Subsequent pushes deploy automatically; PRs get preview URLs.
