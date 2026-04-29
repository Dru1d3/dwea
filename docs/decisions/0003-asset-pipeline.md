# 0003 — Asset and content pipeline (v1)

- Status: accepted
- Date: 2026-04-29
- Owner: Founding Engineer (acting CTO)
- Issue: DWEA-6
- Builds on: [0002-splat-renderer.md](0002-splat-renderer.md)

## Context

DWEA-3 shipped the first splat scene, with the asset hardcoded to a Hugging
Face URL inside `<SplatScene>`. To bring our own captures into scenes, NPC
environments, and (eventually) procedurally placed worlds, we need a
predictable answer to:

1. Where does a splat live?
2. How does a splat get there?
3. How is a splat referenced from code?

The issue calls this out explicitly: "Do not over-engineer. A bash script +
README is fine for v1." This ADR codifies the v1 answer and the conditions
under which we revisit.

## Decision

### Storage location: the repo's `public/splats/` directory

For v1, splats live in `public/splats/` and ship inside the static deploy.

Why repo `public/`:

- **Zero extra infrastructure.** No bucket, no IAM, no signed URLs, no CORS
  config. The site already builds with Vite (`vite build` → `dist/`) and
  copies `public/` verbatim. Splats served from the same origin avoids the
  cross-origin issues that the Hugging Face sample papered over with HF's
  permissive CORS.
- **Same deploy story for sample and "real" content.** Adding a splat is a
  PR. Reverting one is `git revert`. Cache invalidation is whatever the
  static host gives us (Vercel: instant; GitHub Pages: a few minutes).
- **Cheap to migrate later.** When we outgrow the repo (see
  "When this stops being right" below), we change one resolver
  (`resolveSplatUrl` in `src/splats/registry.ts`) and move the bytes off the
  repo. Code call sites do not change.

Why **not** S3 / R2 / a dedicated CDN bucket for v1:

- Adds a credential dependency and a CORS config we do not have to maintain
  yet.
- We do not have any single asset that justifies it. The first real-world
  splat (`plush.splat`, ~9 MB, 281k splats) sits well below the threshold
  where repo size becomes an issue.
- Once we have signed asset URLs (private captures) or per-PR preview
  invalidation needs, Cloudflare R2 + a small Worker is the obvious next
  step. That is a future ADR, not this one.

Why **not** a CDN URL pasted into source (the DWEA-3 nike pattern):

- Coupling our scene to someone else's hosting. They can rate-limit, take
  the asset down, or change the URL.
- No way to atomically promote/rollback content with code.
- Hard to reason about licensing if a contributor adds an asset by URL.

We **keep** the Hugging Face nike URL as a registered remote asset to
preserve DWEA-3's behaviour and to demonstrate that the registry handles
both `public/`-hosted and remote-URL splats. New assets default to `public/`
unless there is a reason to prefer remote.

### "Add a new splat" workflow: `scripts/add-splat.sh`

A bash script wraps the boring parts:

```sh
scripts/add-splat.sh <id> <source-url-or-path>
```

What it does:

1. Validates `<id>` (lowercase + dashes, becomes URL slug + registry key).
2. Validates extension (`.splat` / `.ksplat`; fail fast on anything else).
3. Downloads (curl with `-fL` — follow redirects, fail on 4xx/5xx) or
   copies the source into `public/splats/<id>.<ext>`.
4. Sanity-checks the size (rejects sub-1 KB "404 saved as HTML" results).
5. Prints a sha256 and a registry stub the caller pastes into
   `src/splats/registry.ts`.

It does **not**:

- Convert formats. drei `<Splat>` already accepts `.splat` and `.ksplat`.
  If we need PLY → SPLAT later we add a converter step; today every source
  we use already provides a `.splat` or `.ksplat`.
- Auto-edit the registry. The registry is small enough that a paste is
  honest; auto-edits make code review harder for almost no time saved.

### Reference from code: `src/splats/registry.ts`

A typed registry of `SplatAsset[]`:

```ts
{ id: 'plush', label: 'Plush toy', source: { kind: 'public', path: 'splats/plush.splat' } }
{ id: 'nike',  label: 'Nike (drei sample)', source: { kind: 'remote', url: 'https://…/nike.splat' } }
```

Two source kinds:

- `kind: 'public'` — relative path under `public/`. Resolver prepends Vite's
  `import.meta.env.BASE_URL` so GitHub Pages (`/<repo>/`) and Vercel (`/`)
  both work without per-host code changes.
- `kind: 'remote'` — absolute URL. Used as-is.

Scene components consume only the resolved string URL — they do not know
where the bytes came from. Swapping a `public` asset for a `remote` one (or
vice versa) is a single line in the registry.

Routing wires it together: `App.tsx` reads `window.location.hash` to pick
the active asset id, looks it up in the registry, and renders
`<SplatScene src={…} />`. Two scenes ship today: `#/nike` (existing public
sample, unchanged) and `#/plush` (the first asset added via this pipeline).

## Real-world asset shipped: `plush`

Used the script end-to-end to validate the pipeline:

```sh
./scripts/add-splat.sh plush \
  https://huggingface.co/cakewalk/splat-data/resolve/main/plush.splat
```

Result: `public/splats/plush.splat` (8.6 MB, sha256 `80e0ae67…`,
~281k splats), reachable at `<base>/#/plush` once deployed.

The asset originates from the cakewalk/splat-data Hugging Face mirror of
the test scenes that ship with the original 3D Gaussian Splatting paper.
Licensed for research/demo use; we replace with our own captures before
any commercial deployment. Recorded in the registry's `credit` field.

## When this stops being right

This v1 holds until any of:

- A single splat clears ~25 MB and we add more than a couple of them. Repo
  size and `git clone` time start to matter; move to object storage + CDN.
- We need private/paywalled captures. Public folder cannot do that;
  signed URLs need a Worker / Lambda fronting the bucket.
- We need per-PR preview deploys with isolated asset sets and the same host
  cannot serve them cleanly.
- Asset processing becomes non-trivial (PLY → SPLAT, KSPLAT compression,
  thumbnail generation). At that point the bash script is replaced by a
  proper CLI (Node script under `scripts/` with tests).

When we move, the migration is bounded:

1. Upload `public/splats/*.splat` to the new home.
2. Change the registry entries from `kind: 'public'` to `kind: 'remote'`
   (or add a third kind for signed URLs).
3. Delete the files from `public/splats/`.
4. Update CI to run the asset uploader before `vite build` if needed.

Code call sites and scene components are untouched.

## Consequences

- New top-level directory: `public/splats/` (gitignored individually only
  if a specific asset must not ship; default is "checked in").
- New script: `scripts/add-splat.sh`.
- New module: `src/splats/registry.ts` (single source of truth for which
  assets exist and where they live).
- `<SplatScene>` becomes a pure renderer keyed off a `src: string` prop.
- `<App>` owns the scene-id-from-hash routing + a small switcher nav. No
  routing library added; if we ever need real routes we will revisit.
- Repo gains the first ~9 MB binary. We accept it; future captures held to
  the migration threshold above.

## Open items

- The DWEA-3 deploy currently runs against GitHub Pages (see the deploy
  update in [0002](0002-splat-renderer.md)). Asset URLs work because the
  resolver uses `import.meta.env.BASE_URL`. When Vercel is wired, no
  asset-pipeline change is needed.
- We do not yet have a "license-of-record" mechanism. Asset credit lives in
  the registry's `credit` field. When we start mixing licenses (CC-BY-NC,
  proprietary captures, third-party), expand into a structured `license`
  field and surface it in the UI.
