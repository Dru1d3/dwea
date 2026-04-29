# 0001 — Initial stack

- Status: accepted
- Date: 2026-04-29
- Owner: Founding Engineer (acting CTO)
- Issue: DWEA-2

## Context

DWEA is building 3D websites on top of point clouds and gaussian splats, with
agentic NPCs that move around the scene and converse with the user. We need a
stack that:

1. Renders gaussian splats and meshes in the browser, performantly enough for
   real-time NPC animation.
2. Composes well with React-style UI (chat panel, HUDs, controls) without
   re-implementing the React tree inside Three.js.
3. Has a strong, mainstream ecosystem so a small team is not the maintainer of
   load-bearing libraries.
4. Stays TypeScript-first end to end.

## Decision

- **Language / runtime:** TypeScript on Node 20 LTS (≥20.11). ESM throughout
  (`"type": "module"`).
- **Package manager:** pnpm 10 via Corepack. Lockfile committed.
- **Linter / formatter:** [Biome](https://biomejs.dev) 1.9 (single binary,
  single config, lint + format + import organize). See trade-off below.
- **Test runner:** [Vitest](https://vitest.dev) 2.x.
- **3D framework:** **React Three Fiber (R3F) on top of Three.js**, with
  `@react-three/drei` for common helpers. Splatting via `@react-three/drei`'s
  `<Splat>` (Luma `luma-web` / `gsplat.js`-class libraries evaluated under
  DWEA-3).
- **CI:** GitHub Actions, single workflow, single job: install → typecheck →
  lint → test on push and pull_request.

## Why R3F (and not Three.js directly, or Babylon, or PlayCanvas)

We will have many small, stateful, intelligent NPCs in the same scene. Each
NPC has its own state machine, animation, dialogue, and tool-use loop. That is
exactly the surface React was built for: declarative composition, hooks for
local state, context for shared services (LLM client, world state, audio bus).

- **R3F (chosen):** declarative scene graph in JSX, hooks for the render loop
  (`useFrame`), first-class TypeScript types, huge ecosystem (`drei`,
  `rapier`, `xr`, `postprocessing`, `gltfjsx`). Sits on top of Three.js, so
  any imperative Three.js code we need is one ref away. The team a future
  hire will join almost certainly already knows React.
- **Three.js (vanilla):** ruled out as the *primary* layer. We still depend
  on it transitively through R3F. The vanilla API forces us to hand-roll a
  component model for NPCs and to bridge React for UI separately. More code
  for no clear win at our size.
- **Babylon.js:** ruled out. Excellent engine with strong tooling, but smaller
  splatting/community ecosystem in JS-first projects, and weaker React story.
  Not worth the ecosystem tax versus R3F.
- **PlayCanvas:** ruled out. Editor-centric, and the open-source engine has
  less mainstream pull in TypeScript-first webapps. Splatting support exists
  but the community center of gravity for browser splats is in the Three.js
  ecosystem.
- **Unity / Unreal via WebGL/WASM:** ruled out. Heavy bundles, slow page
  loads, and a different language toolchain. Wrong tool for "open URL,
  immediately see the scene."

We keep direct access to Three.js as our escape hatch for anything R3F does
not expose ergonomically (custom shaders, GPU-side splat manipulation, etc.).

## Why Biome (and not ESLint + Prettier)

The task allowed either. Both are mainstream in 2026. Biome wins for a brand
new repo because:

- One binary, one config file (`biome.json`). No `.eslintrc` / `.prettierrc` /
  `eslint-config-prettier` interplay to maintain.
- Roughly an order of magnitude faster on cold runs, which keeps `pnpm lint`
  cheap in CI and pre-commit.
- Format + lint + import organize in a single pass.

The trade-off is rule coverage: ESLint has a deeper plugin catalog (e.g.
`eslint-plugin-react`, `eslint-plugin-jsx-a11y`). When we hit a rule that
Biome does not yet implement and we genuinely need it, we will either layer a
targeted ESLint config for that subset or revisit. Switching is a one-day
migration; we are not betting the company on this choice.

## Why Vitest

- Native ESM + TypeScript.
- Same config language as the rest of the build (Vite-style `defineConfig`).
- Fast watch mode for the inner loop on shaders and NPC behaviour code.
- Drop-in `expect` API; works in Node and in `jsdom` / `happy-dom` if we need
  DOM-side tests later.

Node's built-in test runner was a viable second choice but lacks the
ergonomics around mocks, watch mode, and snapshot testing that we will want
once we are testing R3F components with `@testing-library/react`.

## Project layout

Single package for now. We expect to split the renderer, NPC agent loop, and
the deployable app into separate packages, but only when there is a real
boundary. Premature monorepo is a tax we do not need to pay this week.

```
.
├── biome.json
├── docs/decisions/
├── package.json
├── pnpm-lock.yaml
├── src/
│   └── index.ts          # smoke export
├── tsconfig.json
├── vitest.config.ts
└── .github/workflows/ci.yml
```

`pnpm-workspace.yaml` will be added when the first second package lands
(likely the deployable app in DWEA-3).

## Consequences

- Day-one workflow is `pnpm i && pnpm typecheck && pnpm lint && pnpm test`.
- Dependencies (`three`, `@react-three/fiber`, `@react-three/drei`, the
  splatting library, the Vite-based app shell) are intentionally **not**
  added in this commit. They land in DWEA-3 with the first deployed page so
  this issue stays scoped to "tooling green and CI green."
- Future revisits: if Biome rule coverage starts blocking us, layer ESLint
  for the affected files. If R3F's render loop becomes a bottleneck for
  splat-heavy scenes, we still own the Three.js layer underneath and can
  drop down without a rewrite.
