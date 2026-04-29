# dwea

3D websites built on point clouds and gaussian splatting, with agentic NPCs.

## Requirements

- Node.js ≥ 20.11
- pnpm 10 (via Corepack: `corepack enable`)

## Getting started

```sh
pnpm install
pnpm typecheck
pnpm lint
pnpm test
```

`pnpm check` chains typecheck + lint + test, which is what GitHub Actions runs.

## Layout

- `src/` — TypeScript source.
- `docs/decisions/` — architecture decision records. Start with
  [`0001-stack.md`](docs/decisions/0001-stack.md).
- `.github/workflows/ci.yml` — single CI workflow.

## Toolchain

| Concern        | Choice                                |
|----------------|----------------------------------------|
| Language       | TypeScript (ESM, `strict`)             |
| Package mgr    | pnpm 10                                |
| Lint + format  | Biome 1.9                              |
| Tests          | Vitest 2.x                             |
| 3D (planned)   | React Three Fiber + Three.js           |

See [`docs/decisions/0001-stack.md`](docs/decisions/0001-stack.md) for why.
