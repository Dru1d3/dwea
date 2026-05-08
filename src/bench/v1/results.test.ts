import { describe, expect, it } from 'vitest';
import {
  type RunInputs,
  bytesToMb,
  fpsFromFrameStats,
  summariseRun,
  toMarkdownRow,
  verdict,
} from './results.js';
import { TIERS } from './tiers.js';

const FRAME_60FPS = {
  count: 60 * 60,
  meanMs: 16.6,
  p50Ms: 16.6,
  p95Ms: 17.4,
  p99Ms: 19.0,
  minMs: 16.0,
  maxMs: 22.0,
};

const MEMORY_OK = {
  measureUserAgentSpecificMemoryBytes: 480 * 1024 * 1024,
  performanceMemoryUsedJsHeapSize: null,
};

const TRANSFER_OK = {
  initialJsWasmBytes: 18 * 1024 * 1024,
  firstSceneSplatBytes: 6 * 1024 * 1024,
  entryCount: 24,
  partial: false,
  connection: null,
};

function inputs(over: Partial<RunInputs> = {}): RunInputs {
  return {
    tier: TIERS['laptop-a'],
    runtime: 'spark',
    runtimeVersion: 'spark@2.0.0',
    activeSplats: 1_120_000,
    timeToFirstFrameMs: 820,
    assetUrl: '/splats/plush.splat',
    durationMs: 60_000,
    pixelRatio: 2,
    startedAt: '2026-05-08T10:00:00Z',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
    frame: FRAME_60FPS,
    memory: MEMORY_OK,
    transfer: TRANSFER_OK,
    ...over,
  };
}

describe('fpsFromFrameStats', () => {
  it('converts frame ms to fps with sensible rounding', () => {
    const fps = fpsFromFrameStats(FRAME_60FPS);
    expect(fps.p50).toBeCloseTo(60.2, 1);
    expect(fps.p95).toBeCloseTo(57.5, 1);
    // min instantaneous fps comes from the worst frame time (= 22 ms here).
    expect(fps.min).toBeCloseTo(45.5, 1);
    expect(fps.mean).toBeCloseTo(60.2, 1);
    expect(fps.count).toBe(FRAME_60FPS.count);
  });

  it('returns 0 fps for a 0/negative ms reading (defensive)', () => {
    expect(fpsFromFrameStats({ ...FRAME_60FPS, p50Ms: 0 }).p50).toBe(0);
  });
});

describe('bytesToMb', () => {
  it('rounds to 2 decimal MB', () => {
    expect(bytesToMb(1024 * 1024)).toBe(1);
    expect(bytesToMb(1.5 * 1024 * 1024)).toBe(1.5);
    expect(bytesToMb(1234567)).toBeCloseTo(1.18, 2);
  });
});

describe('summariseRun', () => {
  it('produces a clean PASS for a healthy laptop-A run', () => {
    const r = summariseRun(inputs());
    expect(r.schema).toBe('dwea-59-v1-budget/v1');
    expect(r.tier.id).toBe('laptop-a');
    expect(r.evaluation.sustainedFps).toBe('pass');
    expect(r.evaluation.gpuBuffer).toBe('pass');
    expect(r.evaluation.initialPayload).toBe('pass');
    expect(r.measurement.gpuBufferMb).toBe(480);
    expect(r.a2f.faceOnsetMs).toBeNull();
  });

  it('flags FAIL when fps drops below the §6 floor', () => {
    const r = summariseRun(inputs({ frame: { ...FRAME_60FPS, maxMs: 50, p50Ms: 16.6 } }));
    // 50ms = 20fps min < 30 floor → fail
    expect(r.evaluation.sustainedFps).toBe('fail');
  });

  it('flags FAIL when GPU buffer exceeds §6 reject on laptop', () => {
    const r = summariseRun(
      inputs({
        memory: { ...MEMORY_OK, measureUserAgentSpecificMemoryBytes: 900 * 1024 * 1024 },
      }),
    );
    expect(r.evaluation.gpuBuffer).toBe('fail');
  });

  it('flags FAIL when initial transfer exceeds §6 reject', () => {
    const r = summariseRun(
      inputs({
        transfer: {
          ...TRANSFER_OK,
          initialJsWasmBytes: 20 * 1024 * 1024,
          firstSceneSplatBytes: 10 * 1024 * 1024, // total 30 > 25
        },
      }),
    );
    expect(r.evaluation.initialPayload).toBe('fail');
  });

  it('preserves an optional A2F face-onset latency', () => {
    const r = summariseRun(inputs({ a2fFaceOnsetMs: 110 }));
    expect(r.a2f.faceOnsetMs).toBe(110);
  });
});

describe('toMarkdownRow', () => {
  it('renders the canonical tier-table row format', () => {
    const r = summariseRun(inputs());
    const row = toMarkdownRow(r);
    // Sanity: row starts with the tier label, runs through fps + transfer, ends in PASS.
    expect(row.startsWith(`| ${r.tier.label} |`)).toBe(true);
    expect(row).toContain('spark spark@2.0.0');
    expect(row).toContain('1,120,000');
    expect(row.trim().endsWith('| PASS |')).toBe(true);
    expect(row).toContain('480'); // GPU buffer column
  });

  it('renders an em-dash for missing GPU buffer / A2F columns', () => {
    const r = summariseRun(
      inputs({
        memory: { ...MEMORY_OK, measureUserAgentSpecificMemoryBytes: null },
      }),
    );
    const row = toMarkdownRow(r);
    expect(row).toContain(' — '); // em-dash placeholder for unmeasured GPU buffer
  });
});

describe('verdict', () => {
  it('PASS when every probe is `pass`', () => {
    expect(
      verdict({ sustainedFps: 'pass', gpuBuffer: 'pass', initialPayload: 'pass', notes: [] }),
    ).toBe('PASS');
  });
  it('FAIL when any probe is `fail`', () => {
    expect(
      verdict({ sustainedFps: 'pass', gpuBuffer: 'fail', initialPayload: 'pass', notes: [] }),
    ).toBe('FAIL');
  });
  it('PARTIAL when some probe is `na` and none is `fail`', () => {
    expect(
      verdict({ sustainedFps: 'pass', gpuBuffer: 'na', initialPayload: 'pass', notes: [] }),
    ).toBe('PARTIAL');
  });
});
