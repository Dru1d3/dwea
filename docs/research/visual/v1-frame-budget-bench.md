# v1 frame-budget bench

- **Issue:** [DWEA-59](/DWEA/issues/DWEA-59)
- **Parent:** [DWEA-52 v1 Realism Bar](/DWEA/issues/DWEA-52)
- **Owner:** [FoundingEngineer](/DWEA/agents/foundingengineer)
- **Status:** v0.1 — methodology pinned; numbers pending hardware access.
- **Reads from:** [§2 Web runtime / Frame budget](/DWEA/issues/DWEA-52#document-v1-realism-bar) and [§6 Realism rejection criteria](/DWEA/issues/DWEA-52#document-v1-realism-bar)
- **Feeds:** [v1 Platform ADR](/DWEA/issues/DWEA-53#document-adr-v1-platform) §4.1, §5

## Why this bench exists

The v1 Realism Bar §2 commits to a frame budget that has not yet been measured.
The v1 Platform ADR cannot lock its budgets ([DWEA-53](/DWEA/issues/DWEA-53))
without those numbers. This bench produces the measurements per hardware tier,
runs the result against the §6 reject criteria, and returns a recommendation
on any §2 / §6 number the bench shows is wrong-shaped.

## Targets per tier

Source: [v1 Realism Bar §2](/DWEA/issues/DWEA-52#document-v1-realism-bar). The
"mid-tier laptop" tier from §2 is split here into A/B/C as the FoundingEngineer
sees three meaningfully different GPU paths inside that label.

| Tier | Reference hardware | Active splats | Sustained fps | GPU buffer ceiling | Initial JS+wasm | First-scene splat |
|---|---|---|---|---|---|---|
| Laptop A — unified mem | M2 Air (8/16 GB) | 1.25 M | 60 fps | ≤ 600 MB | ≤ 25 MB | ≤ 15 MB |
| Laptop B — discrete dGPU | RTX 30-series mobile (3050/3060) | 1.5 M | 60 fps | ≤ 600 MB | ≤ 25 MB | ≤ 15 MB |
| Laptop C — integrated | Iris Xe + 16 GB RAM | 1.0 M | 30 fps (stretch 60) | ≤ 600 MB | ≤ 25 MB | ≤ 15 MB |
| Mobile A | iPhone 13 / 14 | 500 K | 30 fps | ≤ 250 MB | (not budgeted) | (not budgeted) |
| Mobile B | mid-range Android 2024 (Pixel 7a) | 500 K | 30 fps | ≤ 250 MB | (not budgeted) | (not budgeted) |

§6 rejection — applied per run by the harness:

- **First-scene initial payload (JS+wasm + splat) > 25 MB** → reject.
- **GPU buffer > 800 MB on any laptop tier** → reject (no §6 mobile threshold).
- **Min fps < 30 on the laptop tier with the v1 character count loaded** → reject.
- Lipsync / face / lighting criteria from §6 are out of scope of this bench
  and tracked separately.

## Fixtures

### Scene fixture

- Source: v0 prototype scene from [DWEA-34](/DWEA/issues/DWEA-34) (`public/splats/plush.splat`,
  ~280 K splats).
- v1 representative complexity is 1.0–1.5 M splats. The harness
  scales the source up via the in-repo splat duplicator (`?dup=N`, perfect
  square; auto-selected by the chosen tier when `?dup` is omitted).
- For the dedicated v1 capture once the visual researcher delivers it,
  override with `?asset=URL` pointing at any same-origin or CORS-allowed
  `.splat` / `.spz` / `.ply` / `.ksplat`.

### Character fixture (env-only for v0.1)

The character target is **1 hero (rigged-face + splat-body, A2F-3D-driven
blendshapes) + 2 ambient idle characters**. The hybrid rigged-face + splat-body
+ A2F-3D pipeline is not yet implemented (see DWEA-59 follow-up child for the
character-pass run). Per the issue's escape hatch:

> If the hybrid pipeline isn't ready, bench env-only and flag the character
> pass as a follow-up.

This bench therefore reports **env-only** numbers and a stub `a2fFaceOnsetMs`
column. The character pass will be re-run as a follow-up with the full v1
character count once the pipeline lands; if `min fps < 30 on laptop tier with
the v1 character count loaded` falls out of that re-run, §6 rejects the asset
and §4.1 of the v1 Platform ADR needs amendment.

### Runtime under test

- **Spark.js 2.0** on Three.js, SPZ shipping format. `runtime=spark`.
- **gsplat.js 1.x** as cheap comparison run. `runtime=gsplatjs`.
- The actual harness page is built by [DWEA-55](/DWEA/issues/DWEA-55); this
  doc covers how to drive it for v1-tier evaluation.

## How to run

The bench page lives at `/bench.html` (deployed to GH Pages, see
[ADR-0002 Deploy target update](/docs/decisions/0002-splat-renderer.md)). The
operator runs the URL once per (tier, runtime) pair on a real device.

### Step 1 — open the bench URL

URL shape:

```
https://dru1d3.github.io/dwea/bench.html?runtime=spark&tier=laptop-a&duration=60&warmup=5
```

Required URL params:

- `runtime=spark|gsplatjs` — which adapter to mount.
- `tier=laptop-a|laptop-b|laptop-c|mobile-a|mobile-b` — the §2 budget the run
  evaluates against. Auto-selects the splat-tile count.

Optional:

- `asset=URL` — override the default fixture.
- `dup=N` — force a specific perfect-square tile count (otherwise the tier
  picks the smallest square that hits its splat target).
- `duration=SEC` — active recording window. Default 60 s.
- `warmup=SEC` — frames discarded before recording. Default 5 s.
- `dpr=N` — explicit devicePixelRatio cap. Default `min(window.devicePixelRatio, 2)`.
- `autostart=1` — skip the run button (CI / headless).

### Step 2 — capture each metric

The harness produces five of the six DWEA-59 numbers automatically:

| Metric | Source |
|---|---|
| Sustained fps (P50 / P95 / min over 60 s) | rAF deltas, post-warmup, summarised by `src/bench/perf.ts` |
| Active splats per frame | `?dup` × per-tile splat count, surfaced as `meta.activeSplats` |
| GPU buffer estimate | `performance.measureUserAgentSpecificMemory()` (best-effort) + `WEBGL_debug_renderer_info` / `navigator.gpu.requestAdapter().info` |
| Initial JS + wasm transferred | `performance.getEntriesByType('resource')` `transferSize` for `*.{js,mjs,wasm}` + the navigation entry |
| First-scene splat payload over the wire | `performance.getEntriesByType('resource')` `transferSize` for `*.{splat,spz,ply,ksplat}` |
| Time-to-first-coherent-frame | `performance.now()` taken at the rAF after `runtime.ready` resolves |

The sixth, **A2F-3D end-to-end face-onset latency**, is captured on the
character-pass re-run only — see [§ Character pass follow-up](#character-pass-follow-up).

### Step 3 — the throttled-network run

The first-scene splat payload + time-to-first-coherent-frame must also be
captured under a 5 Mbps throttle to satisfy the issue. The harness does not
attempt to throttle from inside the page — Chrome / Safari / Firefox all
require throttling at the DevTools / OS layer. Procedure:

1. Chrome DevTools → Network panel → throttle preset → **Custom… → 5 Mbps
   down / 1 Mbps up / 200 ms RTT**, save as preset "DWEA 5Mbps".
2. Hard-reload the bench URL with the preset selected.
3. The `transfer.partial` flag in the result JSON tells you whether any
   resource entry showed `transferSize=0` due to a CORS-opaque body — if so,
   note the DevTools-reported transfer size in the comment alongside the row.

### Step 4 — paste the numbers back

The on-page results panel exposes two copy buttons:

- **copy markdown row** — paste into the `## Results` table below.
- **copy JSON** — paste into a code block under the row for full reproducibility
  (UA, navigator.gpu adapter info, raw frame samples count, etc.).

Run the same URL three times per (tier, runtime) and take the median.
Stalls in the first 60 s of an unheated browser session are common; the
warmup parameter eats the worst of it but a cold-cache outlier still happens.

## Results — Spark 2.0

Numbers landed by the operator. Empty row = not yet run.

| Tier | Runtime | Active splats | fps P50/P95/min | Initial transfer (MB) | GPU buffer (MB) | First frame (ms) | A2F onset (ms) | Verdict |
|---|---|---|---|---|---|---|---|---|
| Laptop A — unified mem (M2 Air) | spark spark@2.x | _pending_ | | | | | — | — |
| Laptop B — discrete dGPU (RTX 30-series mobile) | spark spark@2.x | _pending_ | | | | | — | — |
| Laptop C — integrated (Iris Xe + 16 GB) | spark spark@2.x | _pending_ | | | | | — | — |
| Mobile A — iPhone 13 / 14 | spark spark@2.x | _pending_ | | | | | — | — |
| Mobile B — mid-range Android 2024 (Pixel 7a) | spark spark@2.x | _pending_ | | | | | — | — |

## Results — gsplat.js 1.x (comparison)

| Tier | Runtime | Active splats | fps P50/P95/min | Initial transfer (MB) | GPU buffer (MB) | First frame (ms) | A2F onset (ms) | Verdict |
|---|---|---|---|---|---|---|---|---|
| Laptop A — unified mem (M2 Air) | gsplatjs gsplat@1.x | _pending_ | | | | | — | — |
| Laptop B — discrete dGPU (RTX 30-series mobile) | gsplatjs gsplat@1.x | _pending_ | | | | | — | — |
| Laptop C — integrated (Iris Xe + 16 GB) | gsplatjs gsplat@1.x | _pending_ | | | | | — | — |
| Mobile A — iPhone 13 / 14 | gsplatjs gsplat@1.x | _pending_ | | | | | — | — |
| Mobile B — mid-range Android 2024 (Pixel 7a) | gsplatjs gsplat@1.x | _pending_ | | | | | — | — |

## Pass / fail map

The harness emits one of `PASS` / `FAIL` / `PARTIAL` per row:

- **PASS** — fps meets §2 target and stays above the §6 floor; GPU buffer is
  inside the §6 reject; initial transfer is inside the §6 reject.
- **FAIL** — at least one §6 reject criterion is breached. The asset / scene
  is rejected from v1 at this tier.
- **PARTIAL** — at least one probe is `na` (e.g. `measureUserAgentSpecificMemory`
  not available on this browser) and no probe failed. Capture the missing
  number from DevTools manually and re-evaluate.

If any laptop tier returns `FAIL`, §4.1 of the v1 Platform ADR cannot lock
its current numbers without amendment — the FoundingEngineer surfaces the
amendment recommendation in the next section.

## Recommendations

_To be filled after the first round of measurements lands. Drafting space:_

- §2 active-splat target adjustments per tier:
- §2 GPU-buffer ceiling adjustments per tier:
- §2 initial-payload ceiling adjustments per tier:
- §6 reject-threshold adjustments:
- v1 ADR §4.1 amendment ask (if any):

## Character pass follow-up

The hybrid rigged-face + splat-body + A2F-3D character is not yet built. When
the pipeline lands, this bench is re-run with **1 hero + 2 ambient idle**
characters loaded into the same scene fixture, and the following are added
to the row:

- A2F-3D end-to-end face-onset latency = `audio onset → first blendshape applied`,
  captured by instrumenting the audio decoder's first-buffer callback against
  the rig's first non-rest-pose blendshape weight tick.
- Min fps under v1 character count must remain ≥ 30 on every laptop tier —
  this is a §6 reject criterion that the env-only run cannot evaluate.

## Operator hardware-access ask

This bench cannot run from inside an agent heartbeat (no browser, no display
device). The numbers in the tables above are unblocked by either:

1. A board / CEO-managed device pool that covers all five reference devices.
2. Volunteer access from team members already on those devices.

The first row that lands is enough to start the recommendations section
above. Until at least one laptop-tier and one mobile-tier row is filled,
DWEA-59 stays `blocked` with `unblock owner = CEO/SystemsArchitect` — the
v1 ADR depends on the laptop tier specifically.
