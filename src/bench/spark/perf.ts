/**
 * Headless-friendly bench primitives for the Spark.js / Scaniverse SPZ
 * harness ([DWEA-111](/DWEA/issues/DWEA-111)). Pure logic; no DOM, no R3F.
 *
 * The runtime instrumentation feeds `recordFrame` deltas (ms) into a sampler.
 * After the bench window closes, `summarise` produces TTFA + p50/p95/min fps
 * keyed against the [DWEA-59](/DWEA/issues/DWEA-59) tier targets.
 */

export type FrameSample = {
  /** Frame delta in milliseconds, as reported by useFrame / RAF clock. */
  readonly deltaMs: number;
  /** `performance.now()` at the time of the sample. */
  readonly timestamp: number;
};

export type FrameStats = {
  readonly count: number;
  readonly p50Fps: number;
  readonly p95Fps: number;
  readonly minFps: number;
  readonly meanFps: number;
};

export type BenchPhase = 'pending' | 'warming' | 'recording' | 'done';

export type BenchSummary = {
  readonly schema: 'dwea-111-spark-bench/v1';
  readonly source: {
    readonly url: string;
    readonly numSplats: number | null;
    readonly bytesOnTheWire: number | null;
  };
  readonly ttfa: {
    /** `navigationStart` → first SplatMesh.onLoad. */
    readonly splatLoadedMs: number | null;
    /** `navigationStart` → first frame where Spark contributes pixels. */
    readonly firstSplatFrameMs: number | null;
    /** `navigationStart` → first frame where Spark + the v0 monster are
     *  both painted (i.e. the harness considers the page "ready"). */
    readonly bothVisibleMs: number | null;
  };
  readonly recording: {
    readonly startedAtMs: number;
    readonly durationMs: number;
    readonly stats: FrameStats;
  };
  readonly env: {
    readonly userAgent: string;
    readonly devicePixelRatio: number;
    readonly viewportPx: { readonly width: number; readonly height: number };
    readonly hardwareConcurrency: number;
  };
};

/**
 * Compute the q-th percentile (0 ≤ q ≤ 1) of `values` using the linear
 * interpolation method (matches NumPy's default). Treats an empty list as 0.
 */
export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) {
    const only = values[0];
    return only ?? 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.min(1, Math.max(0, q));
  const pos = clamped * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const loVal = sorted[lo] ?? 0;
  const hiVal = sorted[hi] ?? loVal;
  if (lo === hi) return loVal;
  const frac = pos - lo;
  return loVal + (hiVal - loVal) * frac;
}

/**
 * Convert a list of per-frame deltas (ms) into fps stats. Note that the
 * percentile of *frame time* is the *complement* of the fps percentile, so
 * `p95Fps` corresponds to the 5th percentile of frame-time (the slowest
 * common frames a viewer will hit).
 */
export function deltasToStats(deltas: readonly number[]): FrameStats {
  const valid = deltas.filter((d) => Number.isFinite(d) && d > 0);
  if (valid.length === 0) {
    return { count: 0, p50Fps: 0, p95Fps: 0, minFps: 0, meanFps: 0 };
  }
  const fps = valid.map((d) => 1000 / d);
  const p50Fps = percentile(fps, 0.5);
  // p95 *fps* = 5th percentile of fps (i.e. the slow end); 95% of frames
  // ran at this fps OR FASTER.
  const p95Fps = percentile(fps, 0.05);
  const minFps = Math.min(...fps);
  const meanFps = fps.reduce((acc, x) => acc + x, 0) / fps.length;
  return {
    count: valid.length,
    p50Fps: round1(p50Fps),
    p95Fps: round1(p95Fps),
    minFps: round1(minFps),
    meanFps: round1(meanFps),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Verdict against a tier target. Returns 'pass' if both `targetFps` and the
 * `minFloor` floor are met, 'fail' otherwise.
 */
export function verdict(
  stats: FrameStats,
  tier: { targetFps: number; minFloor: number },
): { outcome: 'pass' | 'fail'; reasons: readonly string[] } {
  const reasons: string[] = [];
  if (stats.p50Fps < tier.targetFps) {
    reasons.push(`p50 fps ${stats.p50Fps} < target ${tier.targetFps}`);
  }
  if (stats.minFps < tier.minFloor) {
    reasons.push(`min fps ${stats.minFps} < floor ${tier.minFloor}`);
  }
  return { outcome: reasons.length === 0 ? 'pass' : 'fail', reasons };
}

/**
 * Stateful sampler. `recordFrame` is hot-path safe (single push, no sort).
 * `snapshot` allocates and is intended to be called at the bench boundary.
 */
export class FrameSampler {
  private readonly deltas: number[] = [];
  private readonly samples: FrameSample[] = [];

  recordFrame(deltaMs: number, timestamp: number): void {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    this.deltas.push(deltaMs);
    this.samples.push({ deltaMs, timestamp });
  }

  size(): number {
    return this.deltas.length;
  }

  reset(): void {
    this.deltas.length = 0;
    this.samples.length = 0;
  }

  snapshot(): { stats: FrameStats; samples: readonly FrameSample[] } {
    return { stats: deltasToStats(this.deltas), samples: [...this.samples] };
  }
}

export type TtfaMarks = {
  splatLoadedMs: number | null;
  firstSplatFrameMs: number | null;
  bothVisibleMs: number | null;
};

/**
 * Time elapsed (ms) since `performance.timing.navigationStart` /
 * `performance.timeOrigin`. Returns `null` if the host has no `performance`
 * API (e.g. SSR / unit tests).
 */
export function nowSinceNavigation(): number | null {
  if (typeof performance === 'undefined') return null;
  // `performance.now()` is relative to timeOrigin (= navigationStart in
  // modern browsers), so this is the value we want.
  return performance.now();
}
