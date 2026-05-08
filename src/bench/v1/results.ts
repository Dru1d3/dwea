/**
 * Result formatter for the v1 frame-budget bench (DWEA-59).
 *
 * Bridges a runtime-agnostic perf measurement (whatever the DWEA-55 harness
 * captures — frame stats + memory probe + transfer probe) into:
 *  - a JSON payload (machine-checkable; pasteable into the methodology doc)
 *  - a one-line markdown table row keyed to the methodology doc's tier table
 *  - a verdict line keyed to §2 commitments + §6 reject criteria
 *
 * Side-effect free so unit tests run without a DOM.
 */

import { type Tier, type TierEvaluation, type TierMeasurement, evaluate } from './tiers.js';
import type { TransferProbe } from './transfer.js';

export type FrameStatsLike = {
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly count: number;
};

export type MemorySnapshotLike = {
  readonly measureUserAgentSpecificMemoryBytes: number | null;
  readonly performanceMemoryUsedJsHeapSize: number | null;
};

export type RunInputs = {
  readonly tier: Tier;
  readonly runtime: 'spark' | 'gsplatjs';
  readonly runtimeVersion: string;
  /** Active splats per frame the harness mounted (post-`?dup=`). */
  readonly activeSplats: number;
  /** ms since navigation start when the first coherent frame painted. */
  readonly timeToFirstFrameMs: number;
  /** Source asset URL (informational; informs reproducibility). */
  readonly assetUrl: string;
  /** Active recording window in ms (after warmup discard). */
  readonly durationMs: number;
  readonly pixelRatio: number;
  /** ISO-8601 wall-clock at start. */
  readonly startedAt: string;
  /** Browser UA — recorded raw; humans annotate the device when pasting. */
  readonly userAgent: string;
  readonly frame: FrameStatsLike;
  readonly memory: MemorySnapshotLike;
  readonly transfer: TransferProbe;
  /** Optional A2F-3D end-to-end face-onset latency, when the hybrid pipeline is wired. */
  readonly a2fFaceOnsetMs?: number | null;
};

export type FpsStats = {
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  /** Worst instantaneous fps observed (= 1000 / maxMs). */
  readonly min: number;
  readonly mean: number;
  readonly count: number;
};

export type V1BenchResult = {
  readonly schema: 'dwea-59-v1-budget/v1';
  readonly tier: { id: string; label: string };
  readonly runtime: { id: string; version: string };
  readonly meta: {
    readonly assetUrl: string;
    readonly activeSplats: number;
    readonly timeToFirstFrameMs: number;
    readonly durationMs: number;
    readonly pixelRatio: number;
    readonly startedAt: string;
    readonly userAgent: string;
  };
  readonly fps: FpsStats;
  readonly memory: MemorySnapshotLike;
  readonly transfer: TransferProbe;
  readonly a2f: { faceOnsetMs: number | null };
  readonly evaluation: TierEvaluation;
  readonly measurement: TierMeasurement;
};

export function summariseRun(input: RunInputs): V1BenchResult {
  const fps = fpsFromFrameStats(input.frame);
  const measurement = buildMeasurement(input, fps);
  const evaluation = evaluate(input.tier, measurement);
  return {
    schema: 'dwea-59-v1-budget/v1',
    tier: { id: input.tier.id, label: input.tier.label },
    runtime: { id: input.runtime, version: input.runtimeVersion },
    meta: {
      assetUrl: input.assetUrl,
      activeSplats: input.activeSplats,
      timeToFirstFrameMs: input.timeToFirstFrameMs,
      durationMs: input.durationMs,
      pixelRatio: input.pixelRatio,
      startedAt: input.startedAt,
      userAgent: input.userAgent,
    },
    fps,
    memory: input.memory,
    transfer: input.transfer,
    a2f: { faceOnsetMs: input.a2fFaceOnsetMs ?? null },
    evaluation,
    measurement,
  };
}

export function fpsFromFrameStats(stats: FrameStatsLike): FpsStats {
  return {
    p50: msToFps(stats.p50Ms),
    p95: msToFps(stats.p95Ms),
    p99: msToFps(stats.p99Ms),
    min: msToFps(stats.maxMs),
    mean: msToFps(stats.meanMs),
    count: stats.count,
  };
}

function msToFps(ms: number): number {
  if (ms <= 0) return 0;
  return Math.round((1000 / ms) * 10) / 10;
}

export function buildMeasurement(input: RunInputs, fps: FpsStats): TierMeasurement {
  const gpuBufferBytes = input.memory.measureUserAgentSpecificMemoryBytes;
  return {
    p50Fps: fps.p50,
    minFps: fps.min,
    gpuBufferMb: gpuBufferBytes !== null ? bytesToMb(gpuBufferBytes) : null,
    initialJsWasmMb: bytesToMb(input.transfer.initialJsWasmBytes),
    firstSceneSplatMb: bytesToMb(input.transfer.firstSceneSplatBytes),
  };
}

export function bytesToMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 100) / 100;
}

/**
 * Compact one-row markdown line suitable for pasting into the methodology
 * doc's tier table. Column order matches the table header in
 * `docs/research/visual/v1-frame-budget-bench.md`.
 */
export function toMarkdownRow(r: V1BenchResult): string {
  const m = r.measurement;
  const transfer = m.initialJsWasmMb ?? 0;
  const splat = m.firstSceneSplatMb ?? 0;
  const total = round2(transfer + splat);
  const gpu = m.gpuBufferMb !== null ? `${m.gpuBufferMb}` : '—';
  const a2f = r.a2f.faceOnsetMs !== null ? `${Math.round(r.a2f.faceOnsetMs)}` : '—';
  return `| ${r.tier.label} | ${r.runtime.id} ${r.runtime.version} | ${r.meta.activeSplats.toLocaleString()} | ${r.fps.p50} / ${r.fps.p95} / ${r.fps.min} | ${total} (js+wasm ${transfer} / splat ${splat}) | ${gpu} | ${Math.round(r.meta.timeToFirstFrameMs)} | ${a2f} | ${verdict(r.evaluation)} |`;
}

export function verdict(e: TierEvaluation): string {
  const verdicts = [e.sustainedFps, e.gpuBuffer, e.initialPayload];
  if (verdicts.some((v) => v === 'fail')) return 'FAIL';
  if (verdicts.every((v) => v === 'pass')) return 'PASS';
  return 'PARTIAL';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function toJsonBlock(r: V1BenchResult): string {
  return JSON.stringify(r, null, 2);
}
