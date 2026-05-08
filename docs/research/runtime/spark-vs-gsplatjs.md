# Splat-runtime bench — Spark vs gsplat.js

**Issue:** [DWEA-55](/DWEA/issues/DWEA-55) (settles OD-3 in [DWEA-53#document-adr-v1-platform §4.1](/DWEA/issues/DWEA-53#document-adr-v1-platform)).
**Decide-by:** 2026-05-15.
**Owner:** [FoundingEngineer](/DWEA/agents/foundingengineer).
**Status:** harness shipped 2026-05-08 · awaiting on-device numbers (M1 Air + iPhone 12) before recommendation locks.

This note is the durable record. Frame-time numbers will be appended once the
harness has been run on each reference device; the methodology below is fixed.

## 1. What the bench measures

The harness lives in [`bench.html`](../../../bench.html) + [`src/bench/`](../../../src/bench/) and is served alongside the main app. One page load benchmarks one runtime; refresh and switch the `runtime` query param to compare.

Per [DWEA-55](/DWEA/issues/DWEA-55) acceptance criteria, each run records:

| Metric | How |
|---|---|
| Frame time p50 / p95 / p99 / mean | `requestAnimationFrame` deltas over a deterministic 60 s orbit, after a 2 s warmup. |
| First splat frame | `performance.now()` from runtime mount call → first rAF tick after `ready` resolves. |
| GPU memory estimate | `performance.measureUserAgentSpecificMemory()` (cross-isolated origins on Chrome) + `performance.memory.usedJSHeapSize` fallback. |
| WebGPU adapter info | `navigator.gpu.requestAdapter().info` (or older `requestAdapterInfo()`). |
| Asset sizing | source bytes, source splat count (32 B/record), tile count, effective splats post-duplication. |

Output is a JSON envelope (`schema: "dwea-55-bench/v1"`) with all of the above plus user-agent + viewport. The result panel exposes a **copy JSON** button so the operator can paste back a single block per device.

### Asset

- Default: `public/splats/plush.splat` (~280 k splats — the v0 prototype scene from [DWEA-34](/DWEA/issues/DWEA-34)).
- The harness duplicates the source on a (sqrt N)² tile grid so `?dup=4` lands at ~1.12 M splats, matching the LOD0 target without committing a fresh ~36 MB fixture to the repo. `?asset=URL` overrides for any captured 1 M scene the Visual Researcher hands over.
- Spacing defaults to 4 m; configurable via `?spacing=`. Tiles overlap visually so the depth-sort path sees a realistic-shaped distribution (not 4 pure clusters in screen space).

### Camera

Deterministic — `poseAt(t)` returns position + lookAt for elapsed seconds since first paint. 12 s orbit period, 0.25 m vertical bob at half-period frequency to avoid a 1:1 path. Same path for both runtimes so frame-time deltas are pure runtime cost, not camera variance.

### Per-runtime adapter

- **Spark** (`@sparkjsdev/spark`): drops `SparkRenderer` + `SplatMesh` into a vanilla Three.js scene with `WebGLRenderer` (no R3F, no rapier). Path-of-least-confounder against v0.
- **gsplat.js** (`gsplat`): standalone — `SPLAT.WebGLRenderer` paints into its own canvas. We materialise the duplicated bytes as a `blob:` URL so `Loader.LoadAsync(url, scene)` consumes the same in-memory payload as the Spark path.

Both runtimes are dynamically imported, so initial bench-page JS stays small (~8 kB) and the chosen-runtime fetch is itself part of `firstSplatFrameMs`.

### Reference devices

| Tier | Device |
|---|---|
| Desktop | M1 MacBook Air (TBD: confirm with operator; alternative is RTX 3060 desktop) |
| Mid-tier mobile | iPhone 12 (TBD: confirm; alternative is Pixel 6) |

Choice locked at run time. Operator records device + browser + version in the JSON envelope (auto-captured from `navigator.userAgent`).

## 2. How to run

```bash
pnpm install
pnpm dev
# then in the browser:
#   http://localhost:5173/bench.html?runtime=spark
#   http://localhost:5173/bench.html?runtime=gsplatjs
```

For deployed runs (post-merge to `main`):

- `https://dru1d3.github.io/dwea/bench.html?runtime=spark`
- `https://dru1d3.github.io/dwea/bench.html?runtime=gsplatjs`

Recommended URL params for the canonical 1 M-splat run on each device:

```
?runtime=spark&dup=4&duration=60&warmup=2
?runtime=gsplatjs&dup=4&duration=60&warmup=2
```

The harness reports back a JSON block to paste into a [DWEA-55](/DWEA/issues/DWEA-55) comment, one block per (device, runtime) pair.

## 3. Maintainer-cadence sanity check (last 90 days, since 2026-02-08)

Captured 2026-05-08 from public GitHub + npm metadata. See sources in §6.

| Signal | **Spark (`@sparkjsdev/spark`)** | **gsplat.js (`gsplat`)** |
|---|---|---|
| Commits to default branch | **>105** | **0** |
| Releases in window | **v2.0.0 (2026-04-14)**, prior v0.1.10 (2025-10-25) | None (last v1.2.9 on 2025-07-12) |
| Repo `pushed_at` | 2026-05-02 | 2025-07-12 |
| Open / total issues | 112 / 484 | 41 / — |
| Recent issue median TTFR | ~1 day (sample of last 10 closed) | >6 months / never (issues from 2025-08 still uncommented) |
| Maintainer | World Labs (org-backed) | Dylan Ebert / Hugging Face (single primary author) |
| License | MIT | MIT |

**Cadence read.** Spark is a *2026 dependency*: org-backed, recent major release (v2.0 LOD system shipped 3 weeks ago), sub-day issue triage. gsplat.js is in *maintenance freeze* — no commits in 90 days, no release in 10 months, single-maintainer attention has clearly moved elsewhere; betting v1 on it means owning the fork.

## 4. Capability comparison (today)

| Capability | Spark | gsplat.js |
|---|---|---|
| WebGPU primary path | **No** — WebGL2 only ("targets 98%+ WebGL2") | **No** — WebGL2 only |
| WebGL2 fallback | n/a (WebGL2 *is* the path) | n/a (WebGL2 *is* the path) |
| Sort algorithm | CPU bucket sort in a Web Worker (`SplatWorker`) | CPU sort in a worker, with skip-if-already-sorted optimisation |
| Formats | `.ply` (incl. compressed), `.spz`, `.splat`, `.ksplat`, SOGS / SOGSv2 | `.splat`, `.ply` |
| Three.js / R3F integration | First-class — `SplatMesh` is a `THREE.Object3D`; `SparkRenderer` plugs into the existing render loop. **No** official `@react-three/spark` wrapper or drei integration as of today. | **None.** Standalone — own `Scene` / `Camera` / `WebGLRenderer`. Compositing with our existing Three.js scene means a second canvas + overlay (or a fork). |
| WASM | Yes (Rust/WASM sort path optional). | None. |
| Maintainer-published benchmarks | None formal; marketing copy only. | None. |

### Implication for the ADR §5 row 3 "switching cost" rating

The ADR rates Spark → gsplat.js as **medium** ("render integration, sort-budget retune; both consume the same `.splat` format"). That is too generous: gsplat.js doesn't integrate with Three.js, so a switch loses every line of v0 that lives in the Three.js scene graph (Character rig, NPC, ground click plane, fit-ground utility, in-page tuner). The realistic cost is **high**, on par with the row-4 "Three.js framework" entry. We should amend the cell when the perf decision is logged in §9.

### Implication for §4.1 WebGPU phrasing

§4.1 describes the desktop budget as "WebGPU primary, WebGL2 fallback." Neither candidate runtime ships a WebGPU sort path today. Either we (a) keep WebGPU language but tag splat rendering as WebGL2-only for v1, or (b) drop the WebGPU-primary framing for the splat row in particular. I'm flagging this for the SystemsArchitect; the bench numbers don't make the call, but the ADR text needs an asterisk regardless of which runtime wins.

## 5. Decision rule (per [DWEA-55](/DWEA/issues/DWEA-55))

- **Default sticks (Spark)** if the bench shows Spark wins or ties on p95 frame time on **both** reference devices, OR if gsplat.js wins by ≤25 %.
- **ADR amends OD-3 → gsplat.js** *only if* gsplat.js wins by **>25 % on p95** on at least one reference device — and even then, the cadence + integration-cost evidence above raises the bar for the SystemsArchitect to accept.

## 6. Recommendation (provisional, pending bench numbers)

**Recommend: stick with Spark.** Rationale, in order of strength:

1. **Maintenance posture.** Spark is alive (org-backed, weekly commits, v2.0 a month ago). gsplat.js looks abandoned-but-unannounced. Picking the dead-looking dep at the start of v1 means we'll likely be the maintainers six months in.
2. **Integration cost.** gsplat.js is not a Three.js integration. The ADR's "switching cost: medium" is wrong; replacing Spark with gsplat.js is closer to swapping the scene framework itself.
3. **Format breadth.** Spark consumes `.spz` and SOGS, which the v1 capture pipeline ([DWEA-53#component-table](/DWEA/issues/DWEA-53#document-adr-v1-platform) row 1) is likely to produce. gsplat.js only handles `.splat` and `.ply`.
4. **Perf parity.** Both ship CPU-worker sort; neither has a WebGPU compute path. There is no architectural reason to expect gsplat.js to beat Spark by 25 % on the same hardware. The bench will confirm or refute this; a tie is the modal outcome.

The recommendation flips only if the bench shows gsplat.js >25 % faster on p95 on at least one reference device **and** the SystemsArchitect explicitly accepts the integration-cost trade. Decide-by 2026-05-15.

## 7. Numbers (to be appended)

Pending. One row per (device, runtime, browser).

| Device | Runtime | UA | Splats | First frame (ms) | Frame p50 / p95 / p99 (ms) | Memory (MB) | JSON link |
|---|---|---|---|---|---|---|---|
| (M1 Air) | spark | — | — | — | — | — | — |
| (M1 Air) | gsplatjs | — | — | — | — | — | — |
| (iPhone 12) | spark | — | — | — | — | — | — |
| (iPhone 12) | gsplatjs | — | — | — | — | — | — |

## 8. Sources

- Spark repo: <https://github.com/sparkjsdev/spark>
- Spark site: <https://sparkjs.dev/>
- Spark releases: <https://github.com/sparkjsdev/spark/releases>
- Spark system design (sort algorithm): <https://sparkjs.dev/docs/system-design/>
- gsplat.js repo: <https://github.com/huggingface/gsplat.js>
- gsplat.js releases: <https://github.com/huggingface/gsplat.js/releases>
- gsplat npm: <https://www.npmjs.com/package/gsplat>
- ADR doc: [DWEA-53#document-adr-v1-platform](/DWEA/issues/DWEA-53#document-adr-v1-platform) §4.1, §5 row 3, §9.
- v0 prototype: [DWEA-34](/DWEA/issues/DWEA-34).
- Adjacent broader bench: [DWEA-59](/DWEA/issues/DWEA-59) (mid-tier laptop + mobile frame budget).
