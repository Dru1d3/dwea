import { describe, expect, it } from 'vitest';
import { TIERS, evaluate, getTier, tilesForTier } from './tiers.js';

describe('getTier', () => {
  it('returns the tier object for known ids', () => {
    expect(getTier('laptop-a')?.id).toBe('laptop-a');
    expect(getTier('mobile-b')?.label).toContain('Pixel');
  });

  it('returns null for unknown / null / empty', () => {
    expect(getTier(null)).toBeNull();
    expect(getTier(undefined)).toBeNull();
    expect(getTier('')).toBeNull();
    expect(getTier('macbook-pro')).toBeNull();
  });
});

describe('tilesForTier', () => {
  it('returns 1 when the source asset already meets the tier target', () => {
    const t = TIERS['mobile-a']; // 500k target
    expect(tilesForTier(t, 600_000)).toBe(1);
  });

  it('rounds up to the smallest perfect square that hits the target', () => {
    const t = TIERS['laptop-a']; // 1.25M target
    // 280k source × 4 = 1.12M (< target) → bump to next square (9 → 2.52M)
    expect(tilesForTier(t, 280_000)).toBe(9);
    // 500k source × 3-square = 1.5M; ceil(sqrt(2.5))=2, 2² = 4 (< target),
    // ceil(sqrt(2.5)) = 2 → 2²=4 → 4 × 500k = 2M (overshoots, that's fine).
    expect(tilesForTier(t, 500_000)).toBe(4);
  });

  it('returns 1 for non-positive perTile (defensive)', () => {
    expect(tilesForTier(TIERS['laptop-a'], 0)).toBe(1);
    expect(tilesForTier(TIERS['laptop-a'], -10)).toBe(1);
  });
});

describe('evaluate', () => {
  const lap = TIERS['laptop-a'];

  it('passes a clean run that meets §2 + §6', () => {
    const v = evaluate(lap, {
      p50Fps: 62,
      minFps: 41,
      gpuBufferMb: 480,
      initialJsWasmMb: 18,
      firstSceneSplatMb: 6,
    });
    expect(v.sustainedFps).toBe('pass');
    expect(v.gpuBuffer).toBe('pass');
    expect(v.initialPayload).toBe('pass');
  });

  it('fails sustainedFps when minFps drops below the §6 floor', () => {
    const v = evaluate(lap, {
      p50Fps: 60,
      minFps: 22, // < 30 → §6 reject
      gpuBufferMb: 500,
      initialJsWasmMb: 12,
      firstSceneSplatMb: 8,
    });
    expect(v.sustainedFps).toBe('fail');
  });

  it('fails sustainedFps when p50 < §2 target even if min holds', () => {
    const v = evaluate(lap, {
      p50Fps: 45, // < 60 §2 target
      minFps: 31,
      gpuBufferMb: 500,
      initialJsWasmMb: 12,
      firstSceneSplatMb: 8,
    });
    expect(v.sustainedFps).toBe('fail');
  });

  it('marks fps as `na` when samples are missing', () => {
    const v = evaluate(lap, {
      p50Fps: null,
      minFps: null,
      gpuBufferMb: 500,
      initialJsWasmMb: 12,
      firstSceneSplatMb: 8,
    });
    expect(v.sustainedFps).toBe('na');
    expect(v.notes).toContain('fps not recorded');
  });

  it('flags GPU buffer as `na` on mobile (no §6 threshold)', () => {
    const v = evaluate(TIERS['mobile-a'], {
      p50Fps: 33,
      minFps: 31,
      gpuBufferMb: 240,
      initialJsWasmMb: null,
      firstSceneSplatMb: 6,
    });
    expect(v.gpuBuffer).toBe('na');
  });

  it('fails GPU buffer when above §6 reject (laptop only)', () => {
    const v = evaluate(lap, {
      p50Fps: 60,
      minFps: 41,
      gpuBufferMb: 850, // > 800 → §6 reject
      initialJsWasmMb: 12,
      firstSceneSplatMb: 6,
    });
    expect(v.gpuBuffer).toBe('fail');
  });

  it('fails initialPayload at the combined §6 ceiling (>25 MB)', () => {
    const v = evaluate(lap, {
      p50Fps: 60,
      minFps: 41,
      gpuBufferMb: 480,
      initialJsWasmMb: 22,
      firstSceneSplatMb: 12, // 22 + 12 = 34 > 25
    });
    expect(v.initialPayload).toBe('fail');
  });

  it('flags initialPayload as `na` when neither side measured', () => {
    const v = evaluate(lap, {
      p50Fps: 60,
      minFps: 41,
      gpuBufferMb: 480,
      initialJsWasmMb: null,
      firstSceneSplatMb: null,
    });
    expect(v.initialPayload).toBe('na');
  });
});
