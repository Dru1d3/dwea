# dwea

3D websites built on point clouds and gaussian splatting, with agentic NPCs.

## Requirements

- Node.js ≥ 20.11
- pnpm 10 (via Corepack: `corepack enable`)

## Getting started

```sh
pnpm install
pnpm dev          # local app at http://localhost:5173
pnpm build        # produces dist/
pnpm preview      # serves the built dist/ on http://localhost:4173
pnpm check        # typecheck + lint + test + build (the CI gate)
```

The dev page renders a single gaussian splat scene (`nike.splat` from
Hugging Face) on a full-bleed canvas. See
[`docs/decisions/0002-splat-renderer.md`](docs/decisions/0002-splat-renderer.md).

## Layout

- `src/` — app source. Entry: `src/main.tsx` → `src/App.tsx` →
  `src/SplatScene.tsx`.
- `index.html` — Vite entry.
- `docs/decisions/` — architecture decision records. Start with
  [`0001-stack.md`](docs/decisions/0001-stack.md).
- `.github/workflows/ci.yml` — single CI workflow.
- `vercel.json` — static SPA config for Vercel deploys.

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
