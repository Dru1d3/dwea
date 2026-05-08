import { describe, expect, it } from 'vitest';
import { makeRecorder, percentile, summarise } from './perf.js';

describe('percentile', () => {
  it('returns 0 for an empty list', () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it('returns the lone element when called on a single-value list', () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it('matches the standard linear-interpolated definition for a 5-element list', () => {
    // Type-7 percentile of [10, 20, 30, 40, 50] for q=0.5 is 30, q=0.95 is 48.
    expect(percentile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(percentile([10, 20, 30, 40, 50], 0.95)).toBeCloseTo(48, 5);
  });

  it('handles q at the extremes', () => {
    expect(percentile([1, 2, 3], 0)).toBe(1);
    expect(percentile([1, 2, 3], 1)).toBe(3);
  });
});

describe('summarise', () => {
  it('returns zeroed stats for an empty sample list', () => {
    expect(summarise({ samples: [] })).toEqual({
      count: 0,
      meanMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      minMs: 0,
      maxMs: 0,
    });
  });

  it('computes mean / p50 / p95 / p99 / min / max for a 100-frame run', () => {
    // 100 samples — 95 at 16ms (60fps), 4 at 32ms (one dropped frame), 1 at 100ms (stall).
    const samples = [...Array(95).fill(16), ...Array(4).fill(32), 100];
    const stats = summarise({ samples });
    expect(stats.count).toBe(100);
    expect(stats.minMs).toBe(16);
    expect(stats.maxMs).toBe(100);
    // mean = (95*16 + 4*32 + 100) / 100 = 17.48 ms
    expect(stats.meanMs).toBeCloseTo(17.48, 2);
    // p50 sits firmly inside the 16ms band.
    expect(stats.p50Ms).toBe(16);
    // p95 lands at the boundary between the 16 ms cluster and the 32 ms tail.
    // Type-7 percentile picks the value at index 0.95 * 99 = 94.05 → between
    // sample 94 (=16) and sample 95 (=32) → 16.8.
    expect(stats.p95Ms).toBeCloseTo(16.8, 2);
    expect(stats.p99Ms).toBeGreaterThanOrEqual(32);
  });
});

describe('makeRecorder', () => {
  it('emits one fewer sample than `tick` calls because the first call seeds lastTs', () => {
    const r = makeRecorder();
    r.tick(0);
    r.tick(16);
    r.tick(33);
    r.tick(50);
    expect(r.samples).toEqual([16, 17, 17]);
  });

  it('drops samples after stop()', () => {
    const r = makeRecorder();
    r.tick(0);
    r.tick(16);
    r.stop();
    r.tick(32);
    expect(r.samples).toEqual([16]);
    expect(r.active()).toBe(false);
  });

  it('drops zero / negative deltas (browser bugs that emit 0-ms frames)', () => {
    const r = makeRecorder();
    r.tick(0);
    r.tick(16);
    r.tick(16); // 0-ms delta
    r.tick(15); // negative — clock drift
    r.tick(31);
    expect(r.samples).toEqual([16, 16]);
  });
});
