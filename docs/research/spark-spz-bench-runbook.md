# Spark.js + Scaniverse SPZ bench runbook (DWEA-111)

**Issue:** [DWEA-111](/DWEA/issues/DWEA-111)
**Renderer under test:** [`@sparkjsdev/spark`](https://github.com/sparkjsdev/spark) v2.0.0
**Tier targets:** [DWEA-59](/DWEA/issues/DWEA-59) §Tiers
**Harness branch:** `dwea-111-spark-spz-bench`

This runbook covers the **manual** half of the prototype that the agent
container cannot do (no system browser, no M2 Air, no iPhone 13/14). The
harness itself ships in this branch. A human runs it on each tier and pastes
back JSON.

## What the harness measures

- **TTFA** (`bothVisibleMs`) — `performance.now()` at the first frame where
  Spark's `SparkRenderer.activeSplats > 0` AND the v0 monster (`Npc`) is
  rendered. The v0 monster mounts unconditionally so this collapses to the
  first frame Spark contributes pixels.
- **TTFA splat** (`splatLoadedMs`) — `performance.now()` at `SplatMesh.onLoad`
  (network + decode complete).
- **fps p50 / p95 / min** — sampled in a `useFrame` hook for 60 s after a
  1.5 s warmup discard, percentile math in `src/bench/spark/perf.ts` (NumPy
  default linear interpolation; see `perf.test.ts`).
- **Splat count + wire bytes** — `PackedSplats.getNumSplats()` after
  `onLoad`; `Content-Length` from a parallel `HEAD` request.

The summary publishes to `window.__benchSummary` and to the devtools console
under `[dwea-bench] complete …`. There's also a "Copy JSON" button in the HUD.

## URL flags

| flag                     | effect                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `?renderer=spark`        | Swap the v0 drei `<Splat>` for `<SparkSplatScene>`.        |
| `?bench=spark`           | Same as above + mount the BenchOverlay HUD + sampler.      |
| `?splatUrl=<absolute>`   | Override the registry URL. Use to point at the SPZ asset.  |
| `#/<scene-id>`           | Switch scene (`garden`, `treehill`, `nike`, `plush`).      |

Combine freely. Example with the Researcher's Scaniverse SPZ once attached:

```
…/?bench=spark&splatUrl=https://…/scaniverse-room.spz#/plush
```

The `#/plush` only sets the npc spawn / wander tuning — Spark fetches the URL
verbatim from `?splatUrl`.

## The actual bench procedure (per tier)

### Setup (once per device)

1. **Devtools open.** Chrome on the M2 Air; Safari on the iPhone 13 / 14
   (Web Inspector via cabled Mac).
2. **Cache disabled.** Devtools → Network tab → "Disable cache" while
   devtools are open. This is critical: cached fetches make TTFA meaningless.
3. **Power state.** Plug in. Disable Low Power Mode on iPhone. Plug Mac into
   wall power so the OS doesn't downshift.
4. **Background apps.** Close other tabs / apps. The bench wants the GPU
   to itself.

### Per-network-condition (fast + 3G)

**Fast** — Network tab → "No throttling".
**3G** — Network tab → custom profile: 1.6 Mbps down / 750 Kbps up / 150 ms RTT
(matches Chrome's "Slow 3G" preset; Safari only offers "3G", which is close
enough — record which one you used).

For each combination of `(tier, network)`:

1. Hard reload (`Cmd+Shift+R`).
2. Wait until the HUD reads "done — copy JSON".
3. **Walk through the scene** during the 60 s recording window. Click
   anywhere on the ground to send the v0 monster on a route — repeat every
   ~10 s. Pan the camera with the mouse / pointer drag while the monster is
   moving. (Keep the camera moving so the bench captures sustained raster
   cost, not a static idle scene.)
4. Click "Copy JSON" or run `copy(window.__benchSummary)` in devtools.
5. Paste into the [DWEA-111](/DWEA/issues/DWEA-111) thread under a heading
   that names the device + network (e.g. `## M2 Air · fast`).

### Reporting template

Paste this once per `(tier, network)` cell:

````markdown
## <tier> · <network>

```json
{ paste of window.__benchSummary }
```

- Verdict vs [DWEA-59](/DWEA/issues/DWEA-59) §Tiers target: **PASS** / **FAIL**
- If FAIL — dominant cost (network fetch / sort init / sustained raster /
  monster overlay): <one of those>
- One-line mitigation note: <e.g. switch to SOG, raise lodScale, etc>
````

The Researcher folds the numbers into
[`docs/research/gaussian-splat-capture-and-web-rendering.md`](/DWEA/issues/DWEA-110)
§2 / §3.

## Hardware tiers (from DWEA-59)

| tier      | reference         | targetFps | minFloor |
| --------- | ----------------- | --------- | -------- |
| laptop-a  | M2 Air (8/16 GB)  | 60        | 30       |
| mobile-a  | iPhone 13 / 14    | 30        | 30       |
| laptop-b  | RTX 30-series mobile (optional) | 60 | 30 |

## Where to run

- Local: `pnpm dev` then
  `http://localhost:5173/?bench=spark&splatUrl=<…>` on the device
  (use `--host` if you need LAN access from the phone).
- Preview: agent-owned `dru1d3.github.io/dwea-previews/<branch>/`
  once the preview build for `dwea-111-spark-spz-bench` lands. URL format
  matches existing per-branch previews; see the PR for the exact link.

## Known caveats (worth flagging when you report)

- **Bundle size.** This branch ships ~8.5 MB unzipped JS (~3 MB gzip). That's
  well under the §6 25 MB transfer reject ceiling but the parse + compile
  cost on iPhone 13 will be visible in TTFA. It is **not** a bench
  regression; future work is to dynamic-`import()` `@sparkjsdev/spark` so
  it doesn't ship to non-Spark scenes.
- **`SparkRenderer` antialias.** Spark's docs recommend `antialias: false`
  on the WebGLRenderer. The v0 Canvas opts in (`antialias: true`); the
  overhead is cosmetic for the bench but worth a follow-up if mobile-a fails.
- **HEAD request and CORS.** Some splat hosts (e.g. Hugging Face) reject
  `HEAD`. The `wire bytes` field will be `null` in that case — the bench
  still passes; just note it.
- **The v0 monster is the husky rig**, not a stylised v1 monster. Per the
  [DWEA-111 description](/DWEA/issues/DWEA-111) we use what's there; the
  monster overlay cost is recorded against this rig and would need to be
  re-measured against a different model in a future bench.
