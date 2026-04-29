# 0002 — Splat renderer and first deploy target

- Status: accepted
- Date: 2026-04-29
- Owner: Founding Engineer (acting CTO)
- Issue: DWEA-3
- Supersedes: none
- Builds on: [0001-stack.md](0001-stack.md)

## Context

DWEA-3 asks for the first publicly-deployed page that renders a single
gaussian splat scene. DWEA-2 already locked the broader stack (TypeScript,
pnpm, Vite-class app shell, React Three Fiber on top of Three.js). This ADR
picks the splat renderer and the static-deploy target, and commits the
sample asset for the first slice.

The hard constraints from the issue:

1. Pick a mainstream renderer; do not write splat math.
2. Load a public sample asset; we swap to our own assets later.
3. Single full-bleed canvas, no UI yet.
4. 60fps on a recent laptop, or document the fallback.
5. Static deploy on Vercel, Netlify, or Cloudflare Pages.

## Decision

### Renderer: `@react-three/drei` `<Splat>`

We use drei's `<Splat>` component to render a `.splat` asset inside an R3F
`<Canvas>`.

```tsx
import { Splat } from '@react-three/drei';
<Splat src="…/nike.splat" />
```

### Sample asset

`https://huggingface.co/cakewalk/splat-data/resolve/main/nike.splat`

This is the canonical drei `<Splat>` demo asset (~10 MB, ~360k splats). It
loads cleanly cross-origin from Hugging Face and is the asset used in drei's
own examples, so any rendering bug is much more likely to be _our_ bug than
the asset's.

We will replace this with our own captures once the asset pipeline lands.

### Deploy target: Vercel

Vercel is the default static host for Vite + React in 2026 and the lowest
friction option for a TypeScript-first team:

- Auto-detects Vite (`vite build` → `dist/`); no per-app build config.
- Free tier comfortably covers a static SPA with no SSR.
- Preview deploys per-PR once the GitHub repo is connected, which we will
  rely on before promoting to a stable URL.
- One-step rollback and instant cache invalidation on redeploys.

We commit a minimal `vercel.json` (SPA rewrite to `index.html`) so that any
team member or the CEO can connect the GitHub repo to a Vercel project and
deploy without further configuration. Repo connection itself is a
governance step (third-party account on the company's behalf) and is
escalated to the CEO on DWEA-3 — see the comment thread.

## Why drei `<Splat>` (and not the alternatives)

We evaluated four candidates against R3F-fit, maintenance health, asset
format support, and "could I have a working scene this afternoon."

- **`@react-three/drei` `<Splat>` (chosen).** Native R3F component, drops
  into the same scene graph as everything else (lights, NPC meshes, camera
  controllers from drei). Handles the loader, GPU upload, and the
  per-frame sort. `.splat` and `.ksplat` formats. Same maintainers as the
  rest of our stack — when something breaks we file one issue, not three.
- **`@mkkellogg/gaussian-splats-3d` (runner-up).** Mature vanilla
  Three.js library with strong perf, multiple format support
  (`.ply`/`.splat`/`.ksplat`), progressive loading, and good docs. Best
  pure renderer of the bunch. Ruled out as the _primary_ for the first
  slice because mounting it inside R3F means an imperative bridge
  (`useThree()` + manually attaching the viewer's scene into the R3F
  scene), which is exactly the kind of glue we want to avoid on day one.
  We keep it as our drop-in replacement if drei's component falls behind
  on perf or features — both speak the same `.splat` format, so swapping
  is a localized change inside `<SplatScene>`.
- **PlayCanvas Spark / SuperSplat.** Excellent splat tooling, but the
  runtime story is centered on PlayCanvas's engine; pulling Spark into a
  Three.js/R3F app is more integration work than it saves. Reconsider if
  we ever move our renderer baseline off Three.js (we do not plan to).
- **Luma `luma-web`.** Tightly coupled to Luma's hosted captures and
  Luma-flavored URLs. Fine for a prototype that uses Luma's library, wrong
  default for a generic asset pipeline we want to own.
- **`gsplat.js` (Aras P.).** Foundational reference implementation; drei's
  `<Splat>` and others are descended from it. Using it directly means
  re-implementing the R3F integration ourselves. Not the right level of
  abstraction for a product team.

We will **not** be writing splat math. If `<Splat>` ever produces wrong
output we file upstream and pin a known-good drei version; if perf is the
issue we drop one level to `@mkkellogg/gaussian-splats-3d`.

## Why Vercel (and not Netlify or Cloudflare Pages)

All three would work. The decision is mostly about defaults.

- **Vercel (chosen).** Made by the Next/Vite-adjacent crowd; the Vite
  preset is auto-detected; zero config for static SPA; preview URLs per
  PR; the dashboard is the most familiar to any React/TS hire we will
  bring on next.
- **Netlify.** Equivalent feature set for static. Slightly older, less
  React-3D ecosystem mindshare in 2026. No real reason to pick over
  Vercel for our case.
- **Cloudflare Pages.** Excellent performance (their network is the best),
  and we will likely move asset hosting to R2/Cloudflare for splats in the
  near future. But the build-and-bind story for Vite SPAs has slightly
  more papercuts than Vercel. We will revisit when we add a worker
  backend (LLM proxy / signed asset URLs) — Workers + Pages may become
  the right joint platform at that point.

This decision is reversible. The build output is a static `dist/` folder;
swapping hosts is a config change, not a rewrite.

## Performance budget and fallback

Target is 60fps on a recent laptop (M-series MacBook / RTX 3060+ Windows /
modern Chromebook with WebGL2) on the canonical `nike.splat` (~360k
splats).

- We render at devicePixelRatio capped to `min(window.devicePixelRatio, 2)`.
- We disable `antialias` on the WebGL canvas — splats do their own
  alpha-blended coverage, MSAA on top costs frame time for no win.
- We set `gl: { powerPreference: 'high-performance' }` on the R3F canvas.

If a target device falls below 60fps:

1. First fallback: lower the canvas DPR to 1 and reduce the splat budget
   (drei's `<Splat>` exposes `chunkSize`/`alphaTest`). Target 30fps
   sustained before any UX degradation.
2. Second fallback: switch to `.ksplat` (compressed) for the same scene,
   accepting the small visual quality hit.
3. Last resort: swap the renderer for `@mkkellogg/gaussian-splats-3d` and
   enable its progressive loading; this changes the import inside
   `<SplatScene>` only.

Numbers from the first deployed page will be captured in a follow-up
comment on DWEA-3 and tracked from there.

## Consequences

- New runtime deps: `react`, `react-dom`, `three`, `@react-three/fiber`,
  `@react-three/drei`. New build deps: `vite`, `@vitejs/plugin-react`,
  `@types/react`, `@types/react-dom`, `@types/three`.
- `pnpm build` (`vite build`) is now part of the CI gate alongside
  typecheck/lint/test.
- `dist/` is git-ignored; deploys are produced by `vite build`.
- Repo deploy target is Vercel via a connected GitHub repository; the
  `vercel.json` in the repo is intentionally minimal so that no Vercel
  CLI or token is required to author code — only to wire the project the
  first time.

## Open items (carried into DWEA-4 / DWEA-5)

- Camera controls and a navigable environment (DWEA-4).
- Dynamic agentic NPCs in the same scene (DWEA-5).
- Owned asset pipeline (capture → `.ksplat`) — not yet scheduled.
