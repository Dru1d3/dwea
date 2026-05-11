import { describe, expect, it } from 'vitest';
import { FrameSampler, deltasToStats, percentile, verdict } from './perf.js';

describe('percentile', () => {
  it('returns 0 for an empty list', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('returns the only sample for a single-element list', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('returns the linearly-interpolated value (NumPy default)', () => {
    // [1,2,3,4,5], q=0.5 → exact median = 3
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    // [1,2,3,4,5], q=0.25 → between 2 and 3 → 2
    expect(percentile([1, 2, 3, 4, 5], 0.25)).toBe(2);
    // [1,2,3,4,5], q=0.1 → between 1 and 2 → 1.4
    expect(percentile([1, 2, 3, 4, 5], 0.1)).toBeCloseTo(1.4, 4);
  });

  it('clamps q outside [0,1]', () => {
    expect(percentile([1, 2, 3], -1)).toBe(1);
    expect(percentile([1, 2, 3], 2)).toBe(3);
  });
});

describe('deltasToStats', () => {
  it('zeroes everything when no valid samples', () => {
    expect(deltasToStats([])).toEqual({
      count: 0,
      p50Fps: 0,
      p95Fps: 0,
      minFps: 0,
      meanFps: 0,
    });
  });

  it('computes fps stats for a uniform 60 fps trace', () => {
    const deltas = Array.from({ length: 100 }, () => 1000 / 60);
    const stats = deltasToStats(deltas);
    expect(stats.count).toBe(100);
    expect(stats.p50Fps).toBeCloseTo(60, 0);
    expect(stats.p95Fps).toBeCloseTo(60, 0);
    expect(stats.minFps).toBeCloseTo(60, 0);
    expect(stats.meanFps).toBeCloseTo(60, 0);
  });

  it('drops zero / negative / NaN deltas', () => {
    const stats = deltasToStats([0, -5, Number.NaN, 1000 / 30]);
    expect(stats.count).toBe(1);
    expect(stats.p50Fps).toBeCloseTo(30, 0);
  });

  it('p95 fps reflects the slow end (= 5th percentile of fps)', () => {
    // 95 frames at 60 fps + 5 frames at 12 fps. p95 fps should be the slow end.
    const deltas = [
      ...Array.from({ length: 95 }, () => 1000 / 60),
      ...Array.from({ length: 5 }, () => 1000 / 12),
    ];
    const stats = deltasToStats(deltas);
    expect(stats.p50Fps).toBeCloseTo(60, 0);
    // Slow end (5% of frames at 12 fps) — p95 fps reflects that floor.
    expect(stats.p95Fps).toBeLessThan(60);
    expect(stats.minFps).toBeCloseTo(12, 0);
  });
});

describe('verdict', () => {
  const tier = { targetFps: 60, minFloor: 30 };

  it('passes when p50 ≥ target AND min ≥ floor', () => {
    const v = verdict({ count: 10, p50Fps: 60, p95Fps: 55, minFps: 45, meanFps: 58 }, tier);
    expect(v.outcome).toBe('pass');
    expect(v.reasons).toEqual([]);
  });

  it('fails when p50 below target', () => {
    const v = verdict({ count: 10, p50Fps: 45, p95Fps: 40, minFps: 35, meanFps: 44 }, tier);
    expect(v.outcome).toBe('fail');
    expect(v.reasons.join(';')).toContain('p50');
  });

  it('fails when min below floor', () => {
    const v = verdict({ count: 10, p50Fps: 62, p95Fps: 55, minFps: 22, meanFps: 58 }, tier);
    expect(v.outcome).toBe('fail');
    expect(v.reasons.join(';')).toContain('min');
  });
});

describe('FrameSampler', () => {
  it('records valid deltas and snapshots stats', () => {
    const s = new FrameSampler();
    s.recordFrame(1000 / 60, 100);
    s.recordFrame(1000 / 60, 200);
    s.recordFrame(1000 / 30, 300);
    expect(s.size()).toBe(3);
    const snap = s.snapshot();
    expect(snap.stats.count).toBe(3);
    expect(snap.stats.minFps).toBeCloseTo(30, 0);
  });

  it('ignores invalid deltas', () => {
    const s = new FrameSampler();
    s.recordFrame(0, 0);
    s.recordFrame(-1, 1);
    s.recordFrame(Number.NaN, 2);
    expect(s.size()).toBe(0);
  });

  it('reset clears the buffer', () => {
    const s = new FrameSampler();
    s.recordFrame(1000 / 60, 1);
    s.recordFrame(1000 / 60, 2);
    s.reset();
    expect(s.size()).toBe(0);
    expect(s.snapshot().stats.count).toBe(0);
  });
});
