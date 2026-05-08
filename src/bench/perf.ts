/**
 * Frame-time recorder + percentile math for the splat-runtime bench.
 *
 * One "sample" is the wall-clock delta between two consecutive
 * `requestAnimationFrame` callbacks, in milliseconds. The bench runs for
 * `durationMs` after first-paint and reports p50 + p95 plus a histogram-friendly
 * raw sample list.
 *
 * Why rAF deltas: it's the only timing path both runtimes share without writing
 * library-specific instrumentation. It captures sort + render + browser-vsync
 * jitter all together — which is the user-perceived frame budget the ADR
 * §4.1 numbers target.
 */

export type FrameSamples = {
  /** Raw frame durations (ms), in arrival order. */
  readonly samples: ReadonlyArray<number>;
};

export type FrameStats = {
  readonly count: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
};

export function summarise(frames: FrameSamples): FrameStats {
  const n = frames.samples.length;
  if (n === 0) {
    return {
      count: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      minMs: 0,
      maxMs: 0,
    };
  }
  const sorted = [...frames.samples].sort((a, b) => a - b);
  const mean = sorted.reduce((acc, v) => acc + v, 0) / n;
  return {
    count: n,
    meanMs: round2(mean),
    p50Ms: round2(percentile(sorted, 0.5)),
    p95Ms: round2(percentile(sorted, 0.95)),
    p99Ms: round2(percentile(sorted, 0.99)),
    minMs: round2(safeAt(sorted, 0)),
    maxMs: round2(safeAt(sorted, n - 1)),
  };
}

/**
 * Linear-interpolated percentile on an already-sorted ascending array.
 * Matches the "Type 7" definition R / NumPy use by default — equivalent to
 * `numpy.percentile(samples, q*100, interpolation='linear')`.
 */
export function percentile(sorted: ReadonlyArray<number>, q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return safeAt(sorted, 0);
  const idx = q * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  const frac = idx - lo;
  return safeAt(sorted, lo) * (1 - frac) + safeAt(sorted, hi) * frac;
}

function safeAt(sorted: ReadonlyArray<number>, i: number): number {
  const v = sorted[i];
  if (v == null) {
    throw new Error(`percentile: index ${i} out of range for length ${sorted.length}`);
  }
  return v;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

export type Recorder = {
  /** Mark the start of a frame. Returns elapsed ms since the previous mark. */
  tick(now: number): number | null;
  /** Stop accepting samples. */
  stop(): void;
  /** True if `tick` is still accumulating. */
  active(): boolean;
  readonly samples: ReadonlyArray<number>;
};

export function makeRecorder(): Recorder {
  let lastTs: number | null = null;
  let isActive = true;
  const samples: number[] = [];
  return {
    tick(now: number): number | null {
      if (!isActive) return null;
      if (lastTs === null) {
        lastTs = now;
        return null;
      }
      const delta = now - lastTs;
      lastTs = now;
      // Defensive: drop pathological 0 / negative deltas (browser bugs); a
      // 0-ms frame is almost certainly not a real one.
      if (delta > 0) samples.push(delta);
      return delta;
    },
    stop(): void {
      isActive = false;
    },
    active(): boolean {
      return isActive;
    },
    get samples(): ReadonlyArray<number> {
      return samples;
    },
  };
}

export type MemorySnapshot = {
  readonly measureUserAgentSpecificMemoryBytes: number | null;
  readonly performanceMemoryUsedJsHeapSize: number | null;
  readonly webgpuAdapter: WebGpuAdapterInfo | null;
};

export type WebGpuAdapterInfo = {
  readonly vendor?: string | undefined;
  readonly architecture?: string | undefined;
  readonly device?: string | undefined;
  readonly description?: string | undefined;
};

export async function captureMemorySnapshot(): Promise<MemorySnapshot> {
  const measure = await tryMeasureMemory();
  // performance.memory is a non-standard Chrome surface; useful as a fallback.
  const heap = readPerformanceMemoryHeap();
  const webgpuAdapter = await tryWebGpuAdapterInfo();
  return {
    measureUserAgentSpecificMemoryBytes: measure,
    performanceMemoryUsedJsHeapSize: heap,
    webgpuAdapter,
  };
}

async function tryMeasureMemory(): Promise<number | null> {
  type MeasureFn = () => Promise<{ bytes?: number }>;
  const perf = performance as unknown as {
    measureUserAgentSpecificMemory?: MeasureFn;
  };
  if (typeof perf.measureUserAgentSpecificMemory !== 'function') return null;
  try {
    const result = await perf.measureUserAgentSpecificMemory();
    return typeof result?.bytes === 'number' ? result.bytes : null;
  } catch {
    return null;
  }
}

function readPerformanceMemoryHeap(): number | null {
  const perf = performance as unknown as {
    memory?: { usedJSHeapSize?: number };
  };
  const v = perf.memory?.usedJSHeapSize;
  return typeof v === 'number' ? v : null;
}

async function tryWebGpuAdapterInfo(): Promise<WebGpuAdapterInfo | null> {
  const nav = navigator as unknown as {
    gpu?: {
      requestAdapter: () => Promise<{
        info?: WebGpuAdapterInfo;
        requestAdapterInfo?: () => Promise<WebGpuAdapterInfo>;
      } | null>;
    };
  };
  if (!nav.gpu) return null;
  try {
    const adapter = await nav.gpu.requestAdapter();
    if (!adapter) return null;
    if (adapter.info) return pickAdapterInfo(adapter.info);
    // Older Chromium surface.
    if (typeof adapter.requestAdapterInfo === 'function') {
      const info = await adapter.requestAdapterInfo();
      return pickAdapterInfo(info);
    }
    return null;
  } catch {
    return null;
  }
}

function pickAdapterInfo(info: WebGpuAdapterInfo): WebGpuAdapterInfo {
  return {
    vendor: info.vendor,
    architecture: info.architecture,
    device: info.device,
    description: info.description,
  };
}
